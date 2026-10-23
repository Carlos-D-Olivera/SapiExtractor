package debug

import (
	"strings"
	"testing"
)

const procSrc = `CREATE PROCEDURE dbo.p @x INT
AS
BEGIN
    IF @x > 0
    BEGIN
        UPDATE T SET a = 1;
    END
    ELSE
    BEGIN
        DELETE FROM T;
    END
    SELECT 1;
END`

func srcs(text string) map[string]*srcInfo {
	return map[string]*srcInfo{"10": {Source: Source{Key: "10", Name: "dbo.p", Text: text}, idx: newSrcIndex(text)}}
}

// stmt builds an event for the first occurrence of sub in text (UTF-16 byte offsets).
func stmt(text, sub string, level int) rawEvent {
	i := strings.Index(text, sub)
	return rawEvent{
		Kind: "stmt", ObjectID: 10, ObjectName: "p", Level: level, Text: sub,
		Offset: int64(i * 2), OffsetEnd: int64((i + len(sub)) * 2), Duration: 1000, Rows: 1,
	}
}

func flat(t *testing.T, text string, events []rawEvent) []*Step {
	t.Helper()
	s := srcs(text)
	steps := buildSteps(events, s)
	annotateBranches(steps, s)
	return steps
}

func TestIfThenBranch(t *testing.T) {
	steps := flat(t, procSrc, []rawEvent{
		stmt(procSrc, "IF @x > 0", 1),
		stmt(procSrc, "UPDATE T SET a = 1;", 1),
		stmt(procSrc, "SELECT 1;", 1),
	})
	if steps[0].Branch != "THEN" {
		t.Errorf("branch = %q, want THEN", steps[0].Branch)
	}
	if steps[0].Line != 4 || steps[1].Line != 6 || steps[2].Line != 12 {
		t.Errorf("lines = %d,%d,%d want 4,6,12", steps[0].Line, steps[1].Line, steps[2].Line)
	}
}

func TestIfElseBranch(t *testing.T) {
	steps := flat(t, procSrc, []rawEvent{
		stmt(procSrc, "IF @x > 0", 1),
		stmt(procSrc, "DELETE FROM T;", 1),
		stmt(procSrc, "SELECT 1;", 1),
	})
	if steps[0].Branch != "ELSE" {
		t.Errorf("branch = %q, want ELSE", steps[0].Branch)
	}
}

func TestIfSkippedAndNoBegin(t *testing.T) {
	src := "CREATE PROCEDURE dbo.p AS\nIF @x > 0\n    UPDATE T SET a = 1;\nSELECT 2;"
	taken := flat(t, src, []rawEvent{stmt(src, "IF @x > 0", 1), stmt(src, "UPDATE T SET a = 1;", 1), stmt(src, "SELECT 2;", 1)})
	if taken[0].Branch != "THEN" {
		t.Errorf("taken branch = %q, want THEN", taken[0].Branch)
	}
	skipped := flat(t, src, []rawEvent{stmt(src, "IF @x > 0", 1), stmt(src, "SELECT 2;", 1)})
	if skipped[0].Branch != "SALTADO" {
		t.Errorf("skipped branch = %q, want SALTADO", skipped[0].Branch)
	}
}

func TestNestedStatementsDoNotConfuseBranch(t *testing.T) {
	// The IF body starts with an EXEC whose own statements (level 2) are recorded first.
	src := "CREATE PROCEDURE dbo.p AS\nIF @x > 0\nBEGIN\n    EXEC dbo.q;\nEND\nSELECT 1;"
	child := rawEvent{Kind: "stmt", ObjectID: 11, ObjectName: "q", Level: 2, Text: "SELECT 9", Offset: 0, OffsetEnd: 16}
	steps := flat(t, src, []rawEvent{stmt(src, "IF @x > 0", 1), child, stmt(src, "EXEC dbo.q;", 1), stmt(src, "SELECT 1;", 1)})
	if steps[0].Branch != "THEN" {
		t.Errorf("branch = %q, want THEN", steps[0].Branch)
	}
}

func TestWhileLoop(t *testing.T) {
	src := "CREATE PROCEDURE dbo.p AS\nWHILE @i < 2\nBEGIN\n    SET @i += 1;\nEND\nSELECT 1;"
	w, b, after := "WHILE @i < 2", "SET @i += 1;", "SELECT 1;"
	steps := flat(t, src, []rawEvent{
		stmt(src, w, 1), stmt(src, b, 1), stmt(src, w, 1), stmt(src, b, 1), stmt(src, w, 1), stmt(src, after, 1),
	})
	want := []string{"ENTRA", "", "ENTRA", "", "SALE", ""}
	for i, s := range steps {
		if s.Branch != want[i] {
			t.Errorf("step %d branch = %q, want %q", i, s.Branch, want[i])
		}
	}
	if steps[0].Note != "evaluación 1 de 3" || steps[4].Note != "evaluación 3 de 3" {
		t.Errorf("notes = %q / %q", steps[0].Note, steps[4].Note)
	}
}

func TestNestGroupsChildrenUnderCaller(t *testing.T) {
	events := []rawEvent{
		{Kind: "stmt", Level: 2, Text: "INSERT a"},
		{Kind: "stmt", Level: 3, Text: "SELECT deep"},
		{Kind: "stmt", Level: 2, Text: "EXEC c"}, // calls level-3 statement above
		{Kind: "stmt", Level: 1, Text: "EXEC b"}, // calls both level-2 statements
		{Kind: "stmt", Level: 1, Text: "SELECT end"},
	}
	tree := nest(buildSteps(events, nil))
	if len(tree) != 2 {
		t.Fatalf("roots = %d, want 2", len(tree))
	}
	execB := tree[0]
	if execB.Text != "EXEC b" || len(execB.Children) != 2 {
		t.Fatalf("EXEC b: %+v", execB)
	}
	if execC := execB.Children[1]; execC.Text != "EXEC c" || len(execC.Children) != 1 || execC.Children[0].Text != "SELECT deep" {
		t.Errorf("EXEC c: %+v", execC)
	}
}

func TestMergeRepeats(t *testing.T) {
	events := []rawEvent{
		{Kind: "stmt", Level: 1, Line: 5, Text: "INSERT x", Duration: 100, Rows: 1},
		{Kind: "stmt", Level: 1, Line: 5, Text: "INSERT x", Duration: 200, Rows: 1},
		{Kind: "stmt", Level: 1, Line: 5, Text: "INSERT x", Duration: 300, Rows: 1},
		{Kind: "stmt", Level: 1, Line: 6, Text: "SELECT y", Duration: 10},
	}
	tree := mergeRepeats(nest(buildSteps(events, nil)))
	if len(tree) != 2 || tree[0].Count != 3 || tree[0].DurationUs != 600 || tree[0].Rows != 3 {
		t.Errorf("merge: %+v", tree[0])
	}
}

func TestErrorStepStaysAtCurrentLevel(t *testing.T) {
	events := []rawEvent{
		{Kind: "stmt", Level: 2, Text: "UPDATE t"},
		{Kind: "error", Text: "boom", ErrNo: 547, Severity: 16},
	}
	steps := buildSteps(events, nil)
	if steps[1].Kind != "error" || steps[1].Level != 2 || steps[1].ErrorNumber != 547 {
		t.Errorf("error step: %+v", steps[1])
	}
}

func TestUnicodeOffsets(t *testing.T) {
	// "ñ" is one UTF-16 unit; an emoji takes two. Offsets must still land on the right line.
	src := "-- ñandú 😀\nSELECT 1;\nSELECT 2;"
	ix := newSrcIndex(src)
	i := strings.Index(src, "SELECT 2;")
	byteOffset := 0
	for _, r := range src[:i] {
		if r >= 0x10000 {
			byteOffset += 4
		} else {
			byteOffset += 2
		}
	}
	s, _, ok := ix.span(int64(byteOffset), -1)
	if !ok || ix.line(s) != 3 {
		t.Errorf("line = %d (ok=%v), want 3", ix.line(s), ok)
	}
}

func TestBuildBatch(t *testing.T) {
	params := []Param{
		{Name: "@a", Type: "int", baseType: "int"},
		{Name: "@b", Type: "nvarchar(50)", baseType: "nvarchar", IsOutput: true},
		{Name: "@c", Type: "int", baseType: "int", HasDefault: true},
		{Name: "@d", Type: "bit", baseType: "bit"},
	}
	got, err := buildBatch("dbo", "p]x", params, []ParamInput{
		{Name: "@a", Value: "5"},
		{Name: "@b", Value: "O'Brien"},
		{Name: "@c", UseDefault: true},
		{Name: "@d", Value: "true"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"DECLARE @__p1 int = 5;",
		"DECLARE @__p2 nvarchar(50) = N'O''Brien';",
		"DECLARE @__p4 bit = 1;",
		"EXEC @__rc = [dbo].[p]]x] @a = @__p1, @b = @__p2 OUTPUT, @d = @__p4;",
		"SELECT @__rc AS [@RETURN_VALUE], @__p2 AS [@b];",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "@c") {
		t.Errorf("parameter with UseDefault must be omitted:\n%s", got)
	}

	if _, err := buildBatch("dbo", "p", params, []ParamInput{{Name: "@a", Value: "5; DROP TABLE x"}}); err == nil {
		t.Error("non-numeric value for an int parameter must be rejected")
	}
	nullBatch, _ := buildBatch("dbo", "p", params, []ParamInput{{Name: "@a", IsNull: true}, {Name: "@d", Value: "0"}})
	if !strings.Contains(nullBatch, "DECLARE @__p1 int = NULL;") {
		t.Errorf("NULL not honoured:\n%s", nullBatch)
	}
}

func TestParseEvents(t *testing.T) {
	doc := `<RingBufferTarget truncated="1" droppedCount="4">
<event name="sp_statement_completed" package="sqlserver" timestamp="2026-10-23T10:00:00.000Z">
  <data name="source_database_id"><value>7</value></data>
  <data name="object_id"><value>1234</value></data>
  <data name="nest_level"><value>2</value></data>
  <data name="line_number"><value>9</value></data>
  <data name="offset"><value>120</value></data>
  <data name="offset_end"><value>-1</value></data>
  <data name="duration"><value>1500</value></data>
  <data name="row_count"><value>3</value></data>
  <data name="object_name"><value>usp_x</value></data>
  <data name="statement"><value>UPDATE t SET a = 1</value></data>
</event>
<event name="error_reported" package="sqlserver" timestamp="2026-10-23T10:00:01.000Z">
  <data name="error_number"><value>547</value></data>
  <data name="severity"><value>16</value></data>
  <data name="message"><value>conflict</value></data>
</event>
<event name="something_else" package="sqlserver"></event>
</RingBufferTarget>`
	ev, info, err := parseEvents(doc)
	if err != nil {
		t.Fatal(err)
	}
	if !info.Truncated || info.Dropped != 4 {
		t.Errorf("info = %+v", info)
	}
	if len(ev) != 2 {
		t.Fatalf("events = %d, want 2", len(ev))
	}
	if e := ev[0]; e.Kind != "stmt" || e.ObjectID != 1234 || e.Level != 2 || e.Line != 9 || e.OffsetEnd != -1 || e.Rows != 3 || e.ObjectName != "usp_x" {
		t.Errorf("stmt: %+v", e)
	}
	if e := ev[1]; e.Kind != "error" || e.ErrNo != 547 || e.Text != "conflict" {
		t.Errorf("error: %+v", e)
	}
}

func TestExtractReturn(t *testing.T) {
	one, out := "0", "hola"
	res := &Result{Sets: []ResultSet{
		{Columns: []string{"x"}, Rows: [][]*string{{&one}}},
		{Columns: []string{"@RETURN_VALUE", "@b"}, Rows: [][]*string{{&one, &out}}},
	}}
	extractReturn(res)
	if len(res.Sets) != 1 || res.ReturnValue == nil || *res.ReturnValue != "0" || len(res.Outputs) != 1 || res.Outputs[0].Name != "@b" || *res.Outputs[0].Value != "hola" {
		t.Errorf("extractReturn: %+v", res)
	}
}
