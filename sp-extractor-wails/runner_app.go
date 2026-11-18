package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
)

// ScriptFile represents a SQL script file found on disk.
type ScriptFile struct {
	ID       string `json:"id"`
	Path     string `json:"path"`
	Name     string `json:"name"`
	FileName string `json:"fileName"`
	Folder   string `json:"folder"`
	ModTime  int64  `json:"modTime"`
	Size     int64  `json:"size"`
}

// decodeSqlBytes detects and converts text from UTF-8 (with or without BOM),
// UTF-16 LE/BE, and Windows-1252 / ANSI to standard UTF-8 string.
func decodeSqlBytes(raw []byte) string {
	if len(raw) == 0 {
		return ""
	}

	// 1. UTF-8 with BOM: 0xEF, 0xBB, 0xBF
	if len(raw) >= 3 && raw[0] == 0xEF && raw[1] == 0xBB && raw[2] == 0xBF {
		return string(raw[3:])
	}

	// 2. UTF-16 LE with BOM: 0xFF, 0xFE
	if len(raw) >= 2 && raw[0] == 0xFF && raw[1] == 0xFE {
		decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
		b, _, err := transform.Bytes(decoder, raw[2:])
		if err == nil {
			return string(b)
		}
	}

	// 3. UTF-16 BE with BOM: 0xFE, 0xFF
	if len(raw) >= 2 && raw[0] == 0xFE && raw[1] == 0xFF {
		decoder := unicode.UTF16(unicode.BigEndian, unicode.IgnoreBOM).NewDecoder()
		b, _, err := transform.Bytes(decoder, raw[2:])
		if err == nil {
			return string(b)
		}
	}

	// 4. UTF-16 LE without BOM heuristic:
	// If the file consists of UTF-16 characters where second byte is null in ASCII range
	if len(raw) >= 4 && len(raw)%2 == 0 {
		nullCount := 0
		sampleLen := len(raw)
		if sampleLen > 100 {
			sampleLen = 100
		}
		for i := 1; i < sampleLen; i += 2 {
			if raw[i] == 0x00 {
				nullCount++
			}
		}
		if nullCount > sampleLen/4 {
			decoder := unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM).NewDecoder()
			b, _, err := transform.Bytes(decoder, raw)
			if err == nil {
				return string(b)
			}
		}
	}

	// 5. Check if it's already valid UTF-8
	if utf8.Valid(raw) {
		return strings.TrimPrefix(string(raw), "\ufeff")
	}

	// 6. Windows-1252 / ANSI / ISO-8859-1 (standard for Spanish Windows SSMS scripts)
	decoder := charmap.Windows1252.NewDecoder()
	decoded, _, err := transform.Bytes(decoder, raw)
	if err == nil {
		return string(decoded)
	}

	// Fallback
	return strings.TrimPrefix(string(raw), "\ufeff")
}

// PickSqlDirectory opens a folder picker specifically titled for selecting SQL scripts.
func (a *App) PickSqlDirectory() (string, error) {
	path, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Seleccionar carpeta con scripts SQL",
	})
	return path, err
}

// OpenMultipleSqlFiles opens a native multi-file dialog and returns metadata for chosen .sql files.
func (a *App) OpenMultipleSqlFiles() ([]ScriptFile, error) {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Seleccionar archivos SQL",
		Filters: []runtime.FileFilter{
			{DisplayName: "SQL (*.sql)", Pattern: "*.sql"},
			{DisplayName: "Todos los archivos (*.*)", Pattern: "*.*"},
		},
	})
	if err != nil || len(paths) == 0 {
		return nil, err
	}

	var results []ScriptFile
	for _, p := range paths {
		if !strings.EqualFold(filepath.Ext(p), ".sql") {
			continue
		}
		info, err := os.Stat(p)
		if err != nil {
			continue
		}
		base := filepath.Base(p)
		ext := filepath.Ext(base)
		name := strings.TrimSuffix(base, ext)
		slashPath := filepath.ToSlash(p)

		results = append(results, ScriptFile{
			ID:       slashPath,
			Path:     p,
			Name:     name,
			FileName: base,
			Folder:   "",
			ModTime:  info.ModTime().UnixMilli(),
			Size:     info.Size(),
		})
	}

	return results, nil
}

// ScanSqlFolder scans a folder recursively and returns all .sql files found.
func (a *App) ScanSqlFolder(folderPath string) ([]ScriptFile, error) {
	if folderPath == "" {
		return nil, fmt.Errorf("ruta de carpeta vacía")
	}
	info, err := os.Stat(folderPath)
	if err != nil {
		return nil, fmt.Errorf("no se pudo acceder a la carpeta: %w", err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("la ruta especificada no es una carpeta")
	}

	var results []ScriptFile
	cleanRoot := filepath.Clean(folderPath)

	err = filepath.WalkDir(cleanRoot, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !strings.EqualFold(filepath.Ext(d.Name()), ".sql") {
			return nil
		}

		info, err := d.Info()
		if err != nil {
			return nil
		}

		relDir, err := filepath.Rel(cleanRoot, filepath.Dir(p))
		folder := ""
		if err == nil && relDir != "." {
			folder = filepath.ToSlash(relDir)
		}

		ext := filepath.Ext(d.Name())
		name := strings.TrimSuffix(d.Name(), ext)
		slashPath := filepath.ToSlash(p)

		results = append(results, ScriptFile{
			ID:       slashPath,
			Path:     p,
			Name:     name,
			FileName: d.Name(),
			Folder:   folder,
			ModTime:  info.ModTime().UnixMilli(),
			Size:     info.Size(),
		})
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error al escanear la carpeta: %w", err)
	}

	return results, nil
}

// ReadSqlFile reads and automatically decodes the text content of a .sql file from disk.
func (a *App) ReadSqlFile(path string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("ruta vacía")
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("no se pudo leer el archivo %s: %w", path, err)
	}
	return decodeSqlBytes(bytes), nil
}

// ExecuteScriptFile reads and runs a single .sql file in the given workspace.
func (a *App) ExecuteScriptFile(wsID, path string, maxRows int) (QueryResponse, error) {
	content, err := a.ReadSqlFile(path)
	if err != nil {
		return QueryResponse{}, err
	}
	return a.ExecuteQuery(wsID, content, maxRows)
}
