package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"

	"sp-extractor-wails/pkg/db"
	"sp-extractor-wails/pkg/db/trace"
)

const (
	tracePollInterval = time.Second
	traceMaxErrors    = 3 // consecutive poll failures before the trace gives up
)

// activeTrace is the running trace of one workspace.
type activeTrace struct {
	tracer *trace.Tracer
	cancel context.CancelFunc
	done   chan struct{} // closed when the polling goroutine has exited
}

func requireSQLServer(s *WorkspaceSession) error {
	if s.connInfo.DbType != db.SQLServer {
		return fmt.Errorf("la traza solo está disponible para conexiones SQL Server")
	}
	return nil
}

// StartTrace creates an Extended Events session on the server (filtered to the
// connected database) and streams captured statements to the frontend through
// the "trace:events" Wails event.
func (a *App) StartTrace(wsID string, opts trace.Options) error {
	s, err := a.getSession(wsID)
	if err != nil {
		return err
	}
	if err := requireSQLServer(s); err != nil {
		return err
	}
	s.traceMu.Lock()
	defer s.traceMu.Unlock()
	if s.trace != nil {
		return fmt.Errorf("ya hay una traza en ejecución en este espacio de trabajo")
	}

	tr, err := trace.Start(a.ctx, s.conn, s.connInfo.DbName, db.AppName, opts)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(a.ctx)
	at := &activeTrace{tracer: tr, cancel: cancel, done: make(chan struct{})}
	s.trace = at
	go a.runTrace(ctx, wsID, s, at)
	return nil
}

func (a *App) runTrace(ctx context.Context, wsID string, s *WorkspaceSession, at *activeTrace) {
	defer close(at.done)
	ticker := time.NewTicker(tracePollInterval)
	defer ticker.Stop()

	failures := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		pollCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
		events, err := at.tracer.Poll(pollCtx, s.conn)
		cancel()
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			failures++
			runtime.EventsEmit(a.ctx, "trace:error", map[string]any{"workspaceId": wsID, "error": err.Error()})
			if failures >= traceMaxErrors {
				// The server-side session is dropped when the frontend calls StopTrace.
				runtime.EventsEmit(a.ctx, "trace:stopped", map[string]any{"workspaceId": wsID, "reason": err.Error()})
				return
			}
			continue
		}
		failures = 0

		events = dropOwnPolling(events, at.tracer.Name)
		if len(events) > 0 {
			runtime.EventsEmit(a.ctx, "trace:events", map[string]any{"workspaceId": wsID, "events": events})
		}
	}
}

// dropOwnPolling removes the statements this tool itself issues to read the buffer.
func dropOwnPolling(events []trace.Event, sessionName string) []trace.Event {
	out := events[:0]
	for _, e := range events {
		if strings.Contains(e.Text, sessionName) || strings.Contains(e.Text, "dm_xe_session_targets") {
			continue
		}
		out = append(out, e)
	}
	return out
}

// StopTrace stops polling and drops the event session from the server.
func (a *App) StopTrace(wsID string) error {
	s, err := a.getSession(wsID)
	if err != nil {
		return err
	}
	return s.stopTrace()
}

// stopTrace is safe to call with no trace running.
func (s *WorkspaceSession) stopTrace() error {
	s.traceMu.Lock()
	defer s.traceMu.Unlock()
	at := s.trace
	if at == nil {
		return nil
	}
	s.trace = nil
	at.cancel()
	select {
	case <-at.done:
	case <-time.After(5 * time.Second):
	}
	if s.conn == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	return trace.Drop(ctx, s.conn, at.tracer.Name)
}

// TraceStatus reports whether a trace is running for the workspace.
func (a *App) TraceStatus(wsID string) bool {
	s, err := a.getSession(wsID)
	if err != nil {
		return false
	}
	s.traceMu.Lock()
	defer s.traceMu.Unlock()
	return s.trace != nil
}

// CleanupTraceSessions drops every trace session created by this tool on the
// server (e.g. left behind by a crash) and returns how many were removed.
// It also stops traces started by other running instances of the tool.
func (a *App) CleanupTraceSessions(wsID string) (int, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return 0, err
	}
	if err := requireSQLServer(s); err != nil {
		return 0, err
	}
	if err := s.stopTrace(); err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	return trace.Cleanup(ctx, s.conn)
}
