package compare

import (
	"strings"
	"testing"

	"sp-extractor-wails/pkg/db"
)

func TestCreateOrAlter(t *testing.T) {
	for in, want := range map[string]string{
		"CREATE PROCEDURE dbo.p AS SELECT 1":              "CREATE OR ALTER PROCEDURE dbo.p AS SELECT 1",
		"alter proc dbo.p as select 1":                    "CREATE OR ALTER proc dbo.p as select 1",
		"-- nota\n/* x */\nCREATE VIEW v AS SELECT 1":     "-- nota\n/* x */\nCREATE OR ALTER VIEW v AS SELECT 1",
		"CREATE OR ALTER FUNCTION f() RETURNS int AS ...": "CREATE OR ALTER FUNCTION f() RETURNS int AS ...",
		"SELECT 1": "SELECT 1",
	} {
		if got := CreateOrAlter(in); got != want {
			t.Errorf("CreateOrAlter(%q) = %q, want %q", in, got, want)
		}
	}
}

func obj(t db.DbObjectType, name string) db.DbObject {
	return db.DbObject{Type: t, Schema: "dbo", Name: name}
}

func TestBuildSyncRoutinesAndDrops(t *testing.T) {
	items := []SyncItem{
		{Object: obj(db.StoredProcedure, "p"), Status: Different, SourceDef: "CREATE PROCEDURE dbo.p AS SELECT 1"},
		{Object: obj(db.View, "gone"), Status: OnlyTarget},
	}
	safe := BuildSync(db.SQLServer, items, SyncOptions{})
	if !strings.Contains(safe, "CREATE OR ALTER PROCEDURE dbo.p AS SELECT 1;\nGO") {
		t.Errorf("routine not emitted:\n%s", safe)
	}
	if !strings.Contains(safe, "-- DROP VIEW IF EXISTS [dbo].[gone];") || strings.Contains(safe, "\nDROP VIEW") {
		t.Errorf("drop must be commented without IncludeDrops:\n%s", safe)
	}
	live := BuildSync(db.SQLServer, items, SyncOptions{IncludeDrops: true})
	if !strings.Contains(live, "\nDROP VIEW IF EXISTS [dbo].[gone];\nGO") {
		t.Errorf("drop must be active with IncludeDrops:\n%s", live)
	}
}

func TestBuildSyncTableAlterations(t *testing.T) {
	src := &db.TableMeta{Schema: "dbo", Name: "T", Columns: []db.MetaColumn{
		{Name: "Id", DataType: "int"},
		{Name: "New", DataType: "nvarchar(20)", Nullable: true},
		{Name: "Req", DataType: "int"},
		{Name: "Name", DataType: "nvarchar(100)", Nullable: true},
	}, Indexes: []db.MetaIndex{{Name: "IX_n", Columns: []string{"Name"}}}}
	dst := &db.TableMeta{Schema: "dbo", Name: "T", Columns: []db.MetaColumn{
		{Name: "Id", DataType: "int"},
		{Name: "Name", DataType: "nvarchar(50)"},
		{Name: "Old", DataType: "int", Nullable: true},
	}}
	items := []SyncItem{{Object: obj(db.Table, "T"), Status: Different, Source: src, Target: dst}}
	out := BuildSync(db.SQLServer, items, SyncOptions{})
	for _, want := range []string{
		"ALTER TABLE [dbo].[T] ADD [New] nvarchar(20) NULL;\nGO",
		"-- ⚠ Req es NOT NULL sin DEFAULT",
		"ALTER TABLE [dbo].[T] ADD [Req] int NOT NULL;",
		"ALTER TABLE [dbo].[T] ALTER COLUMN [Name] nvarchar(100) NULL;",
		"-- ALTER TABLE [dbo].[T] DROP COLUMN [Old];",
		"CREATE INDEX [IX_n] ON [dbo].[T] ([Name]);",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in:\n%s", want, out)
		}
	}
	if strings.Contains(out, "\nALTER TABLE [dbo].[T] DROP COLUMN") {
		t.Errorf("DROP COLUMN must be commented:\n%s", out)
	}
}

func TestBuildSyncNewTableFKsComeLast(t *testing.T) {
	a := &db.TableMeta{Schema: "dbo", Name: "A", Columns: []db.MetaColumn{{Name: "Id", DataType: "int"}, {Name: "BId", DataType: "int"}},
		ForeignKeys: []db.ForeignKey{{Name: "FK_A_B", FromSchema: "dbo", FromTable: "A", FromColumn: "BId", ToSchema: "dbo", ToTable: "B", ToColumn: "Id"}}}
	b := &db.TableMeta{Schema: "dbo", Name: "B", Columns: []db.MetaColumn{{Name: "Id", DataType: "int"}}}
	out := BuildSync(db.SQLServer, []SyncItem{
		{Object: obj(db.Table, "A"), Status: OnlySource, Source: a},
		{Object: obj(db.Table, "B"), Status: OnlySource, Source: b},
	}, SyncOptions{})
	fk, createB := strings.Index(out, "FOREIGN KEY"), strings.Index(out, "CREATE TABLE [dbo].[B]")
	if fk < 0 || createB < 0 || fk < createB {
		t.Errorf("FKs must come after every CREATE TABLE:\n%s", out)
	}
}

func TestBuildSyncEmptyAndOtherEngines(t *testing.T) {
	if out := BuildSync(db.SQLServer, nil, SyncOptions{}); !strings.HasPrefix(out, "-- No hay cambios") {
		t.Errorf("empty = %q", out)
	}
	src := &db.TableMeta{Schema: "public", Name: "t", Columns: []db.MetaColumn{{Name: "a", DataType: "int"}, {Name: "b", DataType: "text"}}}
	dst := &db.TableMeta{Schema: "public", Name: "t", Columns: []db.MetaColumn{{Name: "a", DataType: "int"}}}
	out := BuildSync(db.PostgreSQL, []SyncItem{{Object: obj(db.Table, "t"), Status: Different, Source: src, Target: dst}}, SyncOptions{})
	if !strings.Contains(out, "-- columna b:") || strings.Contains(out, "ALTER TABLE") {
		t.Errorf("non SQL Server column changes must only be reported:\n%s", out)
	}
	pg := BuildSync(db.PostgreSQL, []SyncItem{{Object: obj(db.Function, "f"), Status: OnlyTarget}}, SyncOptions{IncludeDrops: true})
	if !strings.Contains(pg, "hazlo a mano") {
		t.Errorf("PostgreSQL routine drop must be manual:\n%s", pg)
	}
}
