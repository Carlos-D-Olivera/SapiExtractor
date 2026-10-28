package debug

import (
	"context"
	"database/sql"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"unicode"
)

// Limits of the data-change comparison.
const (
	// MaxSnapshotRows is the largest table (in rows) that will be compared.
	MaxSnapshotRows = 20000
	// MaxTrackedTables bounds how many written tables are compared in one run.
	MaxTrackedTables = 8
	// MaxChangesShown bounds the changed rows listed per table and per kind.
	MaxChangesShown = 200
	// maxCellChars truncates very long values in snapshots.
	maxCellChars = 2000
)

// ColChange is one column of an updated row.
type ColChange struct {
	Column string  `json:"column"`
	Before *string `json:"before"`
	After  *string `json:"after"`
}

// RowUpdate is a row that exists before and after with different values.
type RowUpdate struct {
	Key     string      `json:"key"` // primary-key values, e.g. "Id=15"
	Changes []ColChange `json:"changes"`
}

// DataChange describes what a run did to one table.
type DataChange struct {
	Table          string      `json:"table"` // schema.name
	Columns        []string    `json:"columns"`
	PrimaryKey     []string    `json:"primaryKey"`
	Inserted       [][]*string `json:"inserted"`
	Deleted        [][]*string `json:"deleted"`
	Updated        []RowUpdate `json:"updated"`
	InsertedCount  int         `json:"insertedCount"`
	DeletedCount   int         `json:"deletedCount"`
	UpdatedCount   int         `json:"updatedCount"`
	RowsBefore     int         `json:"rowsBefore"`
	RowsAfter      int         `json:"rowsAfter"`
	SkippedColumns []string    `json:"skippedColumns"`
	Skipped        string      `json:"skipped"` // reason the table could not be compared
}

// -------------------------------------------------- which tables were written

var (
	dmlFirst   = map[string]bool{"INSERT": true, "UPDATE": true, "DELETE": true, "MERGE": true, "TRUNCATE": true}
	fromJoinRe = regexp.MustCompile(`(?i)\b(?:FROM|JOIN|USING)\s+((?:\[[^\]]+\]|[A-Za-z_][\w$#@]*)(?:\s*\.\s*(?:\[[^\]]+\]|[A-Za-z_][\w$#@]*)){0,3})(?:\s+(?:AS\s+)?([A-Za-z_][\w$#@]*))?`)
	notAlias   = map[string]bool{
		"WHERE": true, "ON": true, "INNER": true, "LEFT": true, "RIGHT": true, "FULL": true, "CROSS": true, "OUTER": true,
		"JOIN": true, "SET": true, "OUTPUT": true, "GROUP": true, "ORDER": true, "HAVING": true, "UNION": true,
		"WITH": true, "OPTION": true, "VALUES": true, "USING": true, "WHEN": true, "FROM": true,
	}
)

func readWord(rs []rune, i int) string {
	j := i
	for j < len(rs) && isIdentRune(rs[j]) {
		j++
	}
	return string(rs[i:j])
}

// quoteParts renders name parts as [a].[b].
func quoteParts(parts []string) string {
	q := make([]string, len(parts))
	for i, p := range parts {
		q[i] = quoteIdent(p)
	}
	return strings.Join(q, ".")
}

// writtenTarget returns the table (as a quoted, possibly qualified name) that a
// DML statement writes to. ok is false for anything else, for temp tables and
// for table variables.
func writtenTarget(text string) (string, bool) {
	rs := []rune(stripLeadingComments(text))
	if len(rs) == 0 {
		return "", false
	}

	// Find the statement's DML keyword: the first word, or the first top-level
	// one after a WITH (CTE) prefix.
	first := strings.ToUpper(readWord(rs, 0))
	pos := -1
	switch {
	case dmlFirst[first]:
		pos = 0
	case first == "WITH":
		depth, inStr := 0, false
		for i := 0; i < len(rs); i++ {
			c := rs[i]
			switch {
			case inStr:
				if c == '\'' {
					inStr = false
				}
			case c == '\'':
				inStr = true
			case c == '(':
				depth++
			case c == ')':
				depth--
			case depth == 0 && isIdentRune(c) && (i == 0 || !isIdentRune(rs[i-1])):
				if w := readWord(rs, i); dmlFirst[strings.ToUpper(w)] {
					pos = i
				} else {
					i += len([]rune(w)) - 1
				}
			}
			if pos >= 0 {
				break
			}
		}
	}
	if pos < 0 {
		return "", false
	}
	kw := strings.ToUpper(readWord(rs, pos))
	i := skipTrivia(rs, pos+len(kw))

	// Skip TOP (n) [PERCENT] and the INTO / FROM / TABLE noise word.
	skippedNoise := false
	for i < len(rs) {
		switch {
		case wordAt(rs, i, "TOP"):
			i = skipTrivia(rs, i+3)
			if i < len(rs) && rs[i] == '(' {
				depth := 0
				for i < len(rs) {
					if rs[i] == '(' {
						depth++
					} else if rs[i] == ')' {
						depth--
						if depth == 0 {
							i++
							break
						}
					}
					i++
				}
			} else {
				for i < len(rs) && unicode.IsDigit(rs[i]) {
					i++
				}
			}
			i = skipTrivia(rs, i)
			if wordAt(rs, i, "PERCENT") {
				i = skipTrivia(rs, i+len("PERCENT"))
			}
			continue
		case !skippedNoise && (wordAt(rs, i, "INTO") || wordAt(rs, i, "FROM") || wordAt(rs, i, "TABLE")):
			i = skipTrivia(rs, i+len(readWord(rs, i)))
			skippedNoise = true
			continue
		}
		break
	}
	if i >= len(rs) || rs[i] == '#' || rs[i] == '@' {
		return "", false
	}

	parts, _, ok := readNameParts(string(rs[i:]))
	if !ok {
		return "", false
	}
	if strings.HasPrefix(parts[0], "#") || strings.HasPrefix(parts[0], "@") {
		return "", false
	}

	// UPDATE a SET … FROM t a / DELETE a FROM t a: the target is an alias.
	if len(parts) == 1 && (kw == "UPDATE" || kw == "DELETE") {
		for _, m := range fromJoinRe.FindAllStringSubmatch(string(rs), -1) {
			alias := m[2]
			if alias == "" || notAlias[strings.ToUpper(alias)] || !strings.EqualFold(alias, parts[0]) {
				continue
			}
			if refParts, _, ok := readNameParts(m[1]); ok && !strings.HasPrefix(refParts[0], "#") && !strings.HasPrefix(refParts[0], "@") {
				return quoteParts(refParts), true
			}
		}
	}
	return quoteParts(parts), true
}

// writtenTables lists the distinct tables written by the captured statements,
// in first-seen order.
func writtenTables(events []rawEvent) []string {
	seen := map[string]bool{}
	var out []string
	for _, e := range events {
		if e.Kind != "stmt" {
			continue
		}
		if t, ok := writtenTarget(e.Text); ok && !seen[strings.ToLower(t)] {
			seen[strings.ToLower(t)] = true
			out = append(out, t)
		}
	}
	return out
}

// ------------------------------------------------------------------ snapshots

type tableInfo struct {
	objectID int64
	schema   string
	name     string
	cols     []string
	exprs    []string // SELECT expressions, aligned with cols
	skipped  []string // columns that cannot be compared
	pk       []string
}

func (t tableInfo) full() string { return t.schema + "." + t.name }

// snapshotExpr returns an expression that renders column c of the given system
// type as text, or "" when the type cannot be compared.
func snapshotExpr(c, typ string) string {
	q := quoteIdent(c)
	cut := func(e string) string { return fmt.Sprintf("LEFT(%s, %d)", e, maxCellChars) }
	switch strings.ToLower(typ) {
	case "timestamp", "rowversion", "text", "ntext", "image", "geography", "geometry", "hierarchyid", "sql_variant":
		return ""
	case "binary", "varbinary":
		return cut(fmt.Sprintf("CONVERT(NVARCHAR(MAX), %s, 1)", q))
	case "datetime", "datetime2", "smalldatetime", "date", "time", "datetimeoffset":
		return fmt.Sprintf("CONVERT(NVARCHAR(40), %s, 121)", q)
	case "float", "real":
		return fmt.Sprintf("CONVERT(NVARCHAR(40), %s, 3)", q)
	case "money", "smallmoney":
		return fmt.Sprintf("CONVERT(NVARCHAR(40), %s, 2)", q)
	}
	return cut(fmt.Sprintf("CAST(%s AS NVARCHAR(MAX))", q))
}

// resolveTable finds the user table behind a quoted name. Unqualified names are
// tried in the procedure's schema, then dbo, then the connection default.
func resolveTable(ctx context.Context, conn *sql.Conn, raw string, schemaHints []string) (*tableInfo, error) {
	candidates := []string{raw}
	if !strings.Contains(raw, ".") {
		candidates = nil
		for _, h := range schemaHints {
			if h != "" {
				candidates = append(candidates, quoteIdent(h)+"."+raw)
			}
		}
		candidates = append(candidates, quoteIdent("dbo")+"."+raw, raw)
	}
	for _, cand := range candidates {
		var id sql.NullInt64
		var schema, name sql.NullString
		err := conn.QueryRowContext(ctx, `SELECT t.object_id, SCHEMA_NAME(t.schema_id), t.name
			FROM sys.tables t WHERE t.object_id = OBJECT_ID(@p1)`, cand).Scan(&id, &schema, &name)
		if err == sql.ErrNoRows || (err == nil && !id.Valid) {
			continue
		}
		if err != nil {
			return nil, err
		}
		ti := &tableInfo{objectID: id.Int64, schema: schema.String, name: name.String}
		return ti, loadTableColumns(ctx, conn, ti)
	}
	return nil, nil // a view, synonym or an object we cannot compare
}

func loadTableColumns(ctx context.Context, conn *sql.Conn, ti *tableInfo) error {
	rows, err := conn.QueryContext(ctx, `SELECT c.name, tp.name
		FROM sys.columns c
		INNER JOIN sys.types tp ON c.system_type_id = tp.user_type_id
		WHERE c.object_id = @p1 ORDER BY c.column_id`, ti.objectID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var name, typ string
		if err := rows.Scan(&name, &typ); err != nil {
			rows.Close()
			return err
		}
		if e := snapshotExpr(name, typ); e != "" {
			ti.cols = append(ti.cols, name)
			ti.exprs = append(ti.exprs, e)
		} else {
			ti.skipped = append(ti.skipped, name)
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	pk, err := conn.QueryContext(ctx, `SELECT c.name
		FROM sys.indexes i
		INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
		INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
		WHERE i.object_id = @p1 AND i.is_primary_key = 1 ORDER BY ic.key_ordinal`, ti.objectID)
	if err != nil {
		return err
	}
	defer pk.Close()
	for pk.Next() {
		var n string
		if err := pk.Scan(&n); err != nil {
			return err
		}
		ti.pk = append(ti.pk, n)
	}
	return pk.Err()
}

// snapshot reads up to MaxSnapshotRows+1 rows of the table as text.
func snapshot(ctx context.Context, conn *sql.Conn, ti *tableInfo) ([][]*string, error) {
	if len(ti.exprs) == 0 {
		return nil, fmt.Errorf("la tabla no tiene columnas comparables")
	}
	q := fmt.Sprintf("SELECT TOP (%d) %s FROM %s.%s", MaxSnapshotRows+1,
		strings.Join(ti.exprs, ", "), quoteIdent(ti.schema), quoteIdent(ti.name))
	rows, err := conn.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out [][]*string
	for rows.Next() {
		vals := make([]sql.NullString, len(ti.cols))
		ptrs := make([]any, len(vals))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return nil, err
		}
		row := make([]*string, len(vals))
		for i, v := range vals {
			if v.Valid {
				s := v.String
				row[i] = &s
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// ------------------------------------------------------------------------ diff

func cellKey(p *string) string {
	if p == nil {
		return "\x00NULL"
	}
	return "v:" + *p
}

func rowKey(row []*string, idx []int) string {
	var b strings.Builder
	for _, i := range idx {
		b.WriteString(cellKey(row[i]))
		b.WriteByte(0x1f)
	}
	return b.String()
}

func colIndexes(cols, names []string) []int {
	var idx []int
	for _, n := range names {
		for i, c := range cols {
			if strings.EqualFold(c, n) {
				idx = append(idx, i)
			}
		}
	}
	return idx
}

func display(p *string) string {
	if p == nil {
		return "NULL"
	}
	return *p
}

// diffSnapshots compares the table before and after. With a primary key rows
// are matched by key (so updates are detected); without one a row that changed
// appears as a deletion plus an insertion.
func diffSnapshots(cols, pk []string, before, after [][]*string) DataChange {
	dc := DataChange{Columns: cols, PrimaryKey: pk, RowsBefore: len(before), RowsAfter: len(after),
		Inserted: [][]*string{}, Deleted: [][]*string{}, Updated: []RowUpdate{}}

	pkIdx := colIndexes(cols, pk)
	all := make([]int, len(cols))
	for i := range all {
		all[i] = i
	}
	hasPK := len(pkIdx) == len(pk) && len(pk) > 0
	keyIdx := all
	if hasPK {
		keyIdx = pkIdx
	}

	index := func(rows [][]*string) map[string][]int {
		m := make(map[string][]int, len(rows))
		for i, r := range rows {
			k := rowKey(r, keyIdx)
			m[k] = append(m[k], i)
		}
		return m
	}
	bi, ai := index(before), index(after)

	keys := make([]string, 0, len(bi)+len(ai))
	seen := map[string]bool{}
	for _, rows := range []map[string][]int{bi, ai} {
		for k := range rows {
			if !seen[k] {
				seen[k] = true
				keys = append(keys, k)
			}
		}
	}
	sort.Strings(keys)

	for _, k := range keys {
		b, a := bi[k], ai[k]
		n := len(b)
		if len(a) < n {
			n = len(a)
		}
		if hasPK {
			// Primary keys are unique, so there is at most one row on each side.
			if len(b) == 1 && len(a) == 1 {
				if changes := columnChanges(cols, before[b[0]], after[a[0]]); len(changes) > 0 {
					dc.UpdatedCount++
					if len(dc.Updated) < MaxChangesShown {
						dc.Updated = append(dc.Updated, RowUpdate{Key: keyLabel(cols, pkIdx, after[a[0]]), Changes: changes})
					}
				}
				continue
			}
		}
		// Rows present in only one side (or extra duplicates when there is no key).
		for _, i := range b[n:] {
			dc.DeletedCount++
			if len(dc.Deleted) < MaxChangesShown {
				dc.Deleted = append(dc.Deleted, before[i])
			}
		}
		for _, i := range a[n:] {
			dc.InsertedCount++
			if len(dc.Inserted) < MaxChangesShown {
				dc.Inserted = append(dc.Inserted, after[i])
			}
		}
	}
	return dc
}

func columnChanges(cols []string, before, after []*string) []ColChange {
	var out []ColChange
	for i, c := range cols {
		if cellKey(before[i]) != cellKey(after[i]) {
			out = append(out, ColChange{Column: c, Before: before[i], After: after[i]})
		}
	}
	return out
}

func keyLabel(cols []string, idx []int, row []*string) string {
	parts := make([]string, len(idx))
	for n, i := range idx {
		parts[n] = fmt.Sprintf("%s=%s", cols[i], display(row[i]))
	}
	return strings.Join(parts, ", ")
}

// ----------------------------------------------------------------- orchestration

// trackChanges compares the written tables around the procedure's effects. It
// must be called while the transaction that ran the procedure is still open on
// conn: the "after" state is read first, then rollback is invoked, then the
// "before" state is read.
func trackChanges(ctx context.Context, conn *sql.Conn, rollback func(), procSchema string, events []rawEvent) ([]DataChange, []string) {
	var notes []string

	var open int
	if err := conn.QueryRowContext(ctx, "SELECT @@TRANCOUNT").Scan(&open); err != nil || open == 0 {
		notes = append(notes, "No se compararon los datos: la transacción ya no estaba activa (el procedimiento hizo su propio ROLLBACK o la ejecución la cerró).")
		rollback()
		return nil, notes
	}

	var tables []*tableInfo
	var out []DataChange
	for _, raw := range writtenTables(events) {
		if len(tables) >= MaxTrackedTables {
			notes = append(notes, fmt.Sprintf("Solo se comparan las primeras %d tablas escritas.", MaxTrackedTables))
			break
		}
		ti, err := resolveTable(ctx, conn, raw, []string{procSchema})
		if err != nil {
			notes = append(notes, fmt.Sprintf("No se pudo leer la estructura de %s: %v", raw, err))
			continue
		}
		if ti == nil {
			notes = append(notes, fmt.Sprintf("%s no es una tabla de usuario (¿vista o sinónimo?): no se compara.", raw))
			continue
		}
		tables = append(tables, ti)
	}

	post := make([][][]*string, len(tables))
	skip := make([]string, len(tables))
	for i, ti := range tables {
		rows, err := snapshot(ctx, conn, ti)
		switch {
		case err != nil:
			skip[i] = err.Error()
		case len(rows) > MaxSnapshotRows:
			skip[i] = fmt.Sprintf("La tabla tiene más de %d filas: no se compara.", MaxSnapshotRows)
		default:
			post[i] = rows
		}
	}

	rollback() // everything the procedure did is undone here

	for i, ti := range tables {
		if skip[i] != "" {
			out = append(out, DataChange{Table: ti.full(), Skipped: skip[i], SkippedColumns: ti.skipped, Columns: ti.cols, PrimaryKey: ti.pk})
			continue
		}
		pre, err := snapshot(ctx, conn, ti)
		if err != nil {
			out = append(out, DataChange{Table: ti.full(), Skipped: err.Error(), SkippedColumns: ti.skipped})
			continue
		}
		dc := diffSnapshots(ti.cols, ti.pk, pre, post[i])
		dc.Table, dc.SkippedColumns = ti.full(), ti.skipped
		if len(ti.pk) == 0 {
			notes = append(notes, fmt.Sprintf("%s no tiene llave primaria: una fila modificada se muestra como eliminada e insertada.", ti.full()))
		}
		out = append(out, dc)
	}
	return out, notes
}
