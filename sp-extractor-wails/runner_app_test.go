package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestScanSqlFolderAndRead(t *testing.T) {
	tmpDir := t.TempDir()

	// Create subdirectories
	subDir1 := filepath.Join(tmpDir, "migrations")
	subDir2 := filepath.Join(tmpDir, "migrations", "nested")
	if err := os.MkdirAll(subDir2, 0755); err != nil {
		t.Fatalf("MkdirAll error: %v", err)
	}

	// Create .sql files and a non-sql file
	file1 := filepath.Join(tmpDir, "01_root.sql")
	file2 := filepath.Join(subDir1, "02_mig.sql")
	file3 := filepath.Join(subDir2, "03_nested.SQL")
	fileIgnored := filepath.Join(tmpDir, "readme.txt")

	if err := os.WriteFile(file1, []byte("SELECT 1;"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file2, []byte("\ufeffSELECT 2;"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(file3, []byte("SELECT 3;"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fileIgnored, []byte("ignore me"), 0644); err != nil {
		t.Fatal(err)
	}

	app := NewApp()
	files, err := app.ScanSqlFolder(tmpDir)
	if err != nil {
		t.Fatalf("ScanSqlFolder failed: %v", err)
	}

	if len(files) != 3 {
		t.Fatalf("expected 3 sql files, got %d", len(files))
	}

	// Check folders
	byName := make(map[string]ScriptFile)
	for _, f := range files {
		byName[f.FileName] = f
	}

	if f, ok := byName["01_root.sql"]; !ok || f.Folder != "" {
		t.Errorf("expected 01_root.sql with empty folder, got %+v", f)
	}
	if f, ok := byName["02_mig.sql"]; !ok || f.Folder != "migrations" {
		t.Errorf("expected 02_mig.sql with folder 'migrations', got %+v", f)
	}
	if f, ok := byName["03_nested.SQL"]; !ok || f.Folder != "migrations/nested" {
		t.Errorf("expected 03_nested.SQL with folder 'migrations/nested', got %+v", f)
	}

	// Test ReadSqlFile (BOM strip)
	content2, err := app.ReadSqlFile(file2)
	if err != nil {
		t.Fatalf("ReadSqlFile failed: %v", err)
	}
	if content2 != "SELECT 2;" {
		t.Errorf("expected 'SELECT 2;', got '%s'", content2)
	}
}

func TestDecodeSqlBytesEncodings(t *testing.T) {
	// 1. Plain UTF-8 with Spanish accents
	utf8Text := "SELECT 'canción, año, éxito, ¿estás bien?';"
	if res := decodeSqlBytes([]byte(utf8Text)); res != utf8Text {
		t.Errorf("UTF-8 mismatch. Got: %s, Want: %s", res, utf8Text)
	}

	// 2. UTF-8 with BOM
	utf8Bom := append([]byte{0xEF, 0xBB, 0xBF}, []byte("SELECT 'BOM test';")...)
	if res := decodeSqlBytes(utf8Bom); res != "SELECT 'BOM test';" {
		t.Errorf("UTF-8 BOM mismatch. Got: %s", res)
	}

	// 3. Windows-1252 (ANSI) with ñ (0xF1), á (0xE1), ó (0xF3), ¿ (0xBF)
	// In Windows-1252: "SELECT 'año';" -> 'a'=0x61, 'ñ'=0xF1, 'o'=0x6F
	win1252Bytes := []byte{
		'S', 'E', 'L', 'E', 'C', 'T', ' ', '\'',
		'a', 0xF1, 'o', // año
		' ', 0xBF,      // ¿
		'e', 's', 't', 0xE1, 's', // estás
		'?', '\'', ';',
	}
	expectedWin1252 := "SELECT 'año ¿estás?';"
	if res := decodeSqlBytes(win1252Bytes); res != expectedWin1252 {
		t.Errorf("Windows-1252 decode mismatch. Got: %s, Want: %s", res, expectedWin1252)
	}

	// 4. UTF-16 LE with BOM (0xFF, 0xFE)
	// "SELECT 1" in UTF-16 LE
	utf16Le := []byte{
		0xFF, 0xFE, // BOM
		'S', 0x00,
		'E', 0x00,
		'L', 0x00,
		'E', 0x00,
		'C', 0x00,
		'T', 0x00,
		' ', 0x00,
		'1', 0x00,
	}
	if res := decodeSqlBytes(utf16Le); res != "SELECT 1" {
		t.Errorf("UTF-16 LE decode mismatch. Got: %s, Want: SELECT 1", res)
	}

	// 5. UTF-16 BE with BOM (0xFE, 0xFF)
	utf16Be := []byte{
		0xFE, 0xFF, // BOM
		0x00, 'S',
		0x00, 'E',
		0x00, 'L',
		0x00, 'E',
		0x00, 'C',
		0x00, 'T',
		0x00, ' ',
		0x00, '2',
	}
	if res := decodeSqlBytes(utf16Be); res != "SELECT 2" {
		t.Errorf("UTF-16 BE decode mismatch. Got: %s, Want: SELECT 2", res)
	}
}
