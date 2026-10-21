package extractors

import (
	"database/sql"
	"fmt"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// PostgresExtractor implements the Extractor interface for PostgreSQL.
type PostgresExtractor struct{}

func (e *PostgresExtractor) ExtractObjects(conn *sql.DB, objType db.DbObjectType, term string, limit int) ([]db.DbObject, error) {
	if objType != db.StoredProcedure {
		return nil, nil
	}
	query := `SELECT n.nspname AS SchemaName, p.proname AS ProcedureName
	          FROM pg_proc p
	          INNER JOIN pg_namespace n ON n.oid = p.pronamespace
	          WHERE (p.prokind = 'p' OR p.prokind = 'f')
	            AND n.nspname NOT IN ('pg_catalog', 'information_schema')`
	var args []any
	if term != "" {
		query += ` AND (p.proname ILIKE $1 OR n.nspname ILIKE $1)`
		args = append(args, "%"+escapeLike(term)+"%")
	}
	query += " ORDER BY SchemaName, ProcedureName"
	if limit > 0 {
		args = append(args, limit)
		query += fmt.Sprintf(" LIMIT $%d", len(args))
	}
	rows, err := conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []db.DbObject
	for rows.Next() {
		var schema, name string
		if err := rows.Scan(&schema, &name); err != nil {
			return nil, fmt.Errorf("scan procedure row: %w", err)
		}
		list = append(list, db.DbObject{Type: db.StoredProcedure, Schema: schema, Name: name})
	}
	return list, rows.Err()
}

// CountObjects returns the total count of stored procedures, optionally filtered by term.
func (e *PostgresExtractor) CountObjects(conn *sql.DB, objType db.DbObjectType, term string) (int, error) {
	if objType != db.StoredProcedure {
		return 0, nil
	}
	query := `SELECT COUNT(*)
	          FROM pg_proc p
	          INNER JOIN pg_namespace n ON n.oid = p.pronamespace
	          WHERE (p.prokind = 'p' OR p.prokind = 'f')
	            AND n.nspname NOT IN ('pg_catalog', 'information_schema')`
	var args []any
	if term != "" {
		query += ` AND (p.proname ILIKE $1 OR n.nspname ILIKE $1)`
		args = append(args, "%"+escapeLike(term)+"%")
	}
	var count int
	if err := conn.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// ---- Schema model support ----

func (e *PostgresExtractor) SearchTables(conn *sql.DB, term string, limit int) ([]db.DbObject, error) {
	query := `SELECT n.nspname, c.relname
	          FROM pg_class c
	          INNER JOIN pg_namespace n ON n.oid = c.relnamespace
	          WHERE c.relkind IN ('r', 'p')
	            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
	            AND c.relname LIKE $1
	          ORDER BY c.relname LIMIT $2`
	rows, err := conn.Query(query, "%"+escapeLike(term)+"%", limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []db.DbObject
	for rows.Next() {
		var schema, name string
		if err := rows.Scan(&schema, &name); err != nil {
			return nil, fmt.Errorf("scan table search row: %w", err)
		}
		list = append(list, db.DbObject{Type: db.Table, Schema: schema, Name: name})
	}
	return list, rows.Err()
}

func (e *PostgresExtractor) ListForeignKeys(conn *sql.DB) ([]db.ForeignKey, error) {
	query := `SELECT con.conname,
	                 fn.nspname, fc.relname, fa.attname,
	                 tn.nspname, tc.relname, ta.attname
	          FROM pg_constraint con
	          INNER JOIN pg_class fc ON fc.oid = con.conrelid
	          INNER JOIN pg_namespace fn ON fn.oid = fc.relnamespace
	          INNER JOIN pg_class tc ON tc.oid = con.confrelid
	          INNER JOIN pg_namespace tn ON tn.oid = tc.relnamespace
	          INNER JOIN LATERAL unnest(con.conkey, con.confkey) WITH ORDINALITY AS k(fattnum, tattnum, ord) ON true
	          INNER JOIN pg_attribute fa ON fa.attrelid = con.conrelid AND fa.attnum = k.fattnum
	          INNER JOIN pg_attribute ta ON ta.attrelid = con.confrelid AND ta.attnum = k.tattnum
	          WHERE con.contype = 'f'
	          ORDER BY con.conname, k.ord`
	rows, err := conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []db.ForeignKey
	for rows.Next() {
		var fk db.ForeignKey
		if err := rows.Scan(&fk.Name, &fk.FromSchema, &fk.FromTable, &fk.FromColumn,
			&fk.ToSchema, &fk.ToTable, &fk.ToColumn); err != nil {
			return nil, fmt.Errorf("scan foreign key row: %w", err)
		}
		list = append(list, fk)
	}
	return list, rows.Err()
}

func (e *PostgresExtractor) TableColumns(conn *sql.DB, schema, table string) ([]db.TableColumn, error) {
	query := `SELECT c.column_name,
	                 COALESCE(format_type(a.atttypid, a.atttypmod), c.data_type),
	                 c.is_nullable,
	                 (pk.column_name IS NOT NULL) AS is_pk
	          FROM information_schema.columns c
	          INNER JOIN pg_class cl ON cl.relname = c.table_name AND cl.relkind IN ('r', 'p')
	          INNER JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = c.table_schema
	          INNER JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attname = c.column_name
	          LEFT JOIN (
	              SELECT kcu.column_name, kcu.table_schema, kcu.table_name
	              FROM information_schema.table_constraints tc
	              INNER JOIN information_schema.key_column_usage kcu
	                ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
	              WHERE tc.constraint_type = 'PRIMARY KEY'
	          ) pk ON pk.column_name = c.column_name AND pk.table_schema = c.table_schema AND pk.table_name = c.table_name
	          WHERE c.table_schema = $1 AND c.table_name = $2
	          ORDER BY c.ordinal_position`
	rows, err := conn.Query(query, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []db.TableColumn
	for rows.Next() {
		var name, dataType, nullable string
		var isPk bool
		if err := rows.Scan(&name, &dataType, &nullable, &isPk); err != nil {
			return nil, fmt.Errorf("scan table column: %w", err)
		}
		cols = append(cols, db.TableColumn{
			Name:       name,
			DataType:   dataType,
			Nullable:   strings.EqualFold(nullable, "YES"),
			PrimaryKey: isPk,
		})
	}
	return cols, rows.Err()
}

func (e *PostgresExtractor) FillDefinition(conn *sql.DB, obj *db.DbObject) error {
	if obj.Type != db.StoredProcedure {
		return nil
	}
	query := `SELECT pg_get_functiondef(p.oid) AS Definition
	          FROM pg_proc p
	          INNER JOIN pg_namespace n ON n.oid = p.pronamespace
	          WHERE n.nspname = $1 AND p.proname = $2`
	row := conn.QueryRow(query, obj.Schema, obj.Name)
	var def sql.NullString
	if err := row.Scan(&def); err != nil {
		obj.Definition = ""
		return nil
	}
	if def.Valid {
		obj.Definition = def.String
	}
	return nil
}
