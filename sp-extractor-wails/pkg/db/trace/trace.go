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

	// The filters below are applied by the server (like the filters of SSMS's
	// Profiler / Extended Events wizard), so non-matching activity is never
	// captured. Empty / zero means "no filter".

	// Login is the login name (server principal) to capture, compared case-insensitively.
	Login string `json:"login"`
	// Host is the client machine name; any host whose name contains it matches.
	Host string `json:"host"`
	// HostPID is the process ID of the client program on its machine (SSMS: HostProcessID).
	HostPID int `json:"hostPid"`
	// App is the client application name; any application whose name contains it matches.
	App string `json:"app"`
}

const maxFilterLen = 128

// Normalize trims the text filters and rejects values that cannot be valid.
func (o Options) Normalize() (Options, error) {
	o.Login, o.Host, o.App = strings.TrimSpace(o.Login), strings.TrimSpace(o.Host), strings.TrimSpace(o.App)
	for name, v := range map[string]string{"usuario": o.Login, "host": o.Host, "aplicación": o.App} {
		if len([]rune(v)) > maxFilterLen {
			return o, fmt.Errorf("el filtro de %s es demasiado largo (máximo %d caracteres)", name, maxFilterLen)
		}
	}
	if o.HostPID < 0 || o.HostPID > 4294967295 {
		return o, errors.New("el PID del cliente debe ser un número positivo")
	}
	if o.MinDurationMs < 0 {
		o.MinDurationMs = 0
	}
	return o, nil
}

// likeEscape neutralises the wildcard characters of T-SQL LIKE in a literal term.
func likeEscape(s string) string {
	return strings.NewReplacer("[", "[[]", "%", "[%]", "_", "[_]").Replace(s)
}

// textPredicate matches a text field against term, case-insensitively. With
// contains the term may appear anywhere in the value; otherwise the whole value
// must equal it. like is this server's LIKE comparator (see catalog); when the
// server has none, plain equality is used (also case-insensitive in Extended Events).
func textPredicate(field, term string, contains bool, like string) string {
	if like == "" {
		return fmt.Sprintf("%s = %s", field, sqlString(term))
	}
	pattern := likeEscape(term)
	if contains {
		pattern = "%" + pattern + "%"
	}
	return fmt.Sprintf("%s(%s, %s)", like, field, sqlString(pattern))
}

// catalog is what the server's Extended Events offers for predicates. The
// package that holds a comparator differs between builds, so it is looked up
// instead of assumed.
type catalog struct {
	like    string          // qualified case-insensitive LIKE comparator; "" = the server has none
	sources map[string]bool // predicate sources of the sqlserver package, by bare name
	known   bool            // false when the catalog could not be read: assume the usual objects exist
}

// defaultCatalog is used when the server's catalog cannot be read.
func defaultCatalog() catalog {
	return catalog{like: "sqlserver.like_i_sql_unicode_string", sources: map[string]bool{}}
}

func (c catalog) hasSource(name string) bool { return !c.known || c.sources[name] }

// loginSource is the predicate source that holds the login name.
func (c catalog) loginSource() string {
	if c.hasSource("server_principal_name") {
		return "sqlserver.server_principal_name"
	}
	return "sqlserver.username"
}

func loadCatalog(ctx context.Context, conn *sql.DB) catalog {
	rows, err := conn.QueryContext(ctx, `SELECT o.object_type, p.name, o.name
		FROM sys.dm_xe_objects o
		INNER JOIN sys.dm_xe_packages p ON p.guid = o.package_guid
		WHERE (o.object_type = N'pred_compare' AND o.name = N'like_i_sql_unicode_string')
		   OR (o.object_type = N'pred_source' AND p.name = N'sqlserver')`)
	if err != nil {
		return defaultCatalog()
	}
	defer rows.Close()

	cat := catalog{sources: map[string]bool{}}
	for rows.Next() {
		var typ, pkg, name string
		if err := rows.Scan(&typ, &pkg, &name); err != nil {
			return defaultCatalog()
		}
		switch typ {
		case "pred_compare":
			cat.like = pkg + "." + name
		case "pred_source":
			cat.sources[name] = true
		}
	}
	if rows.Err() != nil || len(cat.sources) == 0 {
		return defaultCatalog() // an empty answer means the view was not usable, not that nothing exists
	}
	cat.known = true
	return cat
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
	HostPID    int64  `json:"hostPid"` // process ID of the client program on its machine
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
	opts, err := opts.Normalize()
	if err != nil {
		return nil, err
	}
	cat := loadCatalog(ctx, conn)
	if opts.HostPID > 0 && !cat.hasSource("client_pid") {
		return nil, errors.New("este servidor no permite filtrar por el PID del cliente")
	}
	name, err := NewSessionName("")
	if err != nil {
		return nil, err
	}
	if err := CreateAndStart(ctx, conn, name, buildCreateSQL(name, dbName, appName, opts, cat)); err != nil {
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

func buildCreateSQL(name, dbName, appName string, opts Options, cat catalog) string {
	const actions = "sqlserver.client_app_name, sqlserver.client_hostname, sqlserver.client_pid, sqlserver.database_name, " +
		"sqlserver.server_principal_name, sqlserver.username, sqlserver.session_id"

	base := "sqlserver.database_name = " + sqlString(dbName)
	if !opts.IncludeOwn && appName != "" {
		base += " AND sqlserver.client_app_name <> " + sqlString(appName)
	}
	if opts.Login != "" {
		base += " AND " + textPredicate(cat.loginSource(), opts.Login, false, cat.like)
	}
	if opts.Host != "" {
		base += " AND " + textPredicate("sqlserver.client_hostname", opts.Host, true, cat.like)
	}
	if opts.App != "" {
		base += " AND " + textPredicate("sqlserver.client_app_name", opts.App, true, cat.like)
	}
	if opts.HostPID > 0 {
		base += fmt.Sprintf(" AND sqlserver.client_pid = %d", opts.HostPID)
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
		Login:     firstNonEmpty(actions["server_principal_name"], actions["username"]),
		Host:      actions["client_hostname"],
		HostPID:   parseInt(actions["client_pid"]),
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

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
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
