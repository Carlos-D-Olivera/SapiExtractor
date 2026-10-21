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

func TestBuildColumnFilter(t *testing.T) {
	cases := []struct {
		term      string
		wantConds []string
		wantArgs  []any
	}{
		{
			term:      "Numfactura",
			wantConds: []string{"c.name LIKE @p1 ESCAPE '\\'"},
			wantArgs:  []any{"%Numfactura%"},
		},
		{
			term:      "ControlFactura.",
			wantConds: []string{"t.name LIKE @p1 ESCAPE '\\'"},
			wantArgs:  []any{"%ControlFactura%"},
		},
		{
			term:      "ControlFactura.Numfactura",
			wantConds: []string{"t.name LIKE @p1 ESCAPE '\\'", "c.name LIKE @p2 ESCAPE '\\'"},
			wantArgs:  []any{"%ControlFactura%", "%Numfactura%"},
		},
		{
			term:      "[ControlFactura].[Numfactura]",
			wantConds: []string{"t.name LIKE @p1 ESCAPE '\\'", "c.name LIKE @p2 ESCAPE '\\'"},
			wantArgs:  []any{"%ControlFactura%", "%Numfactura%"},
		},
		{
			term:      "dbo.ControlFactura.Numfactura",
			wantConds: []string{"SCHEMA_NAME(t.schema_id) LIKE @p1 ESCAPE '\\'", "t.name LIKE @p2 ESCAPE '\\'", "c.name LIKE @p3 ESCAPE '\\'"},
			wantArgs:  []any{"%dbo%", "%ControlFactura%", "%Numfactura%"},
		},
		{
			term:      "",
			wantConds: nil,
			wantArgs:  nil,
		},
		{
			term:      ".",
			wantConds: nil,
			wantArgs:  nil,
		},
	}

	for _, c := range cases {
		conds, args := buildColumnFilter(c.term, 1)
		if len(conds) != len(c.wantConds) {
			t.Errorf("buildColumnFilter(%q) conds len = %d, want %d", c.term, len(conds), len(c.wantConds))
			continue
		}
		for i := range conds {
			if conds[i] != c.wantConds[i] {
				t.Errorf("buildColumnFilter(%q) cond[%d] = %q, want %q", c.term, i, conds[i], c.wantConds[i])
			}
		}
		if len(args) != len(c.wantArgs) {
			t.Errorf("buildColumnFilter(%q) args len = %d, want %d", c.term, len(args), len(c.wantArgs))
			continue
		}
		for i := range args {
			if args[i] != c.wantArgs[i] {
				t.Errorf("buildColumnFilter(%q) arg[%d] = %v, want %v", c.term, i, args[i], c.wantArgs[i])
			}
		}
	}
}
