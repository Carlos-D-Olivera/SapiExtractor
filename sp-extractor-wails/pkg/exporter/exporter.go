package exporter

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// ProgressEvent is emitted after each file is exported.
type ProgressEvent struct {
	Current int    `json:"current"`
	Total   int    `json:"total"`
	Name    string `json:"name"`
	Percent int    `json:"percent"`
}

var illegalChars = []string{"\\", "/", ":", "*", "?", "\"", "<", ">", "|"}

// SanitizeName replaces illegal filename characters with underscores.
func SanitizeName(name string) string {
	for _, c := range illegalChars {
		name = strings.ReplaceAll(name, c, "_")
	}
	return strings.TrimSpace(name)
}

// WriteObject writes a single DB object definition to outDir as a .sql file.
func WriteObject(outDir string, fullName string, definition string) error {
	safeName := SanitizeName(fullName)
	if safeName == "" {
		safeName = "object"
	}
	filePath := filepath.Join(outDir, safeName+".sql")
	content := definition
	if content == "" {
		content = "-- No definition available"
	}
	return os.WriteFile(filePath, []byte(content), 0644)
}

// EnsureDir creates outDir if it doesn't exist.
func EnsureDir(outDir string) error {
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return fmt.Errorf("could not create output directory: %w", err)
	}
	return nil
}

// ContextDone returns true if the context has been cancelled.
func ContextDone(ctx context.Context) bool {
	select {
	case <-ctx.Done():
		return true
	default:
		return false
	}
}
