package extractors

import (
	"testing"

	"sp-extractor-wails/pkg/db"
)

func TestNewExtractor(t *testing.T) {
	sqlServer := New(db.SQLServer)
	if _, ok := sqlServer.(*SqlServerExtractor); !ok {
		t.Errorf("expected *SqlServerExtractor, got %T", sqlServer)
	}

	mysql := New(db.MySQL)
	if _, ok := mysql.(*MySQLExtractor); !ok {
		t.Errorf("expected *MySQLExtractor, got %T", mysql)
	}

	postgres := New(db.PostgreSQL)
	if _, ok := postgres.(*PostgresExtractor); !ok {
		t.Errorf("expected *PostgresExtractor, got %T", postgres)
	}

	fallback := New("UNKNOWN_ENGINE")
	if _, ok := fallback.(*SqlServerExtractor); !ok {
		t.Errorf("expected default *SqlServerExtractor for unknown engine, got %T", fallback)
	}
}
