// Package trace implements a lightweight "profiler" for SQL Server on top of
// Extended Events (the supported replacement for SQL Trace / Profiler).
//
// A uniquely named event session writing to an in-memory ring buffer is created
// on the server; Poll reads the buffer and returns only the events not seen
// before. The session is dropped on Stop.
package trace

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"hash/fnv"
	"sort"
	"strconv"
	"strings"
	"time"

	mssql "github.com/microsoft/go-mssqldb"
)

// SessionPrefix is the name prefix of every event session created by this app.
const SessionPrefix = "spx_trace_"

// Options configures a trace.
type Options struct {
	// MinDurationMs hides completed statements faster than this (0 = all).
	MinDurationMs int `json:"minDurationMs"`
	// IncludeOwn also captures statements issued by this app (e.g. the Consultas tab).
	IncludeOwn bool `json:"includeOwn"`
}

// Event is one captured statement or error.
type Event struct {
	Seq        int64  `json:"seq"`
	Time       string `json:"time"` // RFC3339, UTC
	Kind       string `json:"kind"` // "batch" | "rpc" | "error"
	DurationUs int64  `json:"durationUs"`
	CPUUs      int64  `json:"cpuUs"`
	Reads      int64  `json:"reads"`
	Writes     int64  `json:"writes"`
	Rows       int64  `json:"rows"`
	Result     string `json:"result"` // OK / Error / Abort
	Database   string `json:"database"`
	Login      string `json:"login"`
	Host       string `json:"host"`
	App        string `json:"app"`
	SessionID  int64  `json:"sessionId"`
	Object     string `json:"object"`
	Text       string `json:"text"`
	ErrorNo    int64  `json:"errorNumber"`
	Severity   int64  `json:"severity"`
}

// Tracer owns one event session on the server.
type Tracer struct {
	Name string

	seen map[string]bool
	seq  int64
}

// ErrNoPermission is returned when the login lacks ALTER ANY EVENT SESSION.
var ErrNoPermission = errors.New("el usuario no tiene permiso ALTER ANY EVENT SESSION (o CONTROL SERVER) en el servidor")

// Start creates and starts an event session filtered to dbName.
func Start(ctx context.Context, conn *sql.DB, dbName, appName string, opts Options) (*Tracer, error) {
	name, err := NewSessionName("")
	if err != nil {
		return nil, err
	}
	if err := CreateAndStart(ctx, conn, name, buildCreateSQL(name, dbName, appName, opts)); err != nil {
		return nil, err
	}
	return &Tracer{Name: name, seen: map[string]bool{}}, nil
}

// NewSessionName returns a unique event-session name that Drop and Cleanup
// accept. tag (lowercase letters/digits) is optional and identifies the feature.
func NewSessionName(tag string) (string, error) {
	var rnd [4]byte
	if _, err := rand.Read(rnd[:]); err != nil {
		return "", err
	}
	name := SessionPrefix
	if tag != "" {
		name += tag + "_"
	}
	name += hex.EncodeToString(rnd[:])
	if !validName(name) {
		return "", fmt.Errorf("nombre de sesión inválido: %q", name)
	}
	return name, nil
}

// CreateAndStart runs the CREATE EVENT SESSION statement ddl for name and
// starts the session. The session is dropped again if it cannot be started.
func CreateAndStart(ctx context.Context, conn *sql.DB, name, ddl string) error {
	if !validName(name) {
		return fmt.Errorf("nombre de sesión inválido: %q", name)
	}
	if _, err := conn.ExecContext(ctx, ddl); err != nil {
		return wrapPermission(err)
	}
	if _, err := conn.ExecContext(ctx, fmt.Sprintf("ALTER EVENT SESSION [%s] ON SERVER STATE = START", name)); err != nil {
		_ = Drop(context.Background(), conn, name)
		return wrapPermission(err)
	}
	return nil
}

// ReadRingBuffer returns the raw XML of the session's ring_buffer target.
func ReadRingBuffer(ctx context.Context, conn *sql.DB, name string) (string, error) {
	var data sql.NullString
	err := conn.QueryRowContext(ctx, `SELECT CAST(t.target_data AS NVARCHAR(MAX))
		FROM sys.dm_xe_sessions s
		INNER JOIN sys.dm_xe_session_targets t ON t.event_session_address = s.address
		WHERE s.name = @p1 AND t.target_name = N'ring_buffer'`, name).Scan(&data)
	if errors.Is(err, sql.ErrNoRows) {
		return "", errors.New("la sesión de traza ya no existe en el servidor (¿fue detenida?)")
	}
	if err != nil {
		return "", wrapPermission(err)
	}
	return data.String, nil
}

// Drop removes an event session (stopping it first if it is running).
func Drop(ctx context.Context, conn *sql.DB, name string) error {
	if !validName(name) {
		return fmt.Errorf("nombre de sesión inválido: %q", name)
	}
	_, err := conn.ExecContext(ctx, fmt.Sprintf(
		"IF EXISTS (SELECT 1 FROM sys.server_event_sessions WHERE name = N'%s') DROP EVENT SESSION [%s] ON SERVER", name, name))
	return err
}

// Cleanup drops every session created by this app (prefix spx_trace_) and
// returns how many were removed. Used to clear sessions left behind by a crash.
func Cleanup(ctx context.Context, conn *sql.DB) (int, error) {
	rows, err := conn.QueryContext(ctx, "SELECT name FROM sys.server_event_sessions WHERE name LIKE N'spx[_]trace[_]%'")
	if err != nil {
		return 0, wrapPermission(err)
	}
	var names []string
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			rows.Close()
			return 0, err
		}
		names = append(names, n)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	dropped := 0
	for _, n := range names {
		if !validName(n) {
			continue
		}
		if err := Drop(ctx, conn, n); err != nil {
			return dropped, wrapPermission(err)
		}
		dropped++
	}
	return dropped, nil
}

// Poll reads the ring buffer and returns the events that appeared since the last call.
func (t *Tracer) Poll(ctx context.Context, conn *sql.DB) ([]Event, error) {
	doc, err := ReadRingBuffer(ctx, conn, t.Name)
	if err != nil {
		return nil, err
	}
	if doc == "" {
		return nil, nil
	}
	events, err := ParseRingBuffer(doc)
	if err != nil {
		return nil, err
	}
	return t.fresh(events), nil
}

// fresh keeps only events not returned by a previous Poll, oldest first.
// The ring buffer is re-read whole each time, so identity comes from a key built
// from the event's own fields; only the previous poll's keys are retained, which
// bounds memory.
func (t *Tracer) fresh(events []Event) []Event {
	current := make(map[string]bool, len(events))
	var out []Event
	for _, e := range events {
		k := eventKey(e)
		current[k] = true
		if !t.seen[k] {
			out = append(out, e)
		}
	}
	t.seen = current
	sort.SliceStable(out, func(i, j int) bool { return out[i].Time < out[j].Time })
	for i := range out {
		t.seq++
		out[i].Seq = t.seq
	}
	return out
}

func eventKey(e Event) string {
	h := fnv.New64a()
	h.Write([]byte(e.Text))
	h.Write([]byte(e.Object))
	return e.Time + "|" + strconv.FormatInt(e.SessionID, 10) + "|" + e.Kind + "|" +
		strconv.FormatInt(e.DurationUs, 10) + "|" + strconv.FormatUint(h.Sum64(), 16)
}

func validName(name string) bool {
	if !strings.HasPrefix(name, SessionPrefix) || len(name) > 64 {
		return false
	}
	for _, r := range name {
		if !(r == '_' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}

func sqlString(s string) string { return "N'" + strings.ReplaceAll(s, "'", "''") + "'" }

func buildCreateSQL(name, dbName, appName string, opts Options) string {
	const actions = "sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.database_name, sqlserver.username, sqlserver.session_id"

	base := "sqlserver.database_name = " + sqlString(dbName)
	if !opts.IncludeOwn && appName != "" {
		base += " AND sqlserver.client_app_name <> " + sqlString(appName)
	}
	completed := base
	if opts.MinDurationMs > 0 {
		completed += fmt.Sprintf(" AND duration >= %d", int64(opts.MinDurationMs)*1000) // duration is in microseconds
	}
	errPred := base + " AND severity >= 11"

	return fmt.Sprintf(`CREATE EVENT SESSION [%s] ON SERVER
ADD EVENT sqlserver.sql_batch_completed (ACTION (%s) WHERE (%s)),
ADD EVENT sqlserver.rpc_completed (ACTION (%s) WHERE (%s)),
ADD EVENT sqlserver.error_reported (ACTION (%s, sqlserver.sql_text) WHERE (%s))
ADD TARGET package0.ring_buffer (SET max_memory = 2048, occurrence_number = 500)
WITH (MAX_MEMORY = 4096 KB, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS, MAX_DISPATCH_LATENCY = 1 SECONDS,
      MEMORY_PARTITION_MODE = NONE, TRACK_CAUSALITY = OFF, STARTUP_STATE = OFF)`,
		name, actions, completed, actions, completed, actions, errPred)
}

// wrapPermission turns SQL Server permission errors into a clear message.
func wrapPermission(err error) error {
	var me mssql.Error
	if errors.As(err, &me) {
		switch me.Number {
		case 262, 297, 300, 229, 15247:
			return fmt.Errorf("%w (%s)", ErrNoPermission, strings.TrimSpace(me.Message))
		}
	}
	return err
}

// ---------------------------------------------------------------- XML parsing

type xeRoot struct {
	Events []xeEvent `xml:"event"`
}

type xeEvent struct {
	Name      string     `xml:"name,attr"`
	Timestamp string     `xml:"timestamp,attr"`
	Data      []xeField  `xml:"data"`
	Actions   []xeAction `xml:"action"`
}

type xeField struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value"`
	Text  string `xml:"text"`
}

type xeAction struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value"`
}

// ParseRingBuffer converts the ring_buffer target XML into events (unsorted, no Seq).
func ParseRingBuffer(doc string) ([]Event, error) {
	var root xeRoot
	if err := xml.Unmarshal([]byte(doc), &root); err != nil {
		return nil, fmt.Errorf("no se pudo interpretar el buffer de la traza: %w", err)
	}
	out := make([]Event, 0, len(root.Events))
	for _, x := range root.Events {
		if e, ok := convert(x); ok {
			out = append(out, e)
		}
	}
	return out, nil
}

func convert(x xeEvent) (Event, bool) {
	fields := map[string]xeField{}
	for _, d := range x.Data {
		fields[d.Name] = d
	}
	actions := map[string]string{}
	for _, a := range x.Actions {
		actions[a.Name] = a.Value
	}
	num := func(name string) int64 {
		n, _ := strconv.ParseInt(strings.TrimSpace(fields[name].Value), 10, 64)
		return n
	}

	e := Event{
		Time:      normalizeTime(x.Timestamp),
		Database:  actions["database_name"],
		Login:     actions["username"],
		Host:      actions["client_hostname"],
		App:       actions["client_app_name"],
		SessionID: parseInt(actions["session_id"]),
	}
	switch x.Name {
	case "sql_batch_completed":
		e.Kind = "batch"
		e.Text = fields["batch_text"].Value
	case "rpc_completed":
		e.Kind = "rpc"
		e.Object = fields["object_name"].Value
		e.Text = fields["statement"].Value
	case "error_reported":
		e.Kind = "error"
		e.Result = "Error"
		e.ErrorNo = num("error_number")
		e.Severity = num("severity")
		e.Text = actions["sql_text"]
		e.Object = fields["message"].Value // message shown next to the failing text
		return e, true
	default:
		return Event{}, false
	}
	e.DurationUs = num("duration")
	e.CPUUs = num("cpu_time")
	e.Reads = num("logical_reads")
	e.Writes = num("writes")
	e.Rows = num("row_count")
	e.Result = fields["result"].Text
	return e, true
}

func parseInt(s string) int64 {
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n
}

// normalizeTime keeps XE's UTC timestamp but trims it to millisecond precision.
func normalizeTime(ts string) string {
	t, err := time.Parse(time.RFC3339Nano, ts)
	if err != nil {
		return ts
	}
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
