package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestAutoCompletesDefaults(t *testing.T) {
	if len(DefaultAutoCompletes) == 0 {
		t.Fatalf("expected DefaultAutoCompletes to have items")
	}

	foundSel := false
	for _, it := range DefaultAutoCompletes {
		if it.Code == "sel" {
			foundSel = true
			if it.Query != "SELECT * FROM " {
				t.Errorf("unexpected query for sel: %s", it.Query)
			}
			break
		}
	}
	if !foundSel {
		t.Errorf("expected 'sel' in DefaultAutoCompletes")
	}
}

func TestAutoCompletesSerialization(t *testing.T) {
	tmpDir, err := os.MkdirTemp("", "spextractor_test_*")
	if err != nil {
		t.Fatalf("failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tmpDir)

	testPath := filepath.Join(tmpDir, "autocompletes.json")

	items := []AutoCompleteItem{
		{ID: "test1", Code: "mytest", Query: "SELECT 1;", Seleccionar: true},
		{ID: "test2", Code: "chk2", Query: "SELECT * FROM tbl WHERE id = '#';", Seleccionar: false},
	}

	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		t.Fatalf("json.MarshalIndent error: %v", err)
	}

	if err := os.WriteFile(testPath, data, 0644); err != nil {
		t.Fatalf("os.WriteFile error: %v", err)
	}

	readBytes, err := os.ReadFile(testPath)
	if err != nil {
		t.Fatalf("os.ReadFile error: %v", err)
	}

	var loaded []AutoCompleteItem
	if err := json.Unmarshal(readBytes, &loaded); err != nil {
		t.Fatalf("json.Unmarshal error: %v", err)
	}

	if len(loaded) != 2 {
		t.Fatalf("expected 2 items, got %d", len(loaded))
	}

	if loaded[0].Code != "mytest" || !loaded[0].Seleccionar {
		t.Errorf("loaded[0] mismatch: %+v", loaded[0])
	}

	if loaded[1].Code != "chk2" || loaded[1].Seleccionar {
		t.Errorf("loaded[1] mismatch: %+v", loaded[1])
	}
}
