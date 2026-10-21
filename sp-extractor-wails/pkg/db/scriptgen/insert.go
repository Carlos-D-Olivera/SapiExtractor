package scriptgen

import (
	"fmt"
	"regexp"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// InsertData is the tabular payload of a query result: the destination table,
// the result columns (with their database type names, when available) and the
// rows. A nil cell means SQL NULL.
type InsertData struct {
	Schema  string
	Table   string
	Columns []string
	Types   []string
	Rows    [][]*string
}

// InsertOptions controls how the INSERT script is rendered.
type InsertOptions struct {
	// DetectTypes emits numeric/boolean values unquoted based on Types.
	// When false every non-NULL value is written as a quoted string, which
	// databases coerce implicitly.
	DetectTypes    bool
	BatchSize      int  // rows per INSERT statement (0 or 1 = one row each)
	IdentityInsert bool // SQL Server: wrap in SET IDENTITY_INSERT ON/OFF
	DeleteFirst    bool // emit DELETE FROM <table> before the inserts
}

// Batch sizes above this are capped; multi-row VALUES lists get unwieldy
// (and SQL Server rejects more than 1000 rows in one VALUES clause).
const maxInsertBatch = 1000

// GenerateInsert renders a self-contained INSERT script for the given result.
func GenerateInsert(t db.DatabaseType, d InsertData, o InsertOptions) (string, error) {
	if strings.TrimSpace(d.Table) == "" {
		return "", fmt.Errorf("indica la tabla destino")
	}
	if len(d.Columns) == 0 {
		return "", fmt.Errorf("no hay columnas para generar el script")
	}
	if len(d.Rows) == 0 {
		return "", fmt.Errorf("no hay filas para generar el script")
	}
	for i, row := range d.Rows {
		if len(row) != len(d.Columns) {
			return "", fmt.Errorf("la fila %d tiene %d valores y se esperaban %d", i+1, len(row), len(d.Columns))
		}
	}

	batch := o.BatchSize
	if batch < 1 {
		batch = 1
	}
	if batch > maxInsertBatch {
		batch = maxInsertBatch
	}

	table := QualifiedName(t, d.Schema, d.Table)
	cols := make([]string, len(d.Columns))
	for i, c := range d.Columns {
		cols[i] = QuoteIdent(t, c)
	}
	colList := strings.Join(cols, ", ")

	var b strings.Builder
	fmt.Fprintf(&b, "-- %d fila(s) para %s\n", len(d.Rows), table)
	if o.DeleteFirst {
		fmt.Fprintf(&b, "DELETE FROM %s;\n", table)
	}
	identity := o.IdentityInsert && t == db.SQLServer
	if identity {
		fmt.Fprintf(&b, "SET IDENTITY_INSERT %s ON;\n", table)
	}
	if o.DeleteFirst || identity {
		b.WriteString("\n")
	}

	for start := 0; start < len(d.Rows); start += batch {
		end := start + batch
		if end > len(d.Rows) {
			end = len(d.Rows)
		}
		fmt.Fprintf(&b, "INSERT INTO %s (%s)\nVALUES\n", table, colList)
		for i := start; i < end; i++ {
			b.WriteString("    (")
			for j, v := range d.Rows[i] {
				if j > 0 {
					b.WriteString(", ")
				}
				b.WriteString(valueLiteral(t, v, typeAt(d.Types, j), o.DetectTypes))
			}
			b.WriteString(")")
			if i < end-1 {
				b.WriteString(",\n")
			} else {
				b.WriteString(";\n\n")
			}
		}
	}

	if identity {
		fmt.Fprintf(&b, "SET IDENTITY_INSERT %s OFF;\n", table)
	}
	return strings.TrimRight(b.String(), "\n") + "\n", nil
}

func typeAt(types []string, i int) string {
	if i < len(types) {
		return types[i]
	}
	return ""
}

var numericLiteral = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$`)

func valueLiteral(t db.DatabaseType, v *string, typ string, detect bool) string {
	if v == nil {
		return "NULL"
	}
	if detect {
		switch {
		case isBoolType(t, typ):
			return boolLiteral(t, *v)
		case isNumericType(typ) && numericLiteral.MatchString(strings.TrimSpace(*v)):
			return strings.TrimSpace(*v)
		}
	}
	return textLiteral(t, *v)
}

func isNumericType(typ string) bool {
	switch baseType(typ) {
	case "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT",
		"INT2", "INT4", "INT8", "SERIAL", "BIGSERIAL", "SMALLSERIAL",
		"DECIMAL", "NUMERIC", "NUMBER", "MONEY", "SMALLMONEY",
		"FLOAT", "FLOAT4", "FLOAT8", "REAL", "DOUBLE", "YEAR":
		return true
	}
	return false
}

func isBoolType(t db.DatabaseType, typ string) bool {
	switch baseType(typ) {
	case "BOOL", "BOOLEAN":
		return true
	case "BIT":
		// SQL Server reports BIT; MySQL BIT is a binary field, not a boolean.
		return t == db.SQLServer
	}
	return false
}

// baseType uppercases a type name and strips its length/precision suffix:
// "decimal(10,2)" -> "DECIMAL", "character varying" -> "CHARACTER VARYING".
func baseType(typ string) string {
	s := strings.ToUpper(strings.TrimSpace(typ))
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = strings.TrimSpace(s[:i])
	}
	return s
}

func boolLiteral(t db.DatabaseType, v string) string {
	truthy := false
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "1", "t", "true", "y", "yes", "on":
		truthy = true
	}
	if t == db.PostgreSQL {
		if truthy {
			return "TRUE"
		}
		return "FALSE"
	}
	if truthy {
		return "1"
	}
	return "0"
}

func textLiteral(t db.DatabaseType, v string) string {
	switch t {
	case db.SQLServer:
		// N prefix keeps non-ASCII characters intact in NVARCHAR/NCHAR targets.
		return "N'" + strings.ReplaceAll(v, "'", "''") + "'"
	case db.MySQL:
		// MySQL treats backslash as an escape character inside literals.
		v = strings.ReplaceAll(v, `\`, `\\`)
		v = strings.ReplaceAll(v, "'", "''")
		return "'" + v + "'"
	default:
		return "'" + strings.ReplaceAll(v, "'", "''") + "'"
	}
}
