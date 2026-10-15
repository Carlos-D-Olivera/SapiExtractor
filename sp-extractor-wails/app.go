package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/config"
	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/extractors"
)

// App is the Wails application struct — all exported methods are available to the frontend.
type App struct {
	ctx            context.Context
	conn           *sql.DB
	connInfo       db.ConnInfo
	extractor      extractors.Extractor
	exportCancelMu sync.Mutex
	exportCancel   context.CancelFunc
}

// NewApp creates a new App instance.
func NewApp() *App {
	return &App{}
}

// startup is called by Wails when the application starts.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// shutdown is called by Wails when the application closes.
func (a *App) shutdown(ctx context.Context) {
	a.Disconnect()
}

// ---- Connection Management ----

// ListDatabases connects to the server (no specific DB) and returns available databases.
func (a *App) ListDatabases(info db.ConnInfo) ([]string, error) {
	return db.ListDatabases(info)
}

// Connect opens a persistent connection to the specified database.
func (a *App) Connect(info db.ConnInfo) error {
	if a.conn != nil {
		a.conn.Close()
		a.conn = nil
	}
	conn, err := db.Open(info)
	if err != nil {
		return fmt.Errorf("connection failed: %w", err)
	}
	a.conn = conn
	a.connInfo = info
	a.extractor = extractors.New(info.DbType)
	return nil
}

// Disconnect closes the current connection.
func (a *App) Disconnect() {
	if a.conn != nil {
		a.conn.Close()
		a.conn = nil
		a.extractor = nil
	}
}

// IsConnected returns whether a database connection is currently active.
func (a *App) IsConnected() bool {
	if a.conn == nil {
		return false
	}
	return a.conn.Ping() == nil
}

// ---- Object Extraction ----

// ListObjects returns all database objects of the given type.
func (a *App) ListObjects(objType string) ([]db.DbObject, error) {
	if a.conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	t := db.DbObjectType(objType)
	return a.extractor.ExtractObjects(a.conn, t)
}

// GetDefinition fills and returns the definition for a single DbObject.
func (a *App) GetDefinition(obj db.DbObject) (db.DbObject, error) {
	if a.conn == nil {
		return obj, fmt.Errorf("not connected")
	}
	if err := a.extractor.FillDefinition(a.conn, &obj); err != nil {
		return obj, err
	}
	return obj, nil
}

// GetObjectText returns the definition of an object preceded by a DROP-if-exists
// header (matching the old Java behaviour for copy / save-as / open-in-editor).
// If the object carries no definition yet, it is fetched from the database.
func (a *App) GetObjectText(obj db.DbObject) (string, error) {
	if obj.Definition == "" {
		if a.conn == nil {
			return "", fmt.Errorf("not connected")
		}
		if err := a.extractor.FillDefinition(a.conn, &obj); err != nil {
			return "", err
		}
	}
	return objectTextWithHeader(obj), nil
}

// SaveObject opens a native save dialog and writes the object (with DROP header)
// to the chosen .sql file. Returns the saved path, or "" if the dialog was cancelled.
func (a *App) SaveObject(obj db.DbObject) (string, error) {
	text, err := a.GetObjectText(obj)
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

// OpenObject writes the object (with DROP header) to a temp file and opens it
// with the system default application (e.g. SQL Server Management Studio).
func (a *App) OpenObject(obj db.DbObject) error {
	text, err := a.GetObjectText(obj)
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

// ExportObjects exports the given objects to OutDir, emitting progress events.
// The operation can be cancelled via CancelExport.
func (a *App) ExportObjects(req ExportRequest) error {
	if a.conn == nil {
		return fmt.Errorf("not connected")
	}
	if err := os.MkdirAll(req.OutDir, 0755); err != nil {
		return fmt.Errorf("cannot create output directory: %w", err)
	}

	ctx, cancel := context.WithCancel(a.ctx)
	a.exportCancelMu.Lock()
	a.exportCancel = cancel
	a.exportCancelMu.Unlock()
	defer func() {
		cancel()
		a.exportCancelMu.Lock()
		a.exportCancel = nil
		a.exportCancelMu.Unlock()
	}()

	total := len(req.Objects)
	for i, obj := range req.Objects {
		select {
		case <-ctx.Done():
			runtime.EventsEmit(a.ctx, "export:cancelled", map[string]interface{}{
				"current": i,
				"total":   total,
			})
			return nil
		default:
		}

		// Lazy-load definition
		if obj.Definition == "" {
			if err := a.extractor.FillDefinition(a.conn, &obj); err != nil {
				runtime.EventsEmit(a.ctx, "export:error", map[string]interface{}{
					"name":  obj.FullName(),
					"error": err.Error(),
				})
				continue
			}
			req.Objects[i] = obj
		}

		// Write file
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
			"current": i + 1,
			"total":   total,
			"name":    obj.FullName(),
			"percent": pct,
		})
	}

	runtime.EventsEmit(a.ctx, "export:done", map[string]interface{}{
		"total":  total,
		"outDir": req.OutDir,
	})
	return nil
}

// CancelExport aborts an in-progress export operation.
func (a *App) CancelExport() {
	a.exportCancelMu.Lock()
	defer a.exportCancelMu.Unlock()
	if a.exportCancel != nil {
		a.exportCancel()
		a.exportCancel = nil
	}
}

// PickDirectory opens a native folder-picker dialog.
func (a *App) PickDirectory() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Select output folder",
	})
	return path, err
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

// ---- Helpers ----

var illegalRunes = []string{"\\", "/", ":", "*", "?", "\"", "<", ">", "|"}

func sanitizeName(name string) string {
	for _, c := range illegalRunes {
		name = strings.ReplaceAll(name, c, "_")
	}
	return strings.TrimSpace(name)
}

// bracketName renders [schema].[name] the way SQL Server scripts expect it.
func bracketName(obj db.DbObject) string {
	if obj.Schema == "" {
		return fmt.Sprintf("[%s]", obj.Name)
	}
	return fmt.Sprintf("[%s].[%s]", obj.Schema, obj.Name)
}

// dropHeader builds the IF EXISTS ... DROP ... GO preamble for an object type.
// Returns "" for COLUMN (its script already embeds the guards).
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

// objectTextWithHeader prepends the DROP header to the definition (parity with
// the Java MainFrame.getObjectTextWithHeader).
func objectTextWithHeader(obj db.DbObject) string {
	def := obj.Definition
	if def == "" {
		def = "-- No definition available"
	}
	return dropHeader(obj) + def
}

// defaultFileName builds the yyyyMMdd_<prefix>_<schema>_<name>.sql name used by
// "Guardar como" and "Abrir en SQL Server" in the old Java UI.
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
