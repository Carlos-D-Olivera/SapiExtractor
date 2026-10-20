package extractors

import (
	"database/sql"
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

func TestMySQLDefault(t *testing.T) {
	cases := []struct {
		def   sql.NullString
		extra string
		want  string
	}{
		{sql.NullString{}, "", ""},
		{sql.NullString{String: "5", Valid: true}, "", "5"},
		{sql.NullString{String: "abc", Valid: true}, "", "'abc'"},
		{sql.NullString{String: "it's", Valid: true}, "", "'it''s'"},
		{sql.NullString{String: "CURRENT_TIMESTAMP", Valid: true}, "DEFAULT_GENERATED on update CURRENT_TIMESTAMP", "CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP"},
		{sql.NullString{String: "uuid()", Valid: true}, "DEFAULT_GENERATED", "(uuid())"},
	}
	for _, c := range cases {
		if got := mysqlDefault(c.def, c.extra); got != c.want {
			t.Errorf("mysqlDefault(%v, %q) = %q, want %q", c.def, c.extra, got, c.want)
		}
	}
}
