package store

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"sp-extractor-wails/pkg/db"
)

func newStore(t *testing.T) *Store { return New(t.TempDir()) }

func TestKey(t *testing.T) {
	a := Key(db.SQLServer, "SRV\\SQL2022", "1433", "Ventas")
	if a != Key(db.SQLServer, " srv\\sql2022 ", "", "ventas") {
		t.Error("case, spaces and the default port must not change the key")
	}
	if a == Key(db.SQLServer, "srv\\sql2022", "1433", "Compras") {
		t.Error("different databases must have different keys")
	}
	if a == Key(db.PostgreSQL, "srv\\sql2022", "1433", "Ventas") {
		t.Error("different engines must have different keys")
	}
	if !strings.HasPrefix(a, "ventas_") || strings.ContainsAny(a, `\/:*?"<>| `) {
		t.Errorf("key must be usable as a folder name: %q", a)
	}
	if k := Key(db.SQLServer, "h", "", ""); !strings.HasPrefix(k, "db_") {
		t.Errorf("empty database name: %q", k)
	}
}

func TestStateRoundTripAndLimits(t *testing.T) {
	s := newStore(t)
	empty, err := s.LoadState("k")
	if err != nil || len(empty.Tabs) != 0 || empty.Closed == nil {
		t.Fatalf("empty state: %+v %v", empty, err)
	}

	closed := make([]Tab, MaxClosedTabs+10)
	for i := range closed {
		closed[i] = Tab{ID: "c", Title: "x", SQL: "SELECT 1"}
	}
	in := QueryState{
		Tabs:     []Tab{{ID: "a", Title: "Consulta 1", SQL: "SELECT 1"}, {ID: "b", Title: "T", SQL: strings.Repeat("x", MaxTabSQLChars+5)}},
		ActiveID: "b",
		Closed:   closed,
	}
	if err := s.SaveState("k", in); err != nil {
		t.Fatal(err)
	}
	got, err := s.LoadState("k")
	if err != nil {
		t.Fatal(err)
	}
	if got.ActiveID != "b" || len(got.Tabs) != 2 || got.Tabs[0].SQL != "SELECT 1" {
		t.Errorf("state = %+v", got)
	}
	if len([]rune(got.Tabs[1].SQL)) != MaxTabSQLChars {
		t.Errorf("a huge tab must be cut to %d chars, got %d", MaxTabSQLChars, len([]rune(got.Tabs[1].SQL)))
	}
	if len(got.Closed) != MaxClosedTabs {
		t.Errorf("closed tabs = %d, want %d", len(got.Closed), MaxClosedTabs)
	}
	if got.UpdatedAt == 0 {
		t.Error("UpdatedAt not set")
	}
}

func TestCorruptStateFileDoesNotBreak(t *testing.T) {
	s := newStore(t)
	dir := filepath.Join(s.dir, "workspaces", "k")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "state.json"), []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	st, err := s.LoadState("k")
	if err != nil || len(st.Tabs) != 0 {
		t.Errorf("corrupt file: %+v %v", st, err)
	}
	if _, err := os.Stat(filepath.Join(dir, "state.json.corrupt")); err != nil {
		t.Error("the corrupt file should be kept aside")
	}
}

func TestHistoryAppendListSearchDelete(t *testing.T) {
	s := newStore(t)
	now := time.Now().UnixMilli()
	for i, sql := range []string{"SELECT * FROM Pedidos", "UPDATE Clientes SET a = 1", "SELECT * FROM Lineas"} {
		e := HistoryEntry{SQL: sql, At: now + int64(i), DurationMs: 5, Rows: i}
		if i == 1 {
			e.Error = "boom"
		}
		if err := s.AppendHistory("k", e); err != nil {
			t.Fatal(err)
		}
	}

	page, err := s.ListHistory("k", "", false, 0)
	if err != nil || page.Total != 3 || page.Entries[0].SQL != "SELECT * FROM Lineas" {
		t.Fatalf("newest first expected: %+v %v", page, err)
	}
	if p, _ := s.ListHistory("k", "pedidos", false, 0); p.Total != 1 || p.Entries[0].SQL != "SELECT * FROM Pedidos" {
		t.Errorf("search is case-insensitive: %+v", p)
	}
	if p, _ := s.ListHistory("k", "", true, 0); p.Total != 1 || p.Entries[0].Error != "boom" {
		t.Errorf("only errors: %+v", p)
	}
	if p, _ := s.ListHistory("k", "", false, 2); len(p.Entries) != 2 || p.Total != 3 {
		t.Errorf("limit keeps the total: %+v", p)
	}

	if err := s.DeleteHistory("k", page.Entries[0].ID); err != nil {
		t.Fatal(err)
	}
	if p, _ := s.ListHistory("k", "", false, 0); p.Total != 2 {
		t.Errorf("after delete: %+v", p)
	}
	if err := s.ClearHistory("k"); err != nil {
		t.Fatal(err)
	}
	if p, _ := s.ListHistory("k", "", false, 0); p.Total != 0 || p.Entries == nil {
		t.Errorf("after clear: %+v", p)
	}
	if err := s.ClearHistory("k"); err != nil {
		t.Errorf("clearing twice must not fail: %v", err)
	}
}

func TestHistoryDisabledAndBlank(t *testing.T) {
	s := newStore(t)
	if err := s.SaveSettings(Settings{HistoryEnabled: false}); err != nil {
		t.Fatal(err)
	}
	_ = s.AppendHistory("k", HistoryEntry{SQL: "SELECT 1"})
	if p, _ := s.ListHistory("k", "", false, 0); p.Total != 0 {
		t.Errorf("disabled history must record nothing: %+v", p)
	}
	_ = s.SaveSettings(Settings{HistoryEnabled: true})
	_ = s.AppendHistory("k", HistoryEntry{SQL: "   \n"})
	if p, _ := s.ListHistory("k", "", false, 0); p.Total != 0 {
		t.Errorf("blank SQL must not be recorded: %+v", p)
	}
}

func TestHistoryTruncatesLongSQL(t *testing.T) {
	s := newStore(t)
	_ = s.AppendHistory("k", HistoryEntry{SQL: strings.Repeat("a", MaxHistorySQL+500)})
	p, _ := s.ListHistory("k", "", false, 0)
	if len(p.Entries) != 1 || !p.Entries[0].Truncated || len([]rune(p.Entries[0].SQL)) != MaxHistorySQL {
		t.Errorf("long SQL: truncated=%v len=%d", p.Entries[0].Truncated, len([]rune(p.Entries[0].SQL)))
	}
}

func TestHistoryCompactionAndRetention(t *testing.T) {
	s := newStore(t)
	if err := s.SaveSettings(Settings{HistoryEnabled: true, RetentionDays: 30, MaxEntries: 10}); err != nil {
		t.Fatal(err)
	}
	old := time.Now().AddDate(0, 0, -60).UnixMilli()
	_ = s.AppendHistory("k", HistoryEntry{SQL: "OLD", At: old})
	for i := 0; i < 300; i++ {
		_ = s.AppendHistory("k", HistoryEntry{SQL: "Q", At: time.Now().UnixMilli() + int64(i)})
	}
	all, _ := s.readHistoryLocked("k")
	if len(all) > 10+200 {
		t.Errorf("file kept growing: %d entries", len(all))
	}
	p, _ := s.ListHistory("k", "OLD", false, 0)
	if p.Total != 0 {
		t.Error("entries older than the retention period must not be listed")
	}
}

func TestSessionAndSettings(t *testing.T) {
	s := newStore(t)
	empty, err := s.LoadSession()
	if err != nil || len(empty.Workspaces) != 0 {
		t.Fatalf("empty session: %+v %v", empty, err)
	}
	in := Session{ActiveID: "2", Workspaces: []SessionWorkspace{
		{ID: "1", View: "query", DbType: "SQL_SERVER", Host: "h", Port: "1433", DbName: "Ventas", User: "sa"},
		{ID: "2", View: "objects"},
	}}
	if err := s.SaveSession(in); err != nil {
		t.Fatal(err)
	}
	got, _ := s.LoadSession()
	if got.ActiveID != "2" || len(got.Workspaces) != 2 || !got.Workspaces[0].Connected() || got.Workspaces[1].Connected() {
		t.Errorf("session = %+v", got)
	}
	raw, _ := os.ReadFile(filepath.Join(s.dir, "session.json"))
	if strings.Contains(strings.ToLower(string(raw)), "password") {
		t.Error("the session must never contain passwords")
	}

	def, _ := s.LoadSettings()
	if !def.HistoryEnabled || def.RetentionDays != DefaultRetention || def.MaxEntries != DefaultMaxEntry || def.AutoRestore {
		t.Errorf("defaults = %+v", def)
	}
	_ = s.SaveSettings(Settings{HistoryEnabled: true, RetentionDays: -5, MaxEntries: 0, AutoRestore: true})
	back, _ := s.LoadSettings()
	if back.RetentionDays != DefaultRetention || back.MaxEntries != DefaultMaxEntry || !back.AutoRestore {
		t.Errorf("sanitised settings = %+v", back)
	}
}
