package extractors

import (
	"database/sql"
	"fmt"
	"regexp"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// FormatSQLType renders a SQL Server type name with its length/precision, e.g. nvarchar(50).
func FormatSQLType(typeName string, maxLen, prec, scale int) string {
	return formatSQLType(typeName, maxLen, prec, scale)
}

// outgoingFKs filters the database-wide FK list down to the ones declared on the table.
func outgoingFKs(all []db.ForeignKey, schema, table string) []db.ForeignKey {
	var out []db.ForeignKey
	for _, fk := range all {
		if strings.EqualFold(fk.FromSchema, schema) && strings.EqualFold(fk.FromTable, table) {
			out = append(out, fk)
		}
	}
	return out
}

// ---------------------------------------------------------------- SQL Server

func (e *SqlServerExtractor) TableMeta(conn *sql.DB, schema, table string) (db.TableMeta, error) {
	return e.tableMeta(conn, schema, table, nil)
}

// TableMetaWithFKs is TableMeta reusing an already loaded database-wide FK list.
func (e *SqlServerExtractor) TableMetaWithFKs(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error) {
	return e.tableMeta(conn, schema, table, allFKs)
}

func (e *SqlServerExtractor) tableMeta(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error) {
	meta := db.TableMeta{Schema: schema, Name: table}

	colQuery := `SELECT c.name, tp.name, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity,
	                    CAST(ISNULL(ic.seed_value, 1) AS bigint), CAST(ISNULL(ic.increment_value, 1) AS bigint),
	                    ISNULL(dc.definition, '')
	             FROM sys.columns c
	             INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
	             INNER JOIN sys.tables t ON c.object_id = t.object_id
	             LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id
	             LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
	             WHERE SCHEMA_NAME(t.schema_id) = @p1 AND t.name = @p2
	             ORDER BY c.column_id`
	rows, err := conn.Query(colQuery, schema, table)
	if err != nil {
		return meta, err
	}
	for rows.Next() {
		var c db.MetaColumn
		var typeName string
		var maxLen, prec, scale int
		if err := rows.Scan(&c.Name, &typeName, &maxLen, &prec, &scale, &c.Nullable, &c.Identity,
			&c.IdentitySeed, &c.IdentityStep, &c.Default); err != nil {
			rows.Close()
			return meta, fmt.Errorf("scan table column: %w", err)
		}
		c.DataType = formatSQLType(typeName, maxLen, prec, scale)
		meta.Columns = append(meta.Columns, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return meta, err
	}

	idxQuery := `SELECT i.name, i.is_unique, i.is_primary_key, c.name, ic.is_included_column
	             FROM sys.indexes i
	             INNER JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
	             INNER JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
	             INNER JOIN sys.tables t ON t.object_id = i.object_id
	             WHERE SCHEMA_NAME(t.schema_id) = @p1 AND t.name = @p2 AND i.type > 0 AND i.is_hypothetical = 0
	             ORDER BY i.index_id, ic.is_included_column, ic.key_ordinal, ic.index_column_id`
	irows, err := conn.Query(idxQuery, schema, table)
	if err != nil {
		return meta, err
	}
	defer irows.Close()
	pos := map[string]int{}
	for irows.Next() {
		var name, col string
		var unique, primary, included bool
		if err := irows.Scan(&name, &unique, &primary, &col, &included); err != nil {
			return meta, fmt.Errorf("scan index row: %w", err)
		}
		if primary {
			meta.PrimaryName = name
			if !included {
				meta.PrimaryKey = append(meta.PrimaryKey, col)
			}
			continue
		}
		i, ok := pos[name]
		if !ok {
			meta.Indexes = append(meta.Indexes, db.MetaIndex{Name: name, Unique: unique})
			i = len(meta.Indexes) - 1
			pos[name] = i
		}
		if included {
			meta.Indexes[i].Included = append(meta.Indexes[i].Included, col)
		} else {
			meta.Indexes[i].Columns = append(meta.Indexes[i].Columns, col)
		}
	}
	if err := irows.Err(); err != nil {
		return meta, err
	}

	fks := allFKs
	if fks == nil {
		var err error
		if fks, err = e.ListForeignKeys(conn); err != nil {
			return meta, err
		}
	}
	meta.ForeignKeys = outgoingFKs(fks, schema, table)
	return meta, nil
}

// ---------------------------------------------------------------- PostgreSQL

func (e *PostgresExtractor) TableMeta(conn *sql.DB, schema, table string) (db.TableMeta, error) {
	return e.tableMeta(conn, schema, table, nil)
}

// TableMetaWithFKs is TableMeta reusing an already loaded database-wide FK list.
func (e *PostgresExtractor) TableMetaWithFKs(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error) {
	return e.tableMeta(conn, schema, table, allFKs)
}

func (e *PostgresExtractor) tableMeta(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error) {
	meta := db.TableMeta{Schema: schema, Name: table}

	colQuery := `SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
	                    a.attidentity IN ('a', 'd'),
	                    COALESCE(pg_get_expr(d.adbin, d.adrelid), '')
	             FROM pg_attribute a
	             INNER JOIN pg_class cl ON cl.oid = a.attrelid
	             INNER JOIN pg_namespace n ON n.oid = cl.relnamespace
	             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
	             WHERE n.nspname = $1 AND cl.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
	             ORDER BY a.attnum`
	rows, err := conn.Query(colQuery, schema, table)
	if err != nil {
		return meta, err
	}
	for rows.Next() {
		var c db.MetaColumn
		if err := rows.Scan(&c.Name, &c.DataType, &c.Nullable, &c.Identity, &c.Default); err != nil {
			rows.Close()
			return meta, fmt.Errorf("scan table column: %w", err)
		}
		meta.Columns = append(meta.Columns, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return meta, err
	}

	pkQuery := `SELECT con.conname, a.attname
	            FROM pg_constraint con
	            INNER JOIN pg_class cl ON cl.oid = con.conrelid
	            INNER JOIN pg_namespace n ON n.oid = cl.relnamespace
	            INNER JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
	            INNER JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.attnum
	            WHERE con.contype = 'p' AND n.nspname = $1 AND cl.relname = $2
	            ORDER BY k.ord`
	prows, err := conn.Query(pkQuery, schema, table)
	if err != nil {
		return meta, err
	}
	for prows.Next() {
		var name, col string
		if err := prows.Scan(&name, &col); err != nil {
			prows.Close()
			return meta, fmt.Errorf("scan primary key: %w", err)
		}
		meta.PrimaryName = name
		meta.PrimaryKey = append(meta.PrimaryKey, col)
	}
	prows.Close()
	if err := prows.Err(); err != nil {
		return meta, err
	}

	idxQuery := `SELECT ci.relname, pg_get_indexdef(i.indexrelid)
	             FROM pg_index i
	             INNER JOIN pg_class cl ON cl.oid = i.indrelid
	             INNER JOIN pg_class ci ON ci.oid = i.indexrelid
	             INNER JOIN pg_namespace n ON n.oid = cl.relnamespace
	             WHERE n.nspname = $1 AND cl.relname = $2 AND NOT i.indisprimary
	             ORDER BY ci.relname`
	irows, err := conn.Query(idxQuery, schema, table)
	if err != nil {
		return meta, err
	}
	defer irows.Close()
	for irows.Next() {
		var ix db.MetaIndex
		if err := irows.Scan(&ix.Name, &ix.Definition); err != nil {
			return meta, fmt.Errorf("scan index row: %w", err)
		}
		meta.Indexes = append(meta.Indexes, ix)
	}
	if err := irows.Err(); err != nil {
		return meta, err
	}

	fks := allFKs
	if fks == nil {
		var err error
		if fks, err = e.ListForeignKeys(conn); err != nil {
			return meta, err
		}
	}
	meta.ForeignKeys = outgoingFKs(fks, schema, table)
	return meta, nil
}

// --------------------------------------------------------------------- MySQL

var (
	mysqlNumeric  = regexp.MustCompile(`^-?\d+(\.\d+)?$`)
	mysqlOnUpdate = regexp.MustCompile(`(?i)on update (\S+(?:\(\d*\))?)`)
)

// mysqlDefault turns information_schema's COLUMN_DEFAULT into an expression
// that can be emitted after DEFAULT.
func mysqlDefault(def sql.NullString, extra string) string {
	out := ""
	if def.Valid {
		d := def.String
		upper := strings.ToUpper(d)
		switch {
		case upper == "NULL":
			// implicit default, nothing to emit
		case strings.HasPrefix(upper, "CURRENT_TIMESTAMP"), mysqlNumeric.MatchString(d), strings.HasPrefix(d, "'"):
			out = d
		case strings.Contains(strings.ToUpper(extra), "DEFAULT_GENERATED"):
			out = "(" + d + ")"
		default:
			out = "'" + strings.ReplaceAll(d, "'", "''") + "'"
		}
	}
	if m := mysqlOnUpdate.FindStringSubmatch(extra); m != nil {
		if out == "" {
			out = "NULL"
		}
		out += " ON UPDATE " + m[1]
	}
	return out
}

func (e *MySQLExtractor) TableMeta(conn *sql.DB, schema, table string) (db.TableMeta, error) {
	return e.tableMeta(conn, schema, table, nil)
}

// TableMetaWithFKs is TableMeta reusing an already loaded database-wide FK list.
func (e *MySQLExtractor) TableMetaWithFKs(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error) {
	return e.tableMeta(conn, schema, table, allFKs)
}

func (e *MySQLExtractor) tableMeta(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error) {
	meta := db.TableMeta{Schema: schema, Name: table}

	colQuery := `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
	             FROM information_schema.COLUMNS
	             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
	             ORDER BY ORDINAL_POSITION`
	rows, err := conn.Query(colQuery, schema, table)
	if err != nil {
		return meta, err
	}
	for rows.Next() {
		var c db.MetaColumn
		var nullable, extra string
		var def sql.NullString
		if err := rows.Scan(&c.Name, &c.DataType, &nullable, &def, &extra); err != nil {
			rows.Close()
			return meta, fmt.Errorf("scan table column: %w", err)
		}
		c.Nullable = strings.EqualFold(nullable, "YES")
		c.Identity = strings.Contains(strings.ToLower(extra), "auto_increment")
		c.Default = mysqlDefault(def, extra)
		meta.Columns = append(meta.Columns, c)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return meta, err
	}

	idxQuery := `SELECT INDEX_NAME, NON_UNIQUE, COLUMN_NAME, INDEX_TYPE
	             FROM information_schema.STATISTICS
	             WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
	             ORDER BY INDEX_NAME, SEQ_IN_INDEX`
	irows, err := conn.Query(idxQuery, schema, table)
	if err != nil {
		return meta, err
	}
	defer irows.Close()
	pos := map[string]int{}
	skip := map[string]bool{} // functional / fulltext / spatial indexes can't be rebuilt from columns alone
	for irows.Next() {
		var name, idxType string
		var nonUnique int
		var col sql.NullString
		if err := irows.Scan(&name, &nonUnique, &col, &idxType); err != nil {
			return meta, fmt.Errorf("scan index row: %w", err)
		}
		if name == "PRIMARY" {
			meta.PrimaryKey = append(meta.PrimaryKey, col.String)
			continue
		}
		if !col.Valid || idxType == "FULLTEXT" || idxType == "SPATIAL" {
			skip[name] = true
			continue
		}
		i, ok := pos[name]
		if !ok {
			meta.Indexes = append(meta.Indexes, db.MetaIndex{Name: name, Unique: nonUnique == 0})
			i = len(meta.Indexes) - 1
			pos[name] = i
		}
		meta.Indexes[i].Columns = append(meta.Indexes[i].Columns, col.String)
	}
	if err := irows.Err(); err != nil {
		return meta, err
	}
	if len(skip) > 0 {
		kept := meta.Indexes[:0]
		for _, ix := range meta.Indexes {
			if !skip[ix.Name] {
				kept = append(kept, ix)
			}
		}
		meta.Indexes = kept
	}

	fks := allFKs
	if fks == nil {
		var err error
		if fks, err = e.ListForeignKeys(conn); err != nil {
			return meta, err
		}
	}
	meta.ForeignKeys = outgoingFKs(fks, schema, table)
	return meta, nil
}
