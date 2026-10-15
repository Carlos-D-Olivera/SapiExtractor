package config

import (
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"time"

	"sp-extractor-wails/pkg/db"
)

const maxRecent = 15

// typeLabels maps engine constants to human-readable names.
var typeLabels = map[db.DatabaseType]string{
	db.SQLServer:  "SQL Server",
	db.MySQL:      "MySQL / MariaDB",
	db.PostgreSQL: "PostgreSQL",
}

// SavedConnection mirrors the Java SavedConnection model.
type SavedConnection struct {
	DbType           db.DatabaseType `json:"dbType"`
	Host             string          `json:"host"`
	Port             string          `json:"port"`
	DbName           string          `json:"dbName"`
	User             string          `json:"user"`
	PasswordBase64   string          `json:"passwordBase64"`
	RememberPassword bool            `json:"rememberPassword"`
	LastUsed         int64           `json:"lastUsed"`
}

// GetPassword decodes and returns the stored password (empty if not remembered).
func (c *SavedConnection) GetPassword() string {
	if !c.RememberPassword || c.PasswordBase64 == "" {
		return ""
	}
	b, err := base64.StdEncoding.DecodeString(c.PasswordBase64)
	if err != nil {
		return ""
	}
	return string(b)
}

// SetPassword encodes and stores the password (or clears it if remember=false).
func (c *SavedConnection) SetPassword(raw string, remember bool) {
	c.RememberPassword = remember
	if remember && raw != "" {
		c.PasswordBase64 = base64.StdEncoding.EncodeToString([]byte(raw))
	} else {
		c.PasswordBase64 = ""
	}
}

// DisplayName returns a human-readable label for the connection.
func (c *SavedConnection) DisplayName() string {
	dbName := c.DbName
	if dbName == "" {
		dbName = "(sin base)"
	}
	server := c.Host
	if server == "" {
		server = "localhost"
	}
	port := ""
	if c.Port != "" {
		port = ":" + c.Port
	}
	label := typeLabels[c.DbType]
	if label == "" {
		label = string(c.DbType)
	}
	return dbName + " [" + label + " - " + server + port + "]"
}

// configPath returns the path to the connections JSON file.
func configPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".spextractor")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "connections.json"), nil
}

// LoadConnections reads saved connections from disk, sorted by most-recently-used.
func LoadConnections() ([]SavedConnection, error) {
	path, err := configPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return []SavedConnection{}, nil
	}
	if err != nil {
		return nil, err
	}
	var list []SavedConnection
	if err := json.Unmarshal(data, &list); err != nil {
		return []SavedConnection{}, nil
	}
	sort.Slice(list, func(i, j int) bool { return list[i].LastUsed > list[j].LastUsed })
	return list, nil
}

// SaveConnection upserts a connection and persists the list to disk.
func SaveConnection(conn SavedConnection) error {
	list, _ := LoadConnections()
	filtered := list[:0]
	for _, c := range list {
		if !sameConn(c, conn) {
			filtered = append(filtered, c)
		}
	}
	conn.LastUsed = time.Now().UnixMilli()
	filtered = append([]SavedConnection{conn}, filtered...)
	if len(filtered) > maxRecent {
		filtered = filtered[:maxRecent]
	}
	return persist(filtered)
}

// DeleteConnection removes a connection from the persisted list.
func DeleteConnection(conn SavedConnection) error {
	list, _ := LoadConnections()
	filtered := list[:0]
	for _, c := range list {
		if !sameConn(c, conn) {
			filtered = append(filtered, c)
		}
	}
	return persist(filtered)
}

func sameConn(a, b SavedConnection) bool {
	return a.DbType == b.DbType && a.Host == b.Host && a.Port == b.Port &&
		a.DbName == b.DbName && a.User == b.User
}

func persist(list []SavedConnection) error {
	path, err := configPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, data, 0644)
}
