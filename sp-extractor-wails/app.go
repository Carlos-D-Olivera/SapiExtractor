package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/config"
	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/extractors"
	"sp-extractor-wails/pkg/db/scriptgen"
	"sp-extractor-wails/pkg/store"
	"sp-extractor-wails/pkg/update"
)

// WorkspaceSession holds the state and active database connection for an individual workspace.
type WorkspaceSession struct {
	conn           *sql.DB
	connInfo       db.ConnInfo
	extractor      extractors.Extractor
	exportCancelMu sync.Mutex
	exportCancel   context.CancelFunc
	queryCancelMu  sync.Mutex
	queryCancel    context.CancelFunc
	traceMu        sync.Mutex
	trace          *activeTrace
}

// App is the Wails application struct — all exported methods are available to the frontend.
type App struct {
	ctx      context.Context
	sessMu   sync.RWMutex
	sessions map[string]*WorkspaceSession
	store    *store.Store // per-database tabs, query history and the saved session
}

// NewApp creates a new App instance with multi-workspace support.
func NewApp() *App {
	app := &App{
		sessions: make(map[string]*WorkspaceSession),
	}
	dir, err := store.DefaultDir()
	if err != nil {
		dir = filepath.Join(os.TempDir(), "spextractor") // no home directory: keep working, just not persistently
	}
	app.store = store.New(dir)
	return app
}

// startup is called by Wails when the application starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// A previous update leaves the old executable next to the new one.
	if exe, err := update.Executable(); err == nil {
		go update.CleanupLeftovers(exe)
	}
}

// shutdown is called by Wails when the application closes.
func (a *App) shutdown(ctx context.Context) {
	a.sessMu.Lock()
	defer a.sessMu.Unlock()
	for _, s := range a.sessions {
		if s != nil && s.conn != nil {
			s.stopTrace() // drop the server-side event session before closing
			s.conn.Close()
		}
	}
	a.sessions = make(map[string]*WorkspaceSession)
}

func (a *App) getOrCreateSession(wsID string) *WorkspaceSession {
	if wsID == "" {
		wsID = "1"
	}
	a.sessMu.Lock()
	defer a.sessMu.Unlock()
	s, ok := a.sessions[wsID]
	if !ok {
		s = &WorkspaceSession{}
		a.sessions[wsID] = s
	}
	return s
}

func (a *App) getSession(wsID string) (*WorkspaceSession, error) {
	if wsID == "" {
		wsID = "1"
	}
	a.sessMu.RLock()
	defer a.sessMu.RUnlock()
	s, ok := a.sessions[wsID]
	if !ok || s == nil || s.conn == nil {
		return nil, fmt.Errorf("espacio de trabajo %s no conectado", wsID)
	}
	return s, nil
}

// ---- Connection Management ----

// ListDatabases connects to the server (no specific DB) and returns available databases.
func (a *App) ListDatabases(info db.ConnInfo) ([]string, error) {
	return db.ListDatabases(info)
}

// Connect opens a persistent connection to the specified database for the given workspace.
func (a *App) Connect(wsID string, info db.ConnInfo) error {
	s := a.getOrCreateSession(wsID)
	if s.conn != nil {
		s.stopTrace()
		s.conn.Close()
		s.conn = nil
	}
	conn, err := db.Open(info)
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	s.conn = conn
	s.connInfo = info
	s.extractor = extractors.New(info.DbType)
	return nil
}

// Disconnect closes the current connection for the specified workspace.
func (a *App) Disconnect(wsID string) {
	a.sessMu.Lock()
	defer a.sessMu.Unlock()
	if s, ok := a.sessions[wsID]; ok && s != nil {
		if s.conn != nil {
			s.stopTrace()
			s.conn.Close()
			s.conn = nil
		}
		s.extractor = nil
	}
}

// IsConnected returns whether a database connection is currently active for the workspace.
func (a *App) IsConnected(wsID string) bool {
	s, err := a.getSession(wsID)
	if err != nil || s.conn == nil {
		return false
	}
	return s.conn.Ping() == nil
}

// ---- Object Extraction ----

// ListObjects returns database objects of the given type for the workspace.
func (a *App) ListObjects(wsID, objType, term string, limit int) ([]db.DbObject, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return nil, err
	}
	t := db.DbObjectType(objType)
	return s.extractor.ExtractObjects(s.conn, t, strings.TrimSpace(term), limit)
}

// CountObjects returns the total number of objects of the given type for the workspace.
func (a *App) CountObjects(wsID, objType, term string) (int, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return 0, err
	}
	t := db.DbObjectType(objType)
	return s.extractor.CountObjects(s.conn, t, strings.TrimSpace(term))
}

// GetDefinition fills and returns the definition for a single DbObject in the workspace.
func (a *App) GetDefinition(wsID string, obj db.DbObject) (db.DbObject, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return obj, err
	}
	if err := s.extractor.FillDefinition(s.conn, &obj); err != nil {
		return obj, err
	}
	obj.Definition = dropHeader(obj) + obj.Definition
	return obj, nil
}

// GetObjectText returns the script text used for copy / save-as / open-in-editor.
func (a *App) GetObjectText(wsID string, obj db.DbObject) (string, error) {
	if obj.Definition == "" {
		s, err := a.getSession(wsID)
		if err != nil {
			return "", err
		}
		if err := s.extractor.FillDefinition(s.conn, &obj); err != nil {
			return "", err
		}
		obj.Definition = dropHeader(obj) + obj.Definition
	}
	return objectTextWithHeader(obj), nil
}

// SaveObject opens a native save dialog and writes the object (with DROP header) to the chosen .sql file.
func (a *App) SaveObject(wsID string, obj db.DbObject) (string, error) {
	text, err := a.GetObjectText(wsID, obj)
	if err != nil {
		return "", err
	}
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Guardar como",
		DefaultFilename: defaultFileName(obj),
		Filters: []runtime.FileFilter{
			{DisplayName: "SQL Server Script (*.sql)", Pattern: "*.sql"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".sql") {
		path += ".sql"
	}
	if err := os.WriteFile(path, []byte(text), 0644); err != nil {
		return "", fmt.Errorf("error writing %s: %w", path, err)
	}
	return path, nil
}

// OpenObject writes the object (with DROP header) to a temp file and opens it.
func (a *App) OpenObject(wsID string, obj db.DbObject) error {
	text, err := a.GetObjectText(wsID, obj)
	if err != nil {
		return err
	}
	prefix := sanitizeName(strings.TrimSuffix(defaultFileName(obj), ".sql")) + "_"
	if len(prefix) < 3 {
		prefix = "obj_temp_"
	}
	f, err := os.CreateTemp("", prefix+"*.sql")
	if err != nil {
		return err
	}
	if _, err := f.WriteString(text); err != nil {
		f.Close()
		return err
	}
	f.Close()
	return exec.Command("cmd", "/c", "start", "", f.Name()).Start()
}

// ---- Export ----

// ExportRequest carries the parameters for an export operation.
type ExportRequest struct {
	Objects []db.DbObject `json:"objects"`
	OutDir  string        `json:"outDir"`
}

// ExportObjects exports the given objects to OutDir, emitting progress events tagged with the workspaceId.
func (a *App) ExportObjects(wsID string, req ExportRequest) error {
	s, err := a.getSession(wsID)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(req.OutDir, 0755); err != nil {
		return fmt.Errorf("cannot create output directory: %w", err)
	}

	ctx, cancel := context.WithCancel(a.ctx)
	s.exportCancelMu.Lock()
	s.exportCancel = cancel
	s.exportCancelMu.Unlock()
	defer func() {
		cancel()
		s.exportCancelMu.Lock()
		s.exportCancel = nil
		s.exportCancelMu.Unlock()
	}()

	total := len(req.Objects)
	for i, obj := range req.Objects {
		select {
		case <-ctx.Done():
			runtime.EventsEmit(a.ctx, "export:cancelled", map[string]interface{}{
				"workspaceId": wsID,
				"current":     i,
				"total":       total,
			})
			return nil
		default:
		}

		if obj.Definition == "" {
			if err := s.extractor.FillDefinition(s.conn, &obj); err != nil {
				runtime.EventsEmit(a.ctx, "export:error", map[string]interface{}{
					"workspaceId": wsID,
					"name":        obj.FullName(),
					"error":       err.Error(),
				})
				continue
			}
			obj.Definition = dropHeader(obj) + obj.Definition
			req.Objects[i] = obj
		}

		safeName := sanitizeName(obj.FullName())
		filePath := fmt.Sprintf("%s/%s.sql", req.OutDir, safeName)
		content := obj.Definition
		if content == "" {
			content = "-- No definition available"
		}
		if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
			return fmt.Errorf("error writing %s: %w", filePath, err)
		}

		pct := int(float64(i+1) / float64(total) * 100)
		runtime.EventsEmit(a.ctx, "export:progress", map[string]interface{}{
			"workspaceId": wsID,
			"current":     i + 1,
			"total":       total,
			"name":        obj.FullName(),
			"percent":     pct,
		})
	}

	runtime.EventsEmit(a.ctx, "export:done", map[string]interface{}{
		"workspaceId": wsID,
		"total":       total,
		"outDir":      req.OutDir,
	})
	return nil
}

// CancelExport aborts an in-progress export operation for the workspace.
func (a *App) CancelExport(wsID string) {
	if s, err := a.getSession(wsID); err == nil {
		s.exportCancelMu.Lock()
		defer s.exportCancelMu.Unlock()
		if s.exportCancel != nil {
			s.exportCancel()
			s.exportCancel = nil
		}
	}
}

// PickDirectory opens a native folder-picker dialog.
func (a *App) PickDirectory() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select output folder",
	})
	return path, err
}

// ---- Query Execution ----

// ResultSet is a single tabular result produced by a SQL statement.
type ResultSet struct {
	Columns   []string    `json:"columns"`
	Types     []string    `json:"types"`
	Rows      [][]*string `json:"rows"`
	Truncated bool        `json:"truncated"`
}

// QueryResponse is the outcome of executing one or more SQL statements.
type QueryResponse struct {
	Sets       []ResultSet `json:"sets"`
	Message    string      `json:"message"`
	DurationMs int64       `json:"durationMs"`
	RowCount   int         `json:"rowCount"`
}

// ExecuteQuery runs an arbitrary SQL statement/script against the workspace connection.
func (a *App) ExecuteQuery(wsID, sqlText string, maxRows int) (QueryResponse, error) {
	start := time.Now()
	resp, err := a.executeQuery(wsID, sqlText, maxRows)
	a.recordHistory(wsID, sqlText, resp, err, time.Since(start))
	return resp, err
}

func (a *App) executeQuery(wsID, sqlText string, maxRows int) (QueryResponse, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return QueryResponse{}, err
	}
	if strings.TrimSpace(sqlText) == "" {
		return QueryResponse{}, fmt.Errorf("empty query")
	}

	ctx, cancel := context.WithCancel(a.ctx)
	s.queryCancelMu.Lock()
	s.queryCancel = cancel
	s.queryCancelMu.Unlock()
	defer func() {
		cancel()
		s.queryCancelMu.Lock()
		s.queryCancel = nil
		s.queryCancelMu.Unlock()
	}()

	start := time.Now()
	resp := QueryResponse{Sets: []ResultSet{}}

	// GO is a client-side batch separator (SSMS), not T-SQL: run each batch on its own.
	batches := splitBatches(sqlText)
	if len(batches) == 0 {
		return resp, fmt.Errorf("empty query")
	}
	var affected int64
	var dmlBatches int
	for i, batch := range batches {
		n, isDML, err := runBatch(ctx, s.conn, batch, maxRows, &resp)
		if err != nil {
			if len(batches) > 1 {
				return resp, fmt.Errorf("lote %d de %d: %w", i+1, len(batches), err)
			}
			return resp, err
		}
		if isDML {
			dmlBatches++
			if n > 0 {
				affected += n
			}
		}
	}

	resp.DurationMs = time.Since(start).Milliseconds()
	switch {
	case len(resp.Sets) > 0:
		resp.Message = fmt.Sprintf("%d conjunto(s) de resultados, %d fila(s).", len(resp.Sets), resp.RowCount)
	case dmlBatches > 0 && dmlBatches == len(batches):
		resp.Message = fmt.Sprintf("%d fila(s) afectada(s).", affected)
	case len(batches) > 1:
		resp.Message = fmt.Sprintf("%d lote(s) ejecutado(s) correctamente.", len(batches))
	default:
		resp.Message = "Comando ejecutado correctamente."
	}
	return resp, nil
}

// runBatch executes one batch and appends any result sets to resp. For a plain
// INSERT/UPDATE/DELETE/MERGE it uses Exec and returns the rows affected.
func runBatch(ctx context.Context, conn *sql.DB, sqlText string, maxRows int, resp *QueryResponse) (affected int64, isDML bool, err error) {
	if isPlainDML(sqlText) {
		res, err := conn.ExecContext(ctx, sqlText)
		if err != nil {
			return 0, true, err
		}
		n, nerr := res.RowsAffected()
		if nerr != nil {
			n = -1
		}
		return n, true, nil
	}

	rows, err := conn.QueryContext(ctx, sqlText)
	if err != nil {
		return 0, false, err
	}
	defer rows.Close()

	for {
		cols, err := rows.Columns()
		if err != nil {
			return 0, false, err
		}
		if len(cols) > 0 {
			set := ResultSet{Columns: cols, Types: columnTypeNames(rows), Rows: [][]*string{}}
			for rows.Next() {
				if maxRows > 0 && len(set.Rows) >= maxRows {
					set.Truncated = true
					break
				}
				vals := make([]any, len(cols))
				ptrs := make([]any, len(cols))
				for i := range vals {
					ptrs[i] = &vals[i]
				}
				if err := rows.Scan(ptrs...); err != nil {
					return 0, false, err
				}
				row := make([]*string, len(cols))
				for i, v := range vals {
					row[i] = valueToString(v)
				}
				set.Rows = append(set.Rows, row)
			}
			if err := rows.Err(); err != nil {
				return 0, false, err
			}
			resp.Sets = append(resp.Sets, set)
			resp.RowCount += len(set.Rows)
		}
		if !rows.NextResultSet() {
			break
		}
	}
	return 0, false, nil
}

var (
	dmlStart   = regexp.MustCompile(`(?i)^(insert|update|delete|merge)\b`)
	dmlOutput  = regexp.MustCompile(`(?i)\b(output|returning)\b`)
	sqlComment = regexp.MustCompile(`^(\s+|--[^\n]*(\n|$)|(?s:/\*.*?\*/))+`)
)

func isPlainDML(sqlText string) bool {
	s := sqlComment.ReplaceAllString(sqlText, "")
	s = strings.TrimRight(s, " \t\r\n;")
	return dmlStart.MatchString(s) && !strings.Contains(s, ";") && !dmlOutput.MatchString(s)
}

// CancelQuery aborts an in-progress query execution for the workspace.
func (a *App) CancelQuery(wsID string) {
	if s, err := a.getSession(wsID); err == nil {
		s.queryCancelMu.Lock()
		defer s.queryCancelMu.Unlock()
		if s.queryCancel != nil {
			s.queryCancel()
			s.queryCancel = nil
		}
	}
}

func columnTypeNames(rows *sql.Rows) []string {
	types, err := rows.ColumnTypes()
	if err != nil {
		return nil
	}
	names := make([]string, len(types))
	for i, ct := range types {
		names[i] = ct.DatabaseTypeName()
	}
	return names
}

func valueToString(v any) *string {
	if v == nil {
		return nil
	}
	var s string
	switch t := v.(type) {
	case []byte:
		s = string(t)
	case string:
		s = t
	case time.Time:
		s = t.Format("2006-01-02 15:04:05.999")
	default:
		s = fmt.Sprint(t)
	}
	return &s
}

// ---- Schema / relationship model ----

// SearchTables returns tables whose name contains term for the workspace.
func (a *App) SearchTables(wsID, term string, limit int) ([]db.DbObject, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 100
	}
	return s.extractor.SearchTables(s.conn, term, limit)
}

// GetSchemaModel builds the foreign-key graph around a seed table for the workspace.
func (a *App) GetSchemaModel(wsID, schema, table string, depth int) (db.SchemaModel, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return db.SchemaModel{}, err
	}
	fks, err := s.extractor.ListForeignKeys(s.conn)
	if err != nil {
		return db.SchemaModel{}, fmt.Errorf("error listing foreign keys: %w", err)
	}
	seed := extractors.TableRef{Schema: schema, Name: table}
	return extractors.BuildSchemaModel(s.conn, fks, seed, depth, func(sch, t string) ([]db.TableColumn, error) {
		return s.extractor.TableColumns(s.conn, sch, t)
	})
}

// GenerateTableScripts builds DDL and DML templates for a table in the workspace.
func (a *App) GenerateTableScripts(wsID, schema, table string) ([]db.TableScript, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return nil, err
	}
	meta, err := s.extractor.TableMeta(s.conn, schema, table)
	if err != nil {
		return nil, fmt.Errorf("error reading table metadata: %w", err)
	}
	if len(meta.Columns) == 0 {
		return nil, fmt.Errorf("table %s not found or has no columns", table)
	}
	return scriptgen.Generate(s.connInfo.DbType, meta), nil
}

// InsertScriptRequest carries a query result plus the options needed to turn it into an INSERT script.
type InsertScriptRequest struct {
	Schema         string      `json:"schema"`
	Table          string      `json:"table"`
	Columns        []string    `json:"columns"`
	Types          []string    `json:"types"`
	Rows           [][]*string `json:"rows"`
	DetectTypes    bool        `json:"detectTypes"`
	BatchSize      int         `json:"batchSize"`
	IdentityInsert bool        `json:"identityInsert"`
	DeleteFirst    bool        `json:"deleteFirst"`
}

// GenerateInsertScript renders INSERT statements reproducing the given rows.
func (a *App) GenerateInsertScript(wsID string, req InsertScriptRequest) (string, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return "", err
	}
	if s.connInfo.DbType == "" {
		return "", fmt.Errorf("not connected")
	}
	return scriptgen.GenerateInsert(s.connInfo.DbType,
		scriptgen.InsertData{
			Schema:  req.Schema,
			Table:   req.Table,
			Columns: req.Columns,
			Types:   req.Types,
			Rows:    req.Rows,
		},
		scriptgen.InsertOptions{
			DetectTypes:    req.DetectTypes,
			BatchSize:      req.BatchSize,
			IdentityInsert: req.IdentityInsert,
			DeleteFirst:    req.DeleteFirst,
		})
}

// SaveScript opens a native save dialog and writes text to the chosen .sql file.
func (a *App) SaveScript(defaultName, text string) (string, error) {
	path, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Guardar script",
		DefaultFilename: defaultName,
		Filters:         []runtime.FileFilter{{DisplayName: "SQL (*.sql)", Pattern: "*.sql"}},
	})
	if err != nil || path == "" {
		return "", err
	}
	if !strings.HasSuffix(strings.ToLower(path), ".sql") {
		path += ".sql"
	}
	if err := os.WriteFile(path, []byte(text), 0644); err != nil {
		return "", fmt.Errorf("error writing %s: %w", path, err)
	}
	return path, nil
}

// ---- Saved Connections ----

// LoadConnections returns the saved connection history.
func (a *App) LoadConnections() ([]config.SavedConnection, error) {
	return config.LoadConnections()
}

// SaveConnection persists a connection to history.
func (a *App) SaveConnection(conn config.SavedConnection) error {
	return config.SaveConnection(conn)
}

// DeleteConnection removes a connection from history.
func (a *App) DeleteConnection(conn config.SavedConnection) error {
	return config.DeleteConnection(conn)
}

// ---- AutoCompletes ----

// LoadAutoCompletes returns the saved autocompletes snippets from ~/.spextractor/autocompletes.json.
func (a *App) LoadAutoCompletes() ([]config.AutoCompleteItem, error) {
	return config.LoadAutoCompletes()
}

// SaveAutoCompletes persists the autocompletes snippets to ~/.spextractor/autocompletes.json.
func (a *App) SaveAutoCompletes(items []config.AutoCompleteItem) error {
	return config.SaveAutoCompletes(items)
}

// ---- Helpers ----

var illegalRunes = []string{"\\", "/", ":", "*", "?", "\"", "<", ">", "|"}

func sanitizeName(name string) string {
	for _, c := range illegalRunes {
		name = strings.ReplaceAll(name, c, "_")
	}
	return strings.TrimSpace(name)
}

func bracketName(obj db.DbObject) string {
	if obj.Schema == "" {
		return fmt.Sprintf("[%s]", obj.Name)
	}
	return fmt.Sprintf("[%s].[%s]", obj.Schema, obj.Name)
}

func dropHeader(obj db.DbObject) string {
	if obj.Type == db.Column {
		return ""
	}
	fullName := bracketName(obj)
	var cond, keyword string
	switch obj.Type {
	case db.StoredProcedure:
		cond = "OBJECTPROPERTY(id, N'IsProcedure') = 1"
		keyword = "PROCEDURE"
	case db.Table:
		cond = "OBJECTPROPERTY(id, N'IsUserTable') = 1"
		keyword = "TABLE"
	case db.View:
		cond = "OBJECTPROPERTY(id, N'IsView') = 1"
		keyword = "VIEW"
	case db.Function:
		cond = "(OBJECTPROPERTY(id, N'IsScalarFunction') = 1 OR OBJECTPROPERTY(id, N'IsTableFunction') = 1)"
		keyword = "FUNCTION"
	case db.Trigger:
		cond = "OBJECTPROPERTY(id, N'IsTrigger') = 1"
		keyword = "TRIGGER"
	default:
		return ""
	}
	return fmt.Sprintf(
		"IF EXISTS (SELECT * FROM dbo.sysobjects WHERE id = OBJECT_ID(N'%s') AND %s)\nBEGIN\n    DROP %s %s \nEND\nGO\n\n",
		fullName, cond, keyword, fullName)
}

func objectTextWithHeader(obj db.DbObject) string {
	def := obj.Definition
	if def == "" {
		def = "-- No definition available"
	}
	header := dropHeader(obj)
	if header != "" && !strings.HasPrefix(def, header) {
		return header + def
	}
	return def
}

func defaultFileName(obj db.DbObject) string {
	date := time.Now().Format("20060102")
	var namePart string
	if obj.Type == db.Column {
		namePart = fmt.Sprintf("%s.%s_%s", obj.Schema, obj.ParentName, obj.Name)
	} else {
		namePart = fmt.Sprintf("%s.%s", obj.Schema, obj.Name)
	}
	return sanitizeName(fmt.Sprintf("%s_%s_%s.sql", date, obj.Type.FilePrefix(), namePart))
}
