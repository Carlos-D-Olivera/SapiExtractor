package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/config"
	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/extractors"
)

// App is the Wails application struct — all exported methods are available to the frontend.
type App struct {
	ctx       context.Context
	conn      *sql.DB
	connInfo  db.ConnInfo
	extractor extractors.Extractor
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

// ---- Export ----

// ExportRequest carries the parameters for an export operation.
type ExportRequest struct {
	Objects []db.DbObject `json:"objects"`
	OutDir  string        `json:"outDir"`
}

// ExportObjects exports the given objects to OutDir, emitting progress events.
func (a *App) ExportObjects(req ExportRequest) error {
	if a.conn == nil {
		return fmt.Errorf("not connected")
	}
	if err := os.MkdirAll(req.OutDir, 0755); err != nil {
		return fmt.Errorf("cannot create output directory: %w", err)
	}

	total := len(req.Objects)
	for i, obj := range req.Objects {
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
