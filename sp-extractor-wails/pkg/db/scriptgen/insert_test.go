package scriptgen

import (
	"strings"
	"testing"

	"sp-extractor-wails/pkg/db"
)

func str(s string) *string { return &s }

func sampleInsert() InsertData {
	return InsertData{
		Schema:  "dbo",
		Table:   "admConfiguracion",
		Columns: []string{"id", "clave", "valor", "activo"},
		Types:   []string{"INT", "NVARCHAR", "NVARCHAR", "BIT"},
		Rows: [][]*string{
			{str("1"), str("moneda"), str("MXN"), str("true")},
			{str("2"), str("nombre"), nil, str("false")},
		},
	}
}

func TestInsertSQLServer(t *testing.T) {
	out, err := GenerateInsert(db.SQLServer, sampleInsert(), InsertOptions{DetectTypes: true})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"INSERT INTO [dbo].[admConfiguracion] ([id], [clave], [valor], [activo])",
		"(1, N'moneda', N'MXN', 1)",
		"(2, N'nombre', NULL, 0)",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("output missing %q:\n%s", want, out)
		}
	}
	if strings.Contains(out, "IDENTITY_INSERT") {
		t.Errorf("identity insert must be opt-in:\n%s", out)
	}
}

func TestInsertQuotesWhenTypeDetectionDisabled(t *testing.T) {
	out, err := GenerateInsert(db.SQLServer, sampleInsert(), InsertOptions{DetectTypes: false})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "(N'1', N'moneda', N'MXN', N'true')") {
		t.Errorf("all values should be quoted:\n%s", out)
	}
}

func TestInsertEscaping(t *testing.T) {
	d := InsertData{
		Table:   "t",
		Columns: []string{"txt", "path"},
		Types:   []string{"VARCHAR", "VARCHAR"},
		Rows:    [][]*string{{str("O'Brien"), str(`C:\temp\a`)}},
	}
	// SQL Server: only single quotes are escaped.
	if out, _ := GenerateInsert(db.SQLServer, d, InsertOptions{}); !strings.Contains(out, "N'O''Brien'") {
		t.Errorf("sqlserver escaping wrong:\n%s", out)
	}
	// MySQL: backslashes and single quotes are escaped.
	out, _ := GenerateInsert(db.MySQL, d, InsertOptions{})
	if !strings.Contains(out, "'O''Brien'") || !strings.Contains(out, `'C:\\temp\\a'`) {
		t.Errorf("mysql escaping wrong:\n%s", out)
	}
}

func TestInsertPostgresBoolAndSchema(t *testing.T) {
	d := InsertData{
		Schema:  "public",
		Table:   "flags",
		Columns: []string{"id", "enabled"},
		Types:   []string{"int4", "boolean"},
		Rows:    [][]*string{{str("10"), str("t")}, {str("11"), str("f")}},
	}
	out, err := GenerateInsert(db.PostgreSQL, d, InsertOptions{DetectTypes: true})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, `INSERT INTO "public"."flags" ("id", "enabled")`) {
		t.Errorf("bad postgres table/columns:\n%s", out)
	}
	if !strings.Contains(out, "(10, TRUE)") || !strings.Contains(out, "(11, FALSE)") {
		t.Errorf("bad postgres booleans:\n%s", out)
	}
}

func TestInsertBatchingAndOptions(t *testing.T) {
	d := sampleInsert()
	d.Rows = append(d.Rows, []*string{str("3"), str("otro"), str("x"), str("false")})
	out, err := GenerateInsert(db.SQLServer, d, InsertOptions{
		DetectTypes:    true,
		BatchSize:      2,
		IdentityInsert: true,
		DeleteFirst:    true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "DELETE FROM [dbo].[admConfiguracion];") {
		t.Errorf("missing delete:\n%s", out)
	}
	if !strings.Contains(out, "SET IDENTITY_INSERT [dbo].[admConfiguracion] ON;") ||
		!strings.Contains(out, "SET IDENTITY_INSERT [dbo].[admConfiguracion] OFF;") {
		t.Errorf("missing identity insert guards:\n%s", out)
	}
	if got := strings.Count(out, "INSERT INTO"); got != 2 {
		t.Errorf("expected 2 batched INSERT statements, got %d:\n%s", got, out)
	}
}

func TestInsertIdentityOnlyForSQLServer(t *testing.T) {
	out, _ := GenerateInsert(db.MySQL, InsertData{
		Table:   "t",
		Columns: []string{"id"},
		Rows:    [][]*string{{str("1")}},
	}, InsertOptions{IdentityInsert: true})
	if strings.Contains(out, "IDENTITY_INSERT") {
		t.Errorf("identity insert is SQL Server only:\n%s", out)
	}
}

func TestInsertValidation(t *testing.T) {
	if _, err := GenerateInsert(db.SQLServer, InsertData{Table: "t", Columns: []string{"a"}}, InsertOptions{}); err == nil {
		t.Error("expected error for no rows")
	}
	if _, err := GenerateInsert(db.SQLServer, InsertData{Table: "", Columns: []string{"a"}, Rows: [][]*string{{str("x")}}}, InsertOptions{}); err == nil {
		t.Error("expected error for empty table")
	}
	bad := InsertData{Table: "t", Columns: []string{"a", "b"}, Rows: [][]*string{{str("x")}}}
	if _, err := GenerateInsert(db.SQLServer, bad, InsertOptions{}); err == nil {
		t.Error("expected error for row/column mismatch")
	}
}
