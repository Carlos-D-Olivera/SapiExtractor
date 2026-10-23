package main

import (
	"reflect"
	"testing"
)

func TestSplitBatches(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"no go", "SELECT 1", []string{"SELECT 1"}},
		{
			"drop then create",
			"IF EXISTS (SELECT 1)\nBEGIN\n    DROP PROCEDURE p\nEND\nGO\n\n\nCREATE PROCEDURE p\nAS\nBEGIN\n    SELECT 1\nEND\n",
			[]string{"IF EXISTS (SELECT 1)\nBEGIN\n    DROP PROCEDURE p\nEND", "CREATE PROCEDURE p\nAS\nBEGIN\n    SELECT 1\nEND"},
		},
		{"crlf and case", "SELECT 1\r\ngo\r\nSELECT 2\r\n  Go  \r\n", []string{"SELECT 1", "SELECT 2"}},
		{"repeat", "INSERT INTO t VALUES (1)\nGO 3", []string{"INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (1)", "INSERT INTO t VALUES (1)"}},
		{"trailing comment", "SELECT 1\nGO -- fin\nSELECT 2", []string{"SELECT 1", "SELECT 2"}},
		{"go in block comment", "SELECT 1\n/*\nGO\n*/\nSELECT 2", []string{"SELECT 1\n/*\nGO\n*/\nSELECT 2"}},
		{"go in string", "SELECT 'a\nGO\nb'", []string{"SELECT 'a\nGO\nb'"}},
		{"go as part of a word", "SELECT 1\nGOTO fin\nGOLD", []string{"SELECT 1\nGOTO fin\nGOLD"}},
		{"empty batches dropped", "GO\n\nGO\nSELECT 1\nGO\n", []string{"SELECT 1"}},
		{"escaped quote", "SELECT 'it''s'\nGO\nSELECT 2", []string{"SELECT 'it''s'", "SELECT 2"}},
	}
	for _, c := range cases {
		if got := splitBatches(c.in); !reflect.DeepEqual(got, c.want) {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}
