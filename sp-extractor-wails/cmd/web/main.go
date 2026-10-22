package main

import (
	"archive/zip"
	"context"
	"database/sql"
	"embed"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/extractors"
	"sp-extractor-wails/pkg/db/scriptgen"
)

//go:embed all:dist
var embeddedDist embed.FS

type UserSession struct {
	mu            sync.Mutex
	conn          *sql.DB
	connInfo      db.ConnInfo
	extractor     extractors.Extractor
	lastSeen      time.Time
	queryCancelMu sync.Mutex
	queryCancel   context.CancelFunc
}

type Server struct {
	sessionsMu sync.RWMutex
	sessions   map[string]*UserSession
}

func NewServer() *Server {
	s := &Server{
		sessions: make(map[string]*UserSession),
	}
	go s.cleanupSessions()
	return s
}

func (s *Server) cleanupSessions() {
	ticker := time.NewTicker(10 * time.Minute)
	for range ticker.C {
		s.sessionsMu.Lock()
		now := time.Now()
		for id, sess := range s.sessions {
			sess.mu.Lock()
			if now.Sub(sess.lastSeen) > 2*time.Hour {
				if sess.conn != nil {
					sess.conn.Close()
				}
				delete(s.sessions, id)
			}
			sess.mu.Unlock()
		}
		s.sessionsMu.Unlock()
	}
}

func (s *Server) getSession(r *http.Request) *UserSession {
	sessID := r.Header.Get("X-Session-ID")
	if sessID == "" {
		sessID = "default"
	}

	s.sessionsMu.Lock()
	defer s.sessionsMu.Unlock()

	sess, exists := s.sessions[sessID]
	if !exists {
		sess = &UserSession{
			lastSeen: time.Now(),
		}
		s.sessions[sessID] = sess
	} else {
		sess.lastSeen = time.Now()
	}
	return sess
}

func (s *Server) handleListDatabases(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var info db.ConnInfo
	if err := json.NewDecoder(r.Body).Decode(&info); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	list, err := db.ListDatabases(info)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if list == nil {
		list = []string{}
	}
	writeJSON(w, list)
}

func (s *Server) handleConnect(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	var info db.ConnInfo
	if err := json.NewDecoder(r.Body).Decode(&info); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn != nil {
		sess.conn.Close()
		sess.conn = nil
	}

	conn, err := db.Open(info)
	if err != nil {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("connection failed: %v", err))
		return
	}

	sess.conn = conn
	sess.connInfo = info
	sess.extractor = extractors.New(info.DbType)

	writeJSON(w, map[string]string{"status": "connected"})
}

func (s *Server) handleDisconnect(w http.ResponseWriter, r *http.Request) {
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn != nil {
		sess.conn.Close()
		sess.conn = nil
		sess.extractor = nil
	}
	writeJSON(w, map[string]string{"status": "disconnected"})
}

func (s *Server) handleIsConnected(w http.ResponseWriter, r *http.Request) {
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	connected := false
	if sess.conn != nil {
		connected = sess.conn.Ping() == nil
	}
	writeJSON(w, map[string]bool{"connected": connected})
}

type ListObjectsRequest struct {
	Type  string `json:"type"`
	Term  string `json:"term"`
	Limit int    `json:"limit"`
}

func (s *Server) handleListObjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn == nil || sess.extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req ListObjectsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	t := db.DbObjectType(req.Type)
	objs, err := sess.extractor.ExtractObjects(sess.conn, t, strings.TrimSpace(req.Term), req.Limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if objs == nil {
		objs = []db.DbObject{}
	}
	writeJSON(w, objs)
}

type CountObjectsRequest struct {
	Type string `json:"type"`
	Term string `json:"term"`
}

func (s *Server) handleCountObjects(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn == nil || sess.extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req CountObjectsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	t := db.DbObjectType(req.Type)
	count, err := sess.extractor.CountObjects(sess.conn, t, strings.TrimSpace(req.Term))
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]int{"count": count})
}

func (s *Server) handleGetDefinition(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn == nil || sess.extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var obj db.DbObject
	if err := json.NewDecoder(r.Body).Decode(&obj); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := sess.extractor.FillDefinition(sess.conn, &obj); err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	obj.Definition = dropHeader(obj) + obj.Definition
	writeJSON(w, obj)
}

func (s *Server) handleGetObjectText(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	var obj db.DbObject
	if err := json.NewDecoder(r.Body).Decode(&obj); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	if obj.Definition == "" {
		if sess.conn == nil || sess.extractor == nil {
			writeError(w, http.StatusBadRequest, "not connected")
			return
		}
		if err := sess.extractor.FillDefinition(sess.conn, &obj); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		obj.Definition = dropHeader(obj) + obj.Definition
	}
	text := objectTextWithHeader(obj)
	writeJSON(w, map[string]string{"text": text})
}

type ExecuteQueryRequest struct {
	SQL     string `json:"sql"`
	MaxRows int    `json:"maxRows"`
}

func (s *Server) handleExecuteQuery(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	conn := sess.conn
	sess.mu.Unlock()

	if conn == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req ExecuteQueryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.SQL) == "" {
		writeError(w, http.StatusBadRequest, "empty query")
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	sess.queryCancelMu.Lock()
	sess.queryCancel = cancel
	sess.queryCancelMu.Unlock()
	defer func() {
		cancel()
		sess.queryCancelMu.Lock()
		sess.queryCancel = nil
		sess.queryCancelMu.Unlock()
	}()

	resp, err := runQuery(ctx, conn, req.SQL, req.MaxRows)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, resp)
}

func (s *Server) handleCancelQuery(w http.ResponseWriter, r *http.Request) {
	sess := s.getSession(r)
	sess.queryCancelMu.Lock()
	if sess.queryCancel != nil {
		sess.queryCancel()
		sess.queryCancel = nil
	}
	sess.queryCancelMu.Unlock()
	writeJSON(w, map[string]string{"status": "cancelled"})
}

type SearchTablesRequest struct {
	Term  string `json:"term"`
	Limit int    `json:"limit"`
}

func (s *Server) handleSearchTables(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn == nil || sess.extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req SearchTablesRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if req.Limit <= 0 {
		req.Limit = 100
	}
	tables, err := sess.extractor.SearchTables(sess.conn, req.Term, req.Limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if tables == nil {
		tables = []db.DbObject{}
	}
	writeJSON(w, tables)
}

type SchemaModelRequest struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
	Depth  int    `json:"depth"`
}

func (s *Server) handleGetSchemaModel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn == nil || sess.extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req SchemaModelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	fks, err := sess.extractor.ListForeignKeys(sess.conn)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("error listing foreign keys: %v", err))
		return
	}
	seed := extractors.TableRef{Schema: req.Schema, Name: req.Table}
	model, err := extractors.BuildSchemaModel(sess.conn, fks, seed, req.Depth, func(sName, tName string) ([]db.TableColumn, error) {
		return sess.extractor.TableColumns(sess.conn, sName, tName)
	})
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, model)
}

type TableScriptsRequest struct {
	Schema string `json:"schema"`
	Table  string `json:"table"`
}

func (s *Server) handleGenerateTableScripts(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.conn == nil || sess.extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req TableScriptsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	meta, err := sess.extractor.TableMeta(sess.conn, req.Schema, req.Table)
	if err != nil {
		writeError(w, http.StatusInternalServerError, fmt.Sprintf("error reading table metadata: %v", err))
		return
	}
	if len(meta.Columns) == 0 {
		writeError(w, http.StatusNotFound, fmt.Sprintf("table %s not found or has no columns", req.Table))
		return
	}
	scripts := scriptgen.Generate(sess.connInfo.DbType, meta)
	if scripts == nil {
		scripts = []db.TableScript{}
	}
	writeJSON(w, scripts)
}

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

func (s *Server) handleGenerateInsertScript(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	defer sess.mu.Unlock()

	if sess.connInfo.DbType == "" {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req InsertScriptRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	script, err := scriptgen.GenerateInsert(sess.connInfo.DbType,
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
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, map[string]string{"script": script})
}

type ExportZipRequest struct {
	Objects []db.DbObject `json:"objects"`
}

func (s *Server) handleExportZip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}
	sess := s.getSession(r)
	sess.mu.Lock()
	conn := sess.conn
	extractor := sess.extractor
	sess.mu.Unlock()

	if conn == nil || extractor == nil {
		writeError(w, http.StatusBadRequest, "not connected")
		return
	}

	var req ExportZipRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	filename := fmt.Sprintf("spextractor_%s.zip", time.Now().Format("20060102_150405"))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"", filename))

	zw := zip.NewWriter(w)
	defer zw.Close()

	for _, obj := range req.Objects {
		if obj.Definition == "" {
			if err := extractor.FillDefinition(conn, &obj); err != nil {
				errFileName := sanitizeName(obj.FullName()) + "_ERROR.sql"
				if f, errC := zw.Create(errFileName); errC == nil {
					f.Write([]byte(fmt.Sprintf("-- Error extracting %s: %v\n", obj.FullName(), err)))
				}
				continue
			}
			obj.Definition = dropHeader(obj) + obj.Definition
		}

		safeName := sanitizeName(obj.FullName()) + ".sql"
		f, err := zw.Create(safeName)
		if err != nil {
			continue
		}
		content := obj.Definition
		if content == "" {
			content = "-- No definition available"
		}
		f.Write([]byte(content))
	}
}

func spaHandler(embeddedFS embed.FS) http.Handler {
	fsys, err := fs.Sub(embeddedFS, "dist")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}
	fileServer := http.FileServer(http.FS(fsys))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api") {
			http.NotFound(w, r)
			return
		}

		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}

		f, err := fsys.Open(path)
		if err == nil {
			f.Close()
			fileServer.ServeHTTP(w, r)
			return
		}

		indexFile, err := fsys.Open("index.html")
		if err != nil {
			http.Error(w, "index.html not found", http.StatusNotFound)
			return
		}
		defer indexFile.Close()

		stat, _ := indexFile.Stat()
		http.ServeContent(w, r, "index.html", stat.ModTime(), indexFile.(io.ReadSeeker))
	})
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	server := NewServer()
	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	})

	// API routes
	mux.HandleFunc("/api/list-databases", server.handleListDatabases)
	mux.HandleFunc("/api/connect", server.handleConnect)
	mux.HandleFunc("/api/disconnect", server.handleDisconnect)
	mux.HandleFunc("/api/is-connected", server.handleIsConnected)
	mux.HandleFunc("/api/list-objects", server.handleListObjects)
	mux.HandleFunc("/api/count-objects", server.handleCountObjects)
	mux.HandleFunc("/api/get-definition", server.handleGetDefinition)
	mux.HandleFunc("/api/get-object-text", server.handleGetObjectText)
	mux.HandleFunc("/api/execute-query", server.handleExecuteQuery)
	mux.HandleFunc("/api/cancel-query", server.handleCancelQuery)
	mux.HandleFunc("/api/search-tables", server.handleSearchTables)
	mux.HandleFunc("/api/get-schema-model", server.handleGetSchemaModel)
	mux.HandleFunc("/api/generate-table-scripts", server.handleGenerateTableScripts)
	mux.HandleFunc("/api/generate-insert-script", server.handleGenerateInsertScript)
	mux.HandleFunc("/api/export-zip", server.handleExportZip)

	// Static assets with SPA fallback
	mux.Handle("/", spaHandler(embeddedDist))

	log.Printf("SpExtractor Web server listening on port %s...", port)
	if err := http.ListenAndServe(":"+port, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
