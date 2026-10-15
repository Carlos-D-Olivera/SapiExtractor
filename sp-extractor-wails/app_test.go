package main

import (
	"strings"
	"testing"
	"time"

	"sp-extractor-wails/pkg/db"
)

func TestSanitizeName(t *testing.T) {
	cases := []struct {
		input    string
		expected string
	}{
		{"dbo.usp_GetUsers", "dbo.usp_GetUsers"},
		{"schema/table:name?*test", "schema_table_name__test"},
		{"  name with spaces  ", "name with spaces"},
		{"special<>|\\\"chars", "special_____chars"},
	}

	for _, tc := range cases {
		got := sanitizeName(tc.input)
		if got != tc.expected {
			t.Errorf("SanitizeName(%q) = %q, expected %q", tc.input, got, tc.expected)
		}
	}
}

func TestDropHeader(t *testing.T) {
	cases := []struct {
		obj      db.DbObject
		contains string
	}{
		{db.DbObject{Type: db.StoredProcedure, Schema: "dbo", Name: "usp_Test"}, "DROP PROCEDURE [dbo].[usp_Test]"},
		{db.DbObject{Type: db.Table, Schema: "dbo", Name: "Users"}, "DROP TABLE [dbo].[Users]"},
		{db.DbObject{Type: db.View, Schema: "dbo", Name: "vUsers"}, "DROP VIEW [dbo].[vUsers]"},
		{db.DbObject{Type: db.Function, Schema: "dbo", Name: "fnTest"}, "DROP FUNCTION [dbo].[fnTest]"},
		{db.DbObject{Type: db.Trigger, Schema: "dbo", Name: "trgTest"}, "DROP TRIGGER [dbo].[trgTest]"},
	}

	for _, tc := range cases {
		header := dropHeader(tc.obj)
		if !strings.Contains(header, tc.contains) {
			t.Errorf("dropHeader(%s) = %q, expected it to contain %q", tc.obj.Type, header, tc.contains)
		}
		if !strings.HasPrefix(header, "IF EXISTS") || !strings.Contains(header, "GO") {
			t.Errorf("dropHeader(%s) = %q, expected IF EXISTS ... GO preamble", tc.obj.Type, header)
		}
	}

	// COLUMN objects already embed guards in their script — no header.
	if h := dropHeader(db.DbObject{Type: db.Column, Schema: "dbo", ParentName: "T", Name: "c"}); h != "" {
		t.Errorf("dropHeader(COLUMN) = %q, expected empty", h)
	}
}

func TestObjectTextWithHeader(t *testing.T) {
	obj := db.DbObject{
		Type:       db.StoredProcedure,
		Schema:     "dbo",
		Name:       "usp_Test",
		Definition: "CREATE PROCEDURE dbo.usp_Test AS SELECT 1;",
	}
	text := objectTextWithHeader(obj)
	if !strings.HasPrefix(text, "IF EXISTS") {
		t.Errorf("expected DROP header prefix, got %q", text[:40])
	}
	if !strings.HasSuffix(text, obj.Definition) {
		t.Errorf("expected definition suffix, got %q", text)
	}

	// Empty definition falls back to a placeholder.
	empty := objectTextWithHeader(db.DbObject{Type: db.View, Schema: "dbo", Name: "v"})
	if !strings.Contains(empty, "-- No definition available") {
		t.Errorf("expected placeholder for empty definition, got %q", empty)
	}
}

func TestDefaultFileName(t *testing.T) {
	name := defaultFileName(db.DbObject{Type: db.StoredProcedure, Schema: "dbo", Name: "usp_GetUsers"})
	if !strings.HasPrefix(name, "20") || !strings.Contains(name, "_sp_dbo.usp_GetUsers.sql") {
		t.Errorf("defaultFileName() = %q, expected yyyyMMdd_sp_dbo.usp_GetUsers.sql", name)
	}

	col := defaultFileName(db.DbObject{Type: db.Column, Schema: "dbo", ParentName: "Users", Name: "Email"})
	if !strings.Contains(col, "_col_dbo.Users_Email.sql") {
		t.Errorf("column defaultFileName() = %q, expected ..._col_dbo.Users_Email.sql", col)
	}

	// Illegal filename chars are sanitized.
	bad := defaultFileName(db.DbObject{Type: db.View, Schema: "dbo", Name: "v/Test"})
	if strings.ContainsAny(bad, "/") {
		t.Errorf("defaultFileName() = %q, expected sanitized name", bad)
	}
}

func TestFilePrefix(t *testing.T) {
	cases := map[db.DbObjectType]string{
		db.StoredProcedure: "sp",
		db.Table:           "table",
		db.Column:          "col",
		db.Function:        "func",
		db.Trigger:         "trg",
		db.View:            "view",
	}
	for objType, expected := range cases {
		if got := objType.FilePrefix(); got != expected {
			t.Errorf("FilePrefix(%s) = %q, expected %q", objType, got, expected)
		}
	}
}

func TestValueToString(t *testing.T) {
	if got := valueToString(nil); got != nil {
		t.Errorf("valueToString(nil) = %v, expected nil", got)
	}

	if got := valueToString([]byte("hello")); got == nil || *got != "hello" {
		t.Errorf("valueToString([]byte) = %v, expected \"hello\"", got)
	}

	if got := valueToString("plain"); got == nil || *got != "plain" {
		t.Errorf("valueToString(string) = %v, expected \"plain\"", got)
	}

	if got := valueToString(int64(42)); got == nil || *got != "42" {
		t.Errorf("valueToString(int64) = %v, expected \"42\"", got)
	}

	ts := time.Date(2024, 5, 1, 13, 30, 15, 0, time.UTC)
	if got := valueToString(ts); got == nil || !strings.HasPrefix(*got, "2024-05-01 13:30:15") {
		t.Errorf("valueToString(time.Time) = %v, expected formatted timestamp", got)
	}
}
