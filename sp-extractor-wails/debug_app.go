package main

import (
	"context"
	"fmt"
	"strings"

	"sp-extractor-wails/pkg/db/debug"
)

// GetProcParameters lists the parameters of a stored procedure (SQL Server).
func (a *App) GetProcParameters(wsID, schema, name string) ([]debug.Param, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return nil, err
	}
	if err := requireSQLServer(s); err != nil {
		return nil, err
	}
	params, err := debug.ListParams(a.ctx, s.conn, schema, name)
	if params == nil {
		params = []debug.Param{}
	}
	return params, err
}

// DebugProcedure runs a stored procedure and reports every statement it
// executed, the nested procedures and triggers it called, the IF/WHILE branches
// taken, its result sets, messages and output parameters. It uses an Extended
// Events session scoped to the connection that runs the procedure.
func (a *App) DebugProcedure(wsID string, req debug.Request) (debug.Result, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return debug.Result{}, err
	}
	if err := requireSQLServer(s); err != nil {
		return debug.Result{}, err
	}

	// CancelQuery stops a debug run the same way it stops a query.
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

	res, err := debug.Run(ctx, s.conn, req, debug.Hooks{Format: valueToString, TypeNames: columnTypeNames})
	if err != nil {
		return debug.Result{}, fmt.Errorf("%w", err)
	}
	// Go encodes nil slices as JSON null; the UI iterates over all of these.
	if res.Steps == nil {
		res.Steps = []*debug.Step{}
	}
	if res.Sources == nil {
		res.Sources = []debug.Source{}
	}
	if res.Sets == nil {
		res.Sets = []debug.ResultSet{}
	}
	if res.Messages == nil {
		res.Messages = []debug.Message{}
	}
	if res.Outputs == nil {
		res.Outputs = []debug.NameValue{}
	}
	if res.Notes == nil {
		res.Notes = []string{}
	}
	if res.Changes == nil {
		res.Changes = []debug.DataChange{}
	}
	return *res, nil
}

// PrepareProcedureDebug turns a procedure call seen in the trace into what the
// debug panel needs: the procedure's schema and name plus the argument values
// parsed from the captured statement. objectName is the RPC's object name (may
// be empty for plain batches); statement is the captured text.
func (a *App) PrepareProcedureDebug(wsID, objectName, statement string) (debug.Prefill, error) {
	s, err := a.getSession(wsID)
	if err != nil {
		return debug.Prefill{}, err
	}
	if err := requireSQLServer(s); err != nil {
		return debug.Prefill{}, err
	}

	pre := debug.Prefill{Args: []debug.Arg{}}
	call, ok := debug.ParseExec(statement)
	name, hint := objectName, ""
	if ok {
		pre.Parsed, pre.Args = true, call.Args
		if pre.Args == nil {
			pre.Args = []debug.Arg{}
		}
		name, hint = call.Name, call.Schema
	}
	if i := strings.LastIndex(name, "."); i >= 0 { // object_name may arrive as schema.name
		hint, name = name[:i], name[i+1:]
	}
	if strings.TrimSpace(name) == "" {
		return debug.Prefill{}, fmt.Errorf("el evento no corresponde a una llamada a un procedimiento almacenado")
	}

	actual, schemas, err := debug.ResolveProcedure(a.ctx, s.conn, name, hint)
	if err != nil {
		return debug.Prefill{}, err
	}
	if len(schemas) == 0 {
		return debug.Prefill{}, fmt.Errorf("el procedimiento %q no existe en la base de datos conectada", name)
	}
	pre.Schema, pre.Name, pre.Candidates = schemas[0], actual, schemas
	return pre, nil
}
