// Package store persists the user's working state under ~/.spextractor:
//
//   - per database: the open query tabs, the recently closed ones and the
//     history of executed queries;
//   - per app: the session (which connection each workspace had) and settings.
//
// Only SQL text is stored, never result rows. Trace events are not stored.
package store

import (
	"bufio"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"sp-extractor-wails/pkg/db"
)

// Limits that keep the files small.
const (
	MaxClosedTabs    = 50
	MaxTabSQLChars   = 1_000_000 // per open/closed tab
	MaxHistorySQL    = 20_000    // characters kept per history entry
	DefaultRetention = 90        // days
	DefaultMaxEntry  = 5000
)

// Store reads and writes the state files below dir.
type Store struct {
	dir    string
	mu     sync.Mutex
	counts map[string]int // history lines per database, to decide when to compact
	seq    uint64         // makes entry IDs unique even when the clock does not advance between two calls
}

// New creates a store rooted at dir (created on first write).
func New(dir string) *Store {
	return &Store{dir: dir, counts: map[string]int{}}
}

// DefaultDir is ~/.spextractor.
func DefaultDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".spextractor"), nil
}

// ------------------------------------------------------------------- identity

var unsafeChars = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

// Key identifies a database across sessions: engine, server, port and database
// name. The user is deliberately not part of it, so people (or logins) working
// on the same database share its tabs and history.
func Key(t db.DatabaseType, host, port, dbName string) string {
	host = strings.ToLower(strings.TrimSpace(host))
	port = strings.TrimSpace(port)
	if port == "" {
		switch t {
		case db.MySQL:
			port = "3306"
		case db.PostgreSQL:
			port = "5432"
		default:
			port = "1433"
		}
	}
	sum := sha1.Sum([]byte(strings.Join([]string{string(t), host, port, strings.ToLower(strings.TrimSpace(dbName))}, "|")))
	label := strings.ToLower(unsafeChars.ReplaceAllString(dbName, "_"))
	if len(label) > 40 {
		label = label[:40]
	}
	if label == "" {
		label = "db"
	}
	return label + "_" + hex.EncodeToString(sum[:])[:10]
}

// WorkspaceKey identifies a database query state for a specific workspace:
// e.g. "ws1_ventas_abc123"
func WorkspaceKey(wsID string, t db.DatabaseType, host, port, dbName string) string {
	ws := strings.TrimSpace(wsID)
	if ws == "" {
		ws = "1"
	}
	base := Key(t, host, port, dbName)
	return fmt.Sprintf("ws%s_%s", ws, base)
}

func (s *Store) dbDir(key string) string { return filepath.Join(s.dir, "workspaces", key) }

// --------------------------------------------------------------------- files

// writeJSON writes atomically so a crash never leaves a half-written file.
func writeJSON(path string, v any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func readJSON(path string, v any) error {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, v); err != nil {
		// A corrupt file must not break the app: keep a copy and start empty.
		_ = os.Rename(path, path+".corrupt")
		return nil
	}
	return nil
}

func clip(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// ----------------------------------------------------------------- query tabs

// Tab is one query editor tab.
type Tab struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	SQL      string `json:"sql"`
	SavedPath string `json:"savedPath,omitempty"`
	ClosedAt int64  `json:"closedAt,omitempty"` // unix ms, only for closed tabs
}

// QueryState is what is kept for a database's Consultas view.
type QueryState struct {
	Tabs      []Tab  `json:"tabs"`
	ActiveID  string `json:"activeId"`
	Closed    []Tab  `json:"closed"`
	UpdatedAt int64  `json:"updatedAt"`
}

func normalizeTabs(tabs []Tab) []Tab {
	out := make([]Tab, 0, len(tabs))
	for _, t := range tabs {
		t.SQL = clip(t.SQL, MaxTabSQLChars)
		out = append(out, t)
	}
	return out
}

// LoadState returns the saved tabs of a database (empty if none).
func (s *Store) LoadState(key string) (QueryState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := QueryState{Tabs: []Tab{}, Closed: []Tab{}}
	if err := readJSON(filepath.Join(s.dbDir(key), "state.json"), &st); err != nil {
		return QueryState{Tabs: []Tab{}, Closed: []Tab{}}, err
	}
	if st.Tabs == nil {
		st.Tabs = []Tab{}
	}
	if st.Closed == nil {
		st.Closed = []Tab{}
	}
	return st, nil
}

// SaveState stores the tabs of a database.
func (s *Store) SaveState(key string, st QueryState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st.Tabs = normalizeTabs(st.Tabs)
	st.Closed = normalizeTabs(st.Closed)
	if len(st.Closed) > MaxClosedTabs {
		st.Closed = st.Closed[:MaxClosedTabs]
	}
	st.UpdatedAt = time.Now().UnixMilli()
	return writeJSON(filepath.Join(s.dbDir(key), "state.json"), st)
}

// ResetState removes the saved query tabs (state.json) for a database key.
func (s *Store) ResetState(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	path := filepath.Join(s.dbDir(key), "state.json")
	_ = os.Remove(path + ".tmp")
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// ResetWorkspaceStates removes state.json for all databases under a specific workspace ID.
func (s *Store) ResetWorkspaceStates(wsID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	ws := strings.TrimSpace(wsID)
	if ws == "" {
		ws = "1"
	}
	prefix := fmt.Sprintf("ws%s_", ws)
	workspacesDir := filepath.Join(s.dir, "workspaces")
	entries, err := os.ReadDir(workspacesDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for _, e := range entries {
		if e.IsDir() && strings.HasPrefix(e.Name(), prefix) {
			path := filepath.Join(workspacesDir, e.Name(), "state.json")
			_ = os.Remove(path + ".tmp")
			_ = os.Remove(path)
		}
	}
	return nil
}

// -------------------------------------------------------------------- history

// HistoryEntry is one executed query.
type HistoryEntry struct {
	ID         string `json:"id"`
	SQL        string `json:"sql"`
	At         int64  `json:"at"` // unix ms
	DurationMs int64  `json:"durationMs"`
	Rows       int    `json:"rows"`
	Sets       int    `json:"sets"`
	Error      string `json:"error"`
	Truncated  bool   `json:"truncated"` // SQL was cut to MaxHistorySQL characters
}

// HistoryPage is a page of history entries, newest first.
type HistoryPage struct {
	Entries []HistoryEntry `json:"entries"`
	Total   int            `json:"total"` // entries matching the filter
}

// Settings are the user-controlled options of the persistence features.
type Settings struct {
	HistoryEnabled    bool   `json:"historyEnabled"`
	RetentionDays     int    `json:"retentionDays"`
	MaxEntries        int    `json:"maxEntries"`
	AutoRestore       bool   `json:"autoRestore"` // restore the previous session without asking
	// CheckUpdates looks for a newer release when the app starts.
	CheckUpdates      bool   `json:"checkUpdates"`
	// SkippedVersion is a release the user chose not to be reminded about.
	SkippedVersion    string `json:"skippedVersion"`
	DefaultRowLimit   int    `json:"defaultRowLimit"`
	EditorFontSize    int    `json:"editorFontSize"`
	DefaultOutDir     string `json:"defaultOutDir"`
	IncludeDropHeader bool   `json:"includeDropHeader"`
}

// DefaultSettings are used until the user changes them.
func DefaultSettings() Settings {
	return Settings{
		HistoryEnabled:    true,
		RetentionDays:     DefaultRetention,
		MaxEntries:        DefaultMaxEntry,
		CheckUpdates:      true,
		DefaultRowLimit:   100,
		EditorFontSize:    12,
		IncludeDropHeader: true,
	}
}

func (st Settings) sane() Settings {
	if st.RetentionDays < 0 {
		st.RetentionDays = DefaultRetention
	}
	if st.MaxEntries <= 0 {
		st.MaxEntries = DefaultMaxEntry
	}
	if st.EditorFontSize < 9 || st.EditorFontSize > 32 {
		st.EditorFontSize = 12
	}
	if st.DefaultRowLimit < 0 {
		st.DefaultRowLimit = 100
	}
	return st
}

// LoadSettings reads settings.json (defaults when absent).
func (s *Store) LoadSettings() (Settings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadSettingsLocked()
}

func (s *Store) loadSettingsLocked() (Settings, error) {
	st := DefaultSettings()
	err := readJSON(filepath.Join(s.dir, "settings.json"), &st)
	return st.sane(), err
}

// SaveSettings writes settings.json.
func (s *Store) SaveSettings(st Settings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return writeJSON(filepath.Join(s.dir, "settings.json"), st.sane())
}

func (s *Store) historyPath(key string) string { return filepath.Join(s.dbDir(key), "history.jsonl") }

// newIDLocked returns an ID that is unique within this process (clock + counter).
func (s *Store) newIDLocked() string {
	s.seq++
	return fmt.Sprintf("%x-%x", time.Now().UnixNano(), s.seq)
}

// AppendHistory records an executed query. It does nothing when history is
// disabled or the SQL is blank.
func (s *Store) AppendHistory(key string, e HistoryEntry) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg, _ := s.loadSettingsLocked()
	if !cfg.HistoryEnabled || strings.TrimSpace(e.SQL) == "" {
		return nil
	}
	if utf8.RuneCountInString(e.SQL) > MaxHistorySQL {
		e.SQL, e.Truncated = clip(e.SQL, MaxHistorySQL), true
	}
	if e.ID == "" {
		e.ID = s.newIDLocked()
	}
	if e.At == 0 {
		e.At = time.Now().UnixMilli()
	}

	line, err := json.Marshal(e)
	if err != nil {
		return err
	}
	path := s.historyPath(key)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	_, werr := f.Write(append(line, '\n'))
	if cerr := f.Close(); werr == nil {
		werr = cerr
	}
	if werr != nil {
		return werr
	}

	if _, known := s.counts[key]; !known {
		all, _ := s.readHistoryLocked(key)
		s.counts[key] = len(all)
	} else {
		s.counts[key]++
	}
	if s.counts[key] > cfg.MaxEntries+200 {
		return s.compactLocked(key, cfg)
	}
	return nil
}

// readHistoryLocked returns every entry, oldest first. Unreadable lines are skipped.
func (s *Store) readHistoryLocked(key string) ([]HistoryEntry, error) {
	f, err := os.Open(s.historyPath(key))
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var out []HistoryEntry
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1024*1024), 8*1024*1024)
	for sc.Scan() {
		var e HistoryEntry
		if json.Unmarshal(sc.Bytes(), &e) == nil && e.ID != "" {
			out = append(out, e)
		}
	}
	return out, sc.Err()
}

func (s *Store) writeHistoryLocked(key string, entries []HistoryEntry) error {
	path := s.historyPath(key)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for _, e := range entries {
		line, err := json.Marshal(e)
		if err != nil {
			f.Close()
			return err
		}
		w.Write(line)
		w.WriteByte('\n')
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	s.counts[key] = len(entries)
	return os.Rename(tmp, path)
}

// compactLocked drops entries older than the retention period and keeps at
// most MaxEntries of the newest.
func (s *Store) compactLocked(key string, cfg Settings) error {
	all, err := s.readHistoryLocked(key)
	if err != nil {
		return err
	}
	if cfg.RetentionDays > 0 {
		cutoff := time.Now().AddDate(0, 0, -cfg.RetentionDays).UnixMilli()
		kept := all[:0]
		for _, e := range all {
			if e.At >= cutoff {
				kept = append(kept, e)
			}
		}
		all = kept
	}
	if len(all) > cfg.MaxEntries {
		all = all[len(all)-cfg.MaxEntries:]
	}
	return s.writeHistoryLocked(key, all)
}

// ListHistory returns entries newest first. term filters by SQL text
// (case-insensitive); onlyErrors keeps only failed executions.
func (s *Store) ListHistory(key, term string, onlyErrors bool, limit int) (HistoryPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	cfg, _ := s.loadSettingsLocked()
	all, err := s.readHistoryLocked(key)
	if err != nil {
		return HistoryPage{Entries: []HistoryEntry{}}, err
	}
	cutoff := int64(0)
	if cfg.RetentionDays > 0 {
		cutoff = time.Now().AddDate(0, 0, -cfg.RetentionDays).UnixMilli()
	}
	q := strings.ToLower(strings.TrimSpace(term))

	matches := make([]HistoryEntry, 0, len(all))
	for _, e := range all {
		if e.At < cutoff || (onlyErrors && e.Error == "") {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(e.SQL), q) {
			continue
		}
		matches = append(matches, e)
	}
	sort.SliceStable(matches, func(i, j int) bool { return matches[i].At > matches[j].At })
	page := HistoryPage{Total: len(matches), Entries: matches}
	if limit > 0 && len(matches) > limit {
		page.Entries = matches[:limit]
	}
	if page.Entries == nil {
		page.Entries = []HistoryEntry{}
	}
	return page, nil
}

// DeleteHistory removes one entry.
func (s *Store) DeleteHistory(key, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	all, err := s.readHistoryLocked(key)
	if err != nil {
		return err
	}
	kept := all[:0]
	for _, e := range all {
		if e.ID != id {
			kept = append(kept, e)
		}
	}
	return s.writeHistoryLocked(key, kept)
}

// ClearHistory removes every entry of a database.
func (s *Store) ClearHistory(key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.counts, key)
	err := os.Remove(s.historyPath(key))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}

// -------------------------------------------------------------------- session

// SessionWorkspace is one workspace of the saved session.
type SessionWorkspace struct {
	ID     string `json:"id"`
	View   string `json:"view"`
	DbType string `json:"dbType"`
	Host   string `json:"host"`
	Port   string `json:"port"`
	DbName string `json:"dbName"`
	User   string `json:"user"`
}

// Connected reports whether the workspace had a connection.
func (w SessionWorkspace) Connected() bool { return w.DbType != "" && w.DbName != "" }

// Session is the layout of the app when it was last used. Passwords are never
// part of it.
type Session struct {
	ActiveID   string             `json:"activeId"`
	Workspaces []SessionWorkspace `json:"workspaces"`
	SavedAt    int64              `json:"savedAt"`
}

// LoadSession returns the last saved session (empty when there is none).
func (s *Store) LoadSession() (Session, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess := Session{Workspaces: []SessionWorkspace{}}
	err := readJSON(filepath.Join(s.dir, "session.json"), &sess)
	if sess.Workspaces == nil {
		sess.Workspaces = []SessionWorkspace{}
	}
	return sess, err
}

// SaveSession stores the session layout.
func (s *Store) SaveSession(sess Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess.SavedAt = time.Now().UnixMilli()
	return writeJSON(filepath.Join(s.dir, "session.json"), sess)
}
