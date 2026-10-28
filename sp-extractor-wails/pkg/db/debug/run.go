package debug

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-sql/sqlexp"
	mssql "github.com/microsoft/go-mssqldb"

	"sp-extractor-wails/pkg/db/trace"
)

// Request describes one debug run.
type Request struct {
	Schema   string       `json:"schema"`
	Name     string       `json:"name"`
	Params   []ParamInput `json:"params"`
	Rollback bool         `json:"rollback"` // run inside BEGIN TRAN … ROLLBACK
	MaxRows  int          `json:"maxRows"`  // rows kept per result set (0 = 500)
	// TrackData compares the tables the procedure wrote before and after. It
	// needs Rollback, and keeps the transaction (and its locks) open for the few
	// seconds it takes to collect the trace.
	TrackData bool `json:"trackData"`
}

// Hooks lets the caller reuse its own value/type formatting for result sets.
type Hooks struct {
	Format    func(any) *string
	TypeNames func(*sql.Rows) []string
}

// ResultSet is a tabular result produced by the procedure.
type ResultSet struct {
	Columns   []string    `json:"columns"`
	Types     []string    `json:"types"`
	Rows      [][]*string `json:"rows"`
	Truncated bool        `json:"truncated"`
}

// Message is a PRINT / RAISERROR notice or an error raised during the run.
type Message struct {
	Kind   string `json:"kind"` // "info" | "error"
	Text   string `json:"text"`
	Number int32  `json:"number"`
	Line   int32  `json:"line"`
	Proc   string `json:"proc"`
}

// NameValue is an output parameter and its final value.
type NameValue struct {
	Name  string  `json:"name"`
	Value *string `json:"value"`
}

// Result is everything a debug run produced.
type Result struct {
	Steps       []*Step      `json:"steps"`
	Sources     []Source     `json:"sources"`
	Sets        []ResultSet  `json:"sets"`
	Messages    []Message    `json:"messages"`
	ReturnValue *string      `json:"returnValue"`
	Outputs     []NameValue  `json:"outputs"`
	Changes     []DataChange `json:"changes"` // data the run changed, per table (TrackData)
	Failed      bool         `json:"failed"`
	RolledBack  bool         `json:"rolledBack"`
	DurationMs  int64        `json:"durationMs"`
	StepCount   int          `json:"stepCount"`
	Notes       []string     `json:"notes"`
	Batch       string       `json:"batch"` // the T-SQL that was executed
}

const defaultMaxRows = 500

// Run executes the procedure on a dedicated connection while an Extended
// Events session records every statement of that connection.
func Run(ctx context.Context, pool *sql.DB, req Request, h Hooks) (*Result, error) {
	if h.Format == nil {
		h.Format = func(v any) *string {
			if v == nil {
				return nil
			}
			s := fmt.Sprint(v)
			return &s
		}
	}
	if req.MaxRows <= 0 {
		req.MaxRows = defaultMaxRows
	}

	var objectID sql.NullInt64
	if err := pool.QueryRowContext(ctx, `SELECT OBJECT_ID(QUOTENAME(@p1) + N'.' + QUOTENAME(@p2))`, req.Schema, req.Name).Scan(&objectID); err != nil {
		return nil, err
	}
	if !objectID.Valid {
		return nil, fmt.Errorf("no se encontró el procedimiento %s.%s", req.Schema, req.Name)
	}
	params, err := ListParams(ctx, pool, req.Schema, req.Name)
	if err != nil {
		return nil, err
	}
	batch, err := buildBatch(req.Schema, req.Name, params, req.Params)
	if err != nil {
		return nil, err
	}

	conn, err := pool.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	var spid int
	if err := conn.QueryRowContext(ctx, "SELECT @@SPID").Scan(&spid); err != nil {
		return nil, err
	}

	name, err := trace.NewSessionName("dbg")
	if err != nil {
		return nil, err
	}
	if err := trace.CreateAndStart(ctx, pool, name, buildDDL(name, spid)); err != nil {
		return nil, err
	}
	defer func() {
		dctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = trace.Drop(dctx, pool, name)
	}()

	res := &Result{Batch: batch, RolledBack: req.Rollback}
	start := time.Now()
	if req.Rollback {
		if _, err := conn.ExecContext(ctx, "BEGIN TRAN"); err != nil {
			return nil, err
		}
	}
	// Never leave a transaction open on a pooled connection (idempotent).
	rolledBack := false
	rollback := func() {
		if rolledBack {
			return
		}
		rolledBack = true
		cctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = conn.ExecContext(cctx, "IF @@TRANCOUNT > 0 ROLLBACK TRAN")
	}
	defer rollback()

	execBatch(ctx, conn, batch, req.MaxRows, h, res)
	res.DurationMs = time.Since(start).Milliseconds()

	// Comparing data needs the transaction to stay open until the "after" state
	// has been read, so the rollback is postponed in that case.
	track := req.TrackData && req.Rollback
	if !track {
		rollback()
	}

	events, info, err := collectEvents(ctx, pool, name)
	if err != nil {
		res.Notes = append(res.Notes, "No se pudo leer la traza de sentencias: "+err.Error())
	}
	if info.Truncated || info.Dropped > 0 {
		res.Notes = append(res.Notes, "El buffer de la traza se llenó: faltan las sentencias más antiguas o algunas se perdieron.")
	}

	if track {
		changes, notes := trackChanges(ctx, conn, rollback, req.Schema, events)
		res.Changes = changes
		res.Notes = append(res.Notes, notes...)
		rollback()
	}

	srcs := loadSources(ctx, pool, events)
	for _, s := range srcs {
		res.Sources = append(res.Sources, s.Source)
	}
	steps, cut := build(events, srcs)
	res.Steps, res.StepCount = steps, len(events)
	if cut {
		res.Notes = append(res.Notes, fmt.Sprintf("Se muestran solo las primeras %d sentencias.", MaxSteps))
	}
	extractReturn(res)
	return res, nil
}

func buildDDL(name string, spid int) string {
	return fmt.Sprintf(`CREATE EVENT SESSION [%s] ON SERVER
ADD EVENT sqlserver.sp_statement_completed (WHERE (sqlserver.session_id = %d)),
ADD EVENT sqlserver.error_reported (WHERE (sqlserver.session_id = %d))
ADD TARGET package0.ring_buffer (SET max_memory = 32768)
WITH (MAX_MEMORY = 40960 KB, EVENT_RETENTION_MODE = ALLOW_SINGLE_EVENT_LOSS, MAX_DISPATCH_LATENCY = 1 SECONDS,
      MEMORY_PARTITION_MODE = NONE, TRACK_CAUSALITY = OFF, STARTUP_STATE = OFF)`, name, spid, spid)
}

// execBatch runs the batch and gathers result sets, PRINT output and errors in
// the order the server sends them.
func execBatch(ctx context.Context, conn *sql.Conn, batch string, maxRows int, h Hooks, res *Result) {
	msgs := &sqlexp.ReturnMessage{}
	rows, err := conn.QueryContext(ctx, batch, msgs)
	if err != nil {
		res.Failed = true
		res.Messages = append(res.Messages, errorMessage(err))
		return
	}
	defer rows.Close()

	for active := true; active; {
		switch m := msgs.Message(ctx).(type) {
		case sqlexp.MsgNotice:
			res.Messages = append(res.Messages, noticeMessage(m.Message))
		case sqlexp.MsgError:
			res.Failed = true
			res.Messages = append(res.Messages, errorMessage(m.Error))
		case sqlexp.MsgNext:
			cols, err := rows.Columns()
			if err != nil {
				continue
			}
			set := ResultSet{Columns: cols, Rows: [][]*string{}}
			if h.TypeNames != nil {
				set.Types = h.TypeNames(rows)
			}
			for rows.Next() {
				vals := make([]any, len(cols))
				ptrs := make([]any, len(cols))
				for i := range vals {
					ptrs[i] = &vals[i]
				}
				if err := rows.Scan(ptrs...); err != nil {
					break
				}
				if len(set.Rows) >= maxRows {
					set.Truncated = true
					continue // keep draining so the stream advances
				}
				row := make([]*string, len(cols))
				for i, v := range vals {
					row[i] = h.Format(v)
				}
				set.Rows = append(set.Rows, row)
			}
			res.Sets = append(res.Sets, set)
		case sqlexp.MsgNextResultSet:
			active = rows.NextResultSet()
		}
	}
	if ctx.Err() != nil {
		res.Failed = true
		res.Messages = append(res.Messages, Message{Kind: "error", Text: "Ejecución cancelada."})
	}
}

func noticeMessage(s fmt.Stringer) Message {
	m := Message{Kind: "info", Text: s.String()}
	if e, ok := s.(mssql.Error); ok {
		m.Number, m.Line, m.Proc = e.Number, e.LineNo, e.ProcName
	}
	return m
}

func errorMessage(err error) Message {
	m := Message{Kind: "error", Text: err.Error()}
	var me mssql.Error
	if errors.As(err, &me) {
		m.Text, m.Number, m.Line, m.Proc = me.Message, me.Number, me.LineNo, me.ProcName
	}
	return m
}

// extractReturn moves the trailing return-value / output-parameter result set
// out of Sets into ReturnValue and Outputs.
func extractReturn(res *Result) {
	for i, set := range res.Sets {
		if len(set.Columns) == 0 || set.Columns[0] != returnValueColumn || len(set.Rows) == 0 {
			continue
		}
		row := set.Rows[0]
		res.ReturnValue = row[0]
		for c := 1; c < len(set.Columns) && c < len(row); c++ {
			res.Outputs = append(res.Outputs, NameValue{Name: set.Columns[c], Value: row[c]})
		}
		res.Sets = append(res.Sets[:i], res.Sets[i+1:]...)
		return
	}
}

// collectEvents reads the ring buffer until the event count stops changing:
// Extended Events dispatches to its targets with up to one second of latency.
func collectEvents(ctx context.Context, pool *sql.DB, name string) ([]rawEvent, bufferInfo, error) {
	var (
		events []rawEvent
		info   bufferInfo
		prev   = -1
	)
	for _, wait := range []time.Duration{1300, 600, 600, 800, 800} {
		select {
		case <-time.After(wait * time.Millisecond):
		case <-ctx.Done():
			return events, info, ctx.Err()
		}
		doc, err := trace.ReadRingBuffer(ctx, pool, name)
		if err != nil {
			return events, info, err
		}
		if doc == "" {
			continue
		}
		events, info, err = parseEvents(doc)
		if err != nil {
			return nil, info, err
		}
		if len(events) == prev {
			break
		}
		prev = len(events)
	}
	return events, info, nil
}

// loadSources fetches the text of every module that appears in the events, so
// statement offsets can be mapped to source lines.
func loadSources(ctx context.Context, pool *sql.DB, events []rawEvent) map[string]*srcInfo {
	out := map[string]*srcInfo{}
	var curDB int64
	if err := pool.QueryRowContext(ctx, "SELECT DB_ID()").Scan(&curDB); err != nil {
		return out
	}
	for _, e := range events {
		if e.Kind != "stmt" || e.ObjectID <= 0 || (e.DBID != 0 && e.DBID != curDB) {
			continue
		}
		key := strconv.FormatInt(e.ObjectID, 10)
		if _, done := out[key]; done {
			continue
		}
		var def, name sql.NullString
		if err := pool.QueryRowContext(ctx,
			`SELECT OBJECT_DEFINITION(@p1), OBJECT_SCHEMA_NAME(@p1) + N'.' + OBJECT_NAME(@p1)`, e.ObjectID).Scan(&def, &name); err != nil || !def.Valid {
			continue
		}
		out[key] = &srcInfo{
			Source: Source{Key: key, Name: name.String, Text: def.String},
			idx:    newSrcIndex(def.String),
		}
	}
	return out
}
