package exporter

import (
	"os"
	"path/filepath"
	"testing"
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
		got := SanitizeName(tc.input)
		if got != tc.expected {
			t.Errorf("SanitizeName(%q) = %q, expected %q", tc.input, got, tc.expected)
		}
	}
}

func TestWriteObject(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "spextractor_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	objName := "dbo.usp_Test"
	def := "CREATE PROCEDURE dbo.usp_Test AS SELECT 1;"

	err = WriteObject(tempDir, objName, def)
	if err != nil {
		t.Fatalf("WriteObject failed: %v", err)
	}

	expectedFile := filepath.Join(tempDir, "dbo.usp_Test.sql")
	content, err := os.ReadFile(expectedFile)
	if err != nil {
		t.Fatalf("failed to read output file: %v", err)
	}

	if string(content) != def {
		t.Errorf("file content = %q, expected %q", string(content), def)
	}
}

func TestEnsureDir(t *testing.T) {
	tempDir, err := os.MkdirTemp("", "spextractor_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	target := filepath.Join(tempDir, "nested", "subfolder")
	if err := EnsureDir(target); err != nil {
		t.Fatalf("EnsureDir failed: %v", err)
	}

	fi, err := os.Stat(target)
	if err != nil || !fi.IsDir() {
		t.Fatalf("expected directory to exist: %v", err)
	}
}
