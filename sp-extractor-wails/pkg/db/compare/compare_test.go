package compare

import (
	"strings"
	"testing"

	"sp-extractor-wails/pkg/db"
)

var ws = Options{IgnoreWhitespace: true}

func TestEqualTextNormalization(t *testing.T) {
	cases := []struct {
		name string
		a, b string
		opts Options
		want bool
	}{
		{"identical", "SELECT 1", "SELECT 1", Options{}, true},
		{"crlf vs lf", "SELECT 1\r\nFROM t", "SELECT 1\nFROM t", Options{}, true},
		{"trailing spaces", "SELECT 1   \nFROM t", "SELECT 1\nFROM t", Options{}, true},
		{"indentation strict", "  SELECT 1", "SELECT 1", Options{}, false},
		{"indentation ignored", "  SELECT   1", "SELECT 1", ws, true},
		{"blank lines ignored", "A\n\n\nB", "A\nB", ws, true},
		{"blank lines strict", "A\n\nB", "A\nB", Options{}, false},
		{"case strict", "select 1", "SELECT 1", ws, false},
		{"case ignored", "select 1", "SELECT 1", Options{IgnoreWhitespace: true, IgnoreCase: true}, true},
		{"alter vs create", "ALTER PROCEDURE dbo.p AS SELECT 1", "CREATE PROCEDURE dbo.p AS SELECT 1", ws, true},
		{"create or alter", "CREATE OR ALTER PROC dbo.p AS SELECT 1", "create procedure dbo.p AS SELECT 1", ws, true},
		{"header kind differs", "CREATE VIEW dbo.p AS SELECT 1", "CREATE PROCEDURE dbo.p AS SELECT 1", ws, false},
		{"line comment ignored", "SELECT 1 -- uno\nFROM t", "SELECT 1\nFROM t", Options{IgnoreWhitespace: true, IgnoreComments: true}, true},
		{"comment-only line ignored", "-- nota\nSELECT 1", "SELECT 1", Options{IgnoreWhitespace: true, IgnoreComments: true}, true},
		{"block comment ignored", "/* a\nb */\nSELECT 1 /* c */", "SELECT 1", Options{IgnoreWhitespace: true, IgnoreComments: true}, true},
		{"comment kept by default", "SELECT 1 -- uno", "SELECT 1", ws, false},
		{"dashes in string kept", "SELECT '--x'", "SELECT ''", Options{IgnoreWhitespace: true, IgnoreComments: true}, false},
		{"real change", "SELECT 1", "SELECT 2", ws, false},
	}
	for _, c := range cases {
		if got := equalText(c.a, c.b, c.opts); got != c.want {
			t.Errorf("%s: equalText = %v, want %v", c.name, got, c.want)
		}
	}
}

func proc(schema, name, def string) Entry {
	return Entry{Type: db.StoredProcedure, Schema: schema, Name: name, Definition: def}
}

func TestCompareClassifiesObjects(t *testing.T) {
	src := []Entry{
		proc("dbo", "same", "SELECT 1"),
		proc("dbo", "diff", "SELECT 1"),
		proc("dbo", "onlyA", "SELECT 1"),
		{Type: db.View, Schema: "dbo", Name: "v", Definition: "x"},
	}
	dst := []Entry{
		proc("DBO", "SAME", "SELECT 1"), // names are case-insensitive
		proc("dbo", "diff", "SELECT 2"),
		proc("dbo", "onlyB", "SELECT 1"),
		{Type: db.View, Schema: "dbo", Name: "v", Definition: "x"},
	}
	res := Compare(db.SQLServer, src, dst, ws)
	want := Summary{Same: 2, Different: 1, OnlySource: 1, OnlyTarget: 1}
	if res.Summary != want {
		t.Fatalf("summary = %+v, want %+v", res.Summary, want)
	}
	status := map[string]Status{}
	for _, it := range res.Items {
		status[strings.ToLower(it.Name)] = it.Status
	}
	for name, st := range map[string]Status{"same": Same, "diff": Different, "onlya": OnlySource, "onlyb": OnlyTarget, "v": Same} {
		if status[name] != st {
			t.Errorf("%s = %q, want %q", name, status[name], st)
		}
	}
	// procedures come before views
	if res.Items[len(res.Items)-1].Type != db.View {
		t.Errorf("views must be listed after procedures: %+v", res.Items)
	}
}

func TestCompareEmptyIsNotNil(t *testing.T) {
	if res := Compare(db.SQLServer, nil, nil, ws); res.Items == nil {
		t.Fatal("Items must be an empty slice so the frontend never receives null")
	}
}

func TestKeyIgnoresMySQLSchema(t *testing.T) {
	a := Key(db.MySQL, db.DbObject{Type: db.StoredProcedure, Schema: "dev", Name: "p"})
	b := Key(db.MySQL, db.DbObject{Type: db.StoredProcedure, Schema: "prod", Name: "p"})
	if a != b {
		t.Errorf("MySQL keys must not depend on the database name: %q vs %q", a, b)
	}
	c := Key(db.PostgreSQL, db.DbObject{Type: db.StoredProcedure, Schema: "a", Name: "p"})
	d := Key(db.PostgreSQL, db.DbObject{Type: db.StoredProcedure, Schema: "b", Name: "p"})
	if c == d {
		t.Error("PostgreSQL keys must keep the schema")
	}
}

func TestDiffTextRows(t *testing.T) {
	a := "CREATE PROCEDURE p\nAS\nSELECT 1\nSELECT 2\nSELECT 3"
	b := "CREATE PROCEDURE p\nAS\nSELECT 1\nSELECT 20\nSELECT 3\nSELECT 4"
	d := DiffText(a, b, Options{})
	if d.Same {
		t.Fatal("texts differ")
	}
	if d.Changed != 1 || d.Added != 1 || d.Removed != 0 {
		t.Errorf("stats = changed %d added %d removed %d, want 1/1/0", d.Changed, d.Added, d.Removed)
	}
	var kinds []string
	for _, r := range d.Rows {
		kinds = append(kinds, r.Kind)
	}
	if got := strings.Join(kinds, ","); got != "eq,eq,eq,chg,eq,add" {
		t.Errorf("row kinds = %s", got)
	}
	chg := d.Rows[3]
	if chg.A != "SELECT 2" || chg.B != "SELECT 20" || chg.ALine != 4 || chg.BLine != 4 {
		t.Errorf("changed row = %+v", chg)
	}
	if last := d.Rows[5]; last.BLine != 6 || last.B != "SELECT 4" || last.A != "" {
		t.Errorf("added row = %+v", last)
	}
}

func TestDiffTextRemovedAndSame(t *testing.T) {
	d := DiffText("a\nb\nc", "a\nc", Options{})
	if d.Removed != 1 || d.Added != 0 || d.Changed != 0 {
		t.Errorf("stats = %+v", d)
	}
	if !DiffText("a\r\nb", "a\nb", Options{}).Same {
		t.Error("CRLF-only difference must be Same")
	}
}

func TestDiffTextShowsOriginalLinesWhenIgnoring(t *testing.T) {
	d := DiffText("Select 1\nFROM T", "SELECT 1\nFROM T\nWHERE 1=1", Options{IgnoreWhitespace: true, IgnoreCase: true})
	if d.Added != 1 || d.Changed != 0 {
		t.Fatalf("stats = %+v", d)
	}
	if d.Rows[0].Kind != RowEqual || d.Rows[0].A != "Select 1" || d.Rows[0].B != "SELECT 1" {
		t.Errorf("equal row must show each side's original text: %+v", d.Rows[0])
	}
}

func TestDiffTextHugeMiddleFallsBack(t *testing.T) {
	var a, b []string
	for i := 0; i < 2500; i++ {
		a = append(a, "a"+string(rune('0'+i%10))+strings.Repeat("x", i%7)+"-"+string(rune('a'+i%26)))
		b = append(b, "b"+string(rune('0'+i%10))+strings.Repeat("y", i%7)+"-"+string(rune('a'+i%26)))
	}
	d := DiffText(strings.Join(a, "\n"), strings.Join(b, "\n"), Options{})
	if d.Same || len(d.Rows) == 0 {
		t.Fatal("expected a non-empty diff")
	}
	if d.Changed != 2500 {
		t.Errorf("changed = %d, want 2500 (full replacement)", d.Changed)
	}
}

func col(name, typ string, nullable bool) db.MetaColumn {
	return db.MetaColumn{Name: name, DataType: typ, Nullable: nullable}
}

func areas(cs []TableChange) []string {
	var out []string
	for _, c := range cs {
		out = append(out, c.Area+":"+c.Name+":"+string(c.Status))
	}
	return out
}

func TestTableChangesColumns(t *testing.T) {
	src := db.TableMeta{Columns: []db.MetaColumn{
		col("Id", "int", false), col("Name", "nvarchar(50)", true), col("OnlyA", "int", true), {Name: "Qty", DataType: "int", Default: "((0))"},
	}}
	dst := db.TableMeta{Columns: []db.MetaColumn{
		col("ID", "INT", false), col("Name", "nvarchar(100)", true), col("OnlyB", "int", true), {Name: "Qty", DataType: "int", Default: "(0)"},
	}}
	got := strings.Join(areas(TableChanges(src, dst)), " ")
	want := "column:Name:different column:OnlyA:onlySource column:OnlyB:onlyTarget"
	if got != want {
		t.Errorf("changes = %s\nwant      %s", got, want)
	}
}

func TestTableChangesNullabilityAndIdentity(t *testing.T) {
	src := db.TableMeta{Columns: []db.MetaColumn{{Name: "Id", DataType: "int", Identity: true, IdentitySeed: 1, IdentityStep: 1}}}
	dst := db.TableMeta{Columns: []db.MetaColumn{{Name: "Id", DataType: "int", Nullable: true}}}
	cs := TableChanges(src, dst)
	if len(cs) != 1 || cs[0].Source != "int IDENTITY(1,1) NOT NULL" || cs[0].Target != "int NULL" {
		t.Errorf("changes = %+v", cs)
	}
}

func TestTableChangesPrimaryKey(t *testing.T) {
	a := db.TableMeta{PrimaryKey: []string{"A", "B"}, PrimaryName: "PK__x__1"}
	b := db.TableMeta{PrimaryKey: []string{"a", "b"}, PrimaryName: "PK__x__2"}
	if cs := TableChanges(a, b); len(cs) != 0 {
		t.Errorf("same PK columns under another name must not differ: %+v", cs)
	}
	cs := TableChanges(a, db.TableMeta{PrimaryKey: []string{"A"}})
	if len(cs) != 1 || cs[0].Status != Different || cs[0].Source != "(A, B)" || cs[0].Target != "(A)" {
		t.Errorf("changes = %+v", cs)
	}
	cs = TableChanges(a, db.TableMeta{})
	if len(cs) != 1 || cs[0].Status != OnlySource {
		t.Errorf("PK missing in target = %+v", cs)
	}
}

func TestTableChangesIndexesAndForeignKeys(t *testing.T) {
	src := db.TableMeta{
		Indexes: []db.MetaIndex{
			{Name: "IX_a", Columns: []string{"A"}},
			{Name: "IX_same", Columns: []string{"B"}, Unique: true},
			{Name: "IX_renamed_1", Columns: []string{"C"}},
			{Name: "IX_gone", Columns: []string{"D"}},
		},
		ForeignKeys: []db.ForeignKey{
			{Name: "FK_1", FromColumn: "X", ToSchema: "dbo", ToTable: "T", ToColumn: "Id"},
			{Name: "FK_auto_1", FromColumn: "Y", ToSchema: "dbo", ToTable: "U", ToColumn: "Id"},
		},
	}
	dst := db.TableMeta{
		Indexes: []db.MetaIndex{
			{Name: "ix_A", Columns: []string{"A", "Z"}}, // same name (case-insensitive), other columns
			{Name: "IX_same", Columns: []string{"B"}, Unique: true},
			{Name: "IX_renamed_2", Columns: []string{"C"}},
			{Name: "IX_new", Columns: []string{"E"}},
		},
		ForeignKeys: []db.ForeignKey{
			{Name: "fk_1", FromColumn: "X", ToSchema: "dbo", ToTable: "T", ToColumn: "Other"},
			{Name: "FK_auto_2", FromColumn: "Y", ToSchema: "dbo", ToTable: "U", ToColumn: "Id"},
		},
	}
	got := strings.Join(areas(TableChanges(src, dst)), " ")
	want := "index:IX_a:different index:IX_gone:onlySource index:IX_new:onlyTarget foreignKey:FK_1:different"
	if got != want {
		t.Errorf("changes = %s\nwant      %s", got, want)
	}
}

func TestNormDefault(t *testing.T) {
	for in, want := range map[string]string{
		"((0))": "0", "(getdate())": "getdate()", "(N'x')": "n'x'", "(a)+(b)": "(a)+(b)", "  ": "", "((1)) ": "1",
	} {
		if got := normDefault(in); got != want {
			t.Errorf("normDefault(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestCompareTables(t *testing.T) {
	m1 := db.TableMeta{Columns: []db.MetaColumn{col("Id", "int", false)}}
	m2 := db.TableMeta{Columns: []db.MetaColumn{col("Id", "bigint", false)}}
	tbl := func(name string, m *db.TableMeta) Entry {
		return Entry{Type: db.Table, Schema: "dbo", Name: name, Table: m}
	}
	res := Compare(db.SQLServer,
		[]Entry{tbl("same", &m1), tbl("diff", &m1), tbl("onlyA", &m1)},
		[]Entry{tbl("same", &m1), tbl("diff", &m2), tbl("onlyB", &m1)},
		ws)
	want := Summary{Same: 1, Different: 1, OnlySource: 1, OnlyTarget: 1}
	if res.Summary != want {
		t.Errorf("summary = %+v, want %+v", res.Summary, want)
	}
}

func TestHeaderCaseAfterPreamble(t *testing.T) {
	a := "SET ANSI_NULLS ON\nGO\ncreate proc dbo.p as select 1"
	b := "SET ANSI_NULLS ON\nGO\nCREATE PROCEDURE dbo.p AS SELECT 1"
	opts := Options{IgnoreWhitespace: true}
	la := prepare(a, opts)
	if la[2].text != "CREATE PROCEDURE dbo.p as select 1" {
		t.Fatalf("display text not uppercased: %q", la[2].text)
	}
	if !equalText(strings.Replace(a, "as select 1", "AS SELECT 1", 1), b, opts) {
		t.Fatal("headers with different casing should match")
	}
}
