package debug

import (
	"strings"
	"testing"
)

func TestWrittenTarget(t *testing.T) {
	cases := []struct {
		in   string
		want string // "" = not a write to a table
	}{
		{"INSERT INTO dbo.Pedidos (a, b) VALUES (1, 2)", "[dbo].[Pedidos]"},
		{"insert Pedidos (a) select a from Otra", "[Pedidos]"},
		{"UPDATE [dbo].[Pedidos] SET Estado = 'C' WHERE Id = 1", "[dbo].[Pedidos]"},
		{"UPDATE TOP (10) Pedidos SET a = 1", "[Pedidos]"},
		{"DELETE FROM dbo.Lineas WHERE IdPedido = 3", "[dbo].[Lineas]"},
		{"DELETE TOP (5) FROM Lineas", "[Lineas]"},
		{"MERGE INTO dbo.Stock AS t USING src s ON t.Id = s.Id WHEN MATCHED THEN UPDATE SET q = s.q;", "[dbo].[Stock]"},
		{"TRUNCATE TABLE dbo.Temporal", "[dbo].[Temporal]"},
		{"-- nota\n  UPDATE T SET a = 1", "[T]"},
		{"WITH c AS (SELECT Id FROM Pedidos WHERE x = 1) UPDATE p SET a = 1 FROM Pedidos p JOIN c ON c.Id = p.Id", "[Pedidos]"},
		{"WITH c AS (SELECT 1 AS x) DELETE FROM Lineas WHERE 1 = 1", "[Lineas]"},
		// aliases
		{"UPDATE p SET p.Estado = 'X' FROM dbo.Pedidos AS p INNER JOIN dbo.Clientes c ON c.Id = p.IdCliente", "[dbo].[Pedidos]"},
		{"DELETE l FROM Lineas l JOIN Pedidos p ON p.Id = l.IdPedido WHERE p.Estado = 'C'", "[Lineas]"},
		// not tables / not writes
		{"INSERT INTO #tmp VALUES (1)", ""},
		{"UPDATE @t SET a = 1", ""},
		{"SELECT * FROM Pedidos", ""},
		{"EXEC dbo.Otro", ""},
		{"IF @x > 0", ""},
		{"SET @a = 1", ""},
		{"SELECT a INTO #x FROM Pedidos", ""},
	}
	for _, c := range cases {
		got, ok := writtenTarget(c.in)
		if c.want == "" {
			if ok {
				t.Errorf("%q: expected no target, got %q", c.in, got)
			}
			continue
		}
		if !ok || got != c.want {
			t.Errorf("%q: got (%q, %v), want %q", c.in, got, ok, c.want)
		}
	}
}

func TestWrittenTablesDedupes(t *testing.T) {
	events := []rawEvent{
		{Kind: "stmt", Text: "UPDATE dbo.A SET x = 1"},
		{Kind: "stmt", Text: "insert into [dbo].[a] (x) values (1)"}, // same table, different case
		{Kind: "stmt", Text: "DELETE FROM B"},
		{Kind: "error", Text: "boom"},
		{Kind: "stmt", Text: "SELECT 1"},
	}
	got := writtenTables(events)
	if len(got) != 2 || got[0] != "[dbo].[A]" || got[1] != "[B]" {
		t.Errorf("writtenTables = %v", got)
	}
}

func TestSnapshotExpr(t *testing.T) {
	for typ, skip := range map[string]bool{
		"timestamp": true, "text": true, "image": true, "geography": true, "sql_variant": true,
		"int": false, "nvarchar": false, "datetime2": false, "varbinary": false, "money": false, "float": false, "uniqueidentifier": false,
	} {
		if got := snapshotExpr("c", typ); (got == "") != skip {
			t.Errorf("%s: expr %q, skipped=%v want %v", typ, got, got == "", skip)
		}
	}
	if e := snapshotExpr("a]b", "int"); !strings.Contains(e, "[a]]b]") {
		t.Errorf("column name must be quoted: %s", e)
	}
	if e := snapshotExpr("d", "datetime"); !strings.Contains(e, ", 121)") {
		t.Errorf("dates need an unambiguous format: %s", e)
	}
}

func s(v string) *string { return &v }

func TestDiffSnapshotsWithPrimaryKey(t *testing.T) {
	cols := []string{"Id", "Estado", "Nota"}
	before := [][]*string{
		{s("1"), s("A"), nil},
		{s("2"), s("A"), s("x")},
		{s("3"), s("A"), s("y")},
	}
	after := [][]*string{
		{s("1"), s("C"), nil},   // updated
		{s("2"), s("A"), s("x")}, // unchanged
		{s("4"), s("N"), nil},   // inserted (3 deleted)
	}
	dc := diffSnapshots(cols, []string{"Id"}, before, after)
	if dc.UpdatedCount != 1 || dc.InsertedCount != 1 || dc.DeletedCount != 1 {
		t.Fatalf("counts = %d updated, %d inserted, %d deleted", dc.UpdatedCount, dc.InsertedCount, dc.DeletedCount)
	}
	u := dc.Updated[0]
	if u.Key != "Id=1" || len(u.Changes) != 1 || u.Changes[0].Column != "Estado" || *u.Changes[0].Before != "A" || *u.Changes[0].After != "C" {
		t.Errorf("update = %+v", u)
	}
	if *dc.Inserted[0][0] != "4" || *dc.Deleted[0][0] != "3" {
		t.Errorf("inserted/deleted = %v / %v", dc.Inserted, dc.Deleted)
	}
	if dc.RowsBefore != 3 || dc.RowsAfter != 3 {
		t.Errorf("rows = %d -> %d", dc.RowsBefore, dc.RowsAfter)
	}
}

func TestDiffTreatsNullAndEmptyStringAsDifferent(t *testing.T) {
	cols := []string{"Id", "Nota"}
	dc := diffSnapshots(cols, []string{"Id"},
		[][]*string{{s("1"), nil}}, [][]*string{{s("1"), s("")}})
	if dc.UpdatedCount != 1 {
		t.Errorf("NULL -> '' must count as an update: %+v", dc)
	}
	same := diffSnapshots(cols, []string{"Id"}, [][]*string{{s("1"), nil}}, [][]*string{{s("1"), nil}})
	if same.UpdatedCount+same.InsertedCount+same.DeletedCount != 0 {
		t.Errorf("identical NULLs must not differ: %+v", same)
	}
}

func TestDiffWithoutPrimaryKey(t *testing.T) {
	cols := []string{"A", "B"}
	before := [][]*string{{s("1"), s("x")}, {s("1"), s("x")}, {s("2"), s("y")}}
	after := [][]*string{{s("1"), s("x")}, {s("2"), s("z")}} // one duplicate removed, one row changed
	dc := diffSnapshots(cols, nil, before, after)
	if dc.UpdatedCount != 0 || dc.DeletedCount != 2 || dc.InsertedCount != 1 {
		t.Errorf("counts = %d updated, %d inserted, %d deleted", dc.UpdatedCount, dc.InsertedCount, dc.DeletedCount)
	}
}

func TestDiffCapsListedRowsButKeepsCounts(t *testing.T) {
	cols := []string{"Id"}
	var after [][]*string
	for i := 0; i < MaxChangesShown+50; i++ {
		after = append(after, []*string{s(string(rune('a'+i%26)) + strings.Repeat("x", i))})
	}
	dc := diffSnapshots(cols, []string{"Id"}, nil, after)
	if dc.InsertedCount != MaxChangesShown+50 || len(dc.Inserted) != MaxChangesShown {
		t.Errorf("inserted count %d, listed %d", dc.InsertedCount, len(dc.Inserted))
	}
}
