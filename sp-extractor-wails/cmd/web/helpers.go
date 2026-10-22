package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"sp-extractor-wails/pkg/db"
)

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

func runQuery(ctx context.Context, conn *sql.DB, sqlText string, maxRows int) (QueryResponse, error) {
	start := time.Now()
	resp := QueryResponse{Sets: []ResultSet{}}

	if isPlainDML(sqlText) {
		res, err := conn.ExecContext(ctx, sqlText)
		if err != nil {
			return resp, err
		}
		resp.DurationMs = time.Since(start).Milliseconds()
		if n, err := res.RowsAffected(); err == nil && n >= 0 {
			resp.Message = fmt.Sprintf("%d fila(s) afectada(s).", n)
		} else {
			resp.Message = "Comando ejecutado correctamente."
		}
		return resp, nil
	}

	rows, err := conn.QueryContext(ctx, sqlText)
	if err != nil {
		return resp, err
	}
	defer rows.Close()

	for {
		cols, err := rows.Columns()
		if err != nil {
			return resp, err
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
					return resp, err
				}
				row := make([]*string, len(cols))
				for i, v := range vals {
					row[i] = valueToString(v)
				}
				set.Rows = append(set.Rows, row)
			}
			if err := rows.Err(); err != nil {
				return resp, err
			}
			resp.Sets = append(resp.Sets, set)
			resp.RowCount += len(set.Rows)
		}
		if !rows.NextResultSet() {
			break
		}
	}

	resp.DurationMs = time.Since(start).Milliseconds()
	if len(resp.Sets) == 0 {
		resp.Message = "Comando ejecutado correctamente."
	} else {
		resp.Message = fmt.Sprintf("%d conjunto(s) de resultados, %d fila(s).", len(resp.Sets), resp.RowCount)
	}
	return resp, nil
}

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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
