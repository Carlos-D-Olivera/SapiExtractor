package main

import (
	"fmt"
	"strings"
	"time"

	"sp-extractor-wails/pkg/store"
)

// dbKey returns the persistence key of the database a workspace is connected to.
func (s *WorkspaceSession) dbKey() string {
	c := s.connInfo
	return store.Key(c.DbType, c.Host, c.Port, c.DbName)
}

// recordHistory saves an executed query in the history of its database. A
// failure to write is deliberately ignored: history must never break a query.
func (a *App) recordHistory(wsID, sqlText string, resp QueryResponse, execErr error, took time.Duration) {
	s, err := a.getSession(wsID)
	if err != nil || strings.TrimSpace(sqlText) == "" {
		return
	}
	e := store.HistoryEntry{
		SQL:        sqlText,
		At:         time.Now().Add(-took).UnixMilli(),
		DurationMs: took.Milliseconds(),
		Rows:       resp.RowCount,
		Sets:       len(resp.Sets),
	}
	if resp.DurationMs > 0 {
		e.DurationMs = resp.DurationMs
	}
	if execErr != nil {
		e.Error = execErr.Error()
	}
	_ = a.store.AppendHistory(s.dbKey(), e)
}

// ---- Query tabs (per database) ----

// LoadQueryState returns the saved query tabs of the workspace's database.
func (a *App) LoadQueryState(wsID string) (store.QueryState, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return store.QueryState{Tabs: []store.Tab{}, Closed: []store.Tab{}}, err
	}
	return a.store.LoadState(s.dbKey())
}

// SaveQueryState stores the query tabs of the workspace's database.
func (a *App) SaveQueryState(wsID string, st store.QueryState) error {
	s, err := a.getSession(wsID)
	if err != nil {
		return err
	}
	return a.store.SaveState(s.dbKey(), st)
}

// ---- Query history (per database) ----

// ListHistory returns the executed queries of the workspace's database, newest
// first, optionally filtered by text or to failed executions only.
func (a *App) ListHistory(wsID, term string, onlyErrors bool, limit int) (store.HistoryPage, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return store.HistoryPage{Entries: []store.HistoryEntry{}}, err
	}
	return a.store.ListHistory(s.dbKey(), term, onlyErrors, limit)
}

// DeleteHistoryEntry removes one entry of the workspace's database history.
func (a *App) DeleteHistoryEntry(wsID, id string) error {
	s, err := a.getSession(wsID)
	if err != nil {
		return err
	}
	return a.store.DeleteHistory(s.dbKey(), id)
}

// ClearHistory removes the whole history of the workspace's database.
func (a *App) ClearHistory(wsID string) error {
	s, err := a.getSession(wsID)
	if err != nil {
		return err
	}
	return a.store.ClearHistory(s.dbKey())
}

// ---- Settings and session ----

// GetPersistenceSettings returns the history / session options.
func (a *App) GetPersistenceSettings() (store.Settings, error) {
	return a.store.LoadSettings()
}

// SetPersistenceSettings saves the history / session options.
func (a *App) SetPersistenceSettings(st store.Settings) error {
	if st.RetentionDays < 0 {
		return fmt.Errorf("los días de retención no pueden ser negativos")
	}
	return a.store.SaveSettings(st)
}

// LoadSession returns the layout the app had when it was last used.
func (a *App) LoadSession() (store.Session, error) {
	return a.store.LoadSession()
}

// SaveSession stores the current layout (which connection each workspace has).
func (a *App) SaveSession(sess store.Session) error {
	return a.store.SaveSession(sess)
}
