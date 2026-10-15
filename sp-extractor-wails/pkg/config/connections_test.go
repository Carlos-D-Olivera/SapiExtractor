package config

import (
	"testing"

	"sp-extractor-wails/pkg/db"
)

func TestSavedConnectionPasswordEncoding(t *testing.T) {
	conn := SavedConnection{}
	conn.SetPassword("SecretPass123!", true)

	if conn.PasswordBase64 == "" {
		t.Errorf("expected PasswordBase64 to be populated")
	}
	if got := conn.GetPassword(); got != "SecretPass123!" {
		t.Errorf("GetPassword() = %q, expected %q", got, "SecretPass123!")
	}

	// Disable remember password
	conn.SetPassword("SecretPass123!", false)
	if conn.PasswordBase64 != "" {
		t.Errorf("expected PasswordBase64 to be empty when remember=false")
	}
	if got := conn.GetPassword(); got != "" {
		t.Errorf("expected empty password, got %q", got)
	}
}

func TestSavedConnectionDisplayName(t *testing.T) {
	conn := SavedConnection{
		DbType: db.SQLServer,
		Host:   "db.example.com",
		Port:   "1433",
		DbName: "ProductionDB",
	}

	expected := "ProductionDB [SQL_SERVER - db.example.com:1433]"
	if got := conn.DisplayName(); got != expected {
		t.Errorf("DisplayName() = %q, expected %q", got, expected)
	}
}

func TestSameConn(t *testing.T) {
	c1 := SavedConnection{
		DbType: db.MySQL,
		Host:   "localhost",
		Port:   "3306",
		DbName: "app_db",
		User:   "root",
	}
	c2 := SavedConnection{
		DbType: db.MySQL,
		Host:   "localhost",
		Port:   "3306",
		DbName: "app_db",
		User:   "root",
	}
	c3 := SavedConnection{
		DbType: db.MySQL,
		Host:   "localhost",
		Port:   "3306",
		DbName: "different_db",
		User:   "root",
	}

	if !sameConn(c1, c2) {
		t.Errorf("expected c1 and c2 to be the same connection")
	}
	if sameConn(c1, c3) {
		t.Errorf("expected c1 and c3 to be different")
	}
}
