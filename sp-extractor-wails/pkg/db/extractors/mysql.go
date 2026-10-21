package extractors

import (
	"database/sql"
	"fmt"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// MySQLExtractor implements the Extractor interface for MySQL / MariaDB.
type MySQLExtractor struct{}

func (e *MySQLExtractor) ExtractObjects(conn *sql.DB, objType db.DbObjectType, term string, limit int) ([]db.DbObject, error) {
	if objType != db.StoredProcedure {
		return nil, nil
	}
	query := `SELECT ROUTINE_SCHEMA AS SchemaName, ROUTINE_NAME AS ProcedureName
	          FROM information_schema.ROUTINES
	          WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_SCHEMA = DATABASE()`
	var args []any
	if term != "" {
		query += ` AND (ROUTINE_NAME LIKE ? ESCAPE '\\' OR ROUTINE_SCHEMA LIKE ? ESCAPE '\\')`
		pat := "%" + escapeLike(term) + "%"
		args = append(args, pat, pat)
	}
	query += " ORDER BY ProcedureName"
	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
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
func (e *MySQLExtractor) CountObjects(conn *sql.DB, objType db.DbObjectType, term string) (int, error) {
	if objType != db.StoredProcedure {
		return 0, nil
	}
	query := `SELECT COUNT(*)
	          FROM information_schema.ROUTINES
	          WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_SCHEMA = DATABASE()`
	var args []any
	if term != "" {
		query += ` AND (ROUTINE_NAME LIKE ? ESCAPE '\\' OR ROUTINE_SCHEMA LIKE ? ESCAPE '\\')`
		pat := "%" + escapeLike(term) + "%"
		args = append(args, pat, pat)
	}
	var count int
	if err := conn.QueryRow(query, args...).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

// ---- Schema model support ----

func (e *MySQLExtractor) SearchTables(conn *sql.DB, term string, limit int) ([]db.DbObject, error) {
	query := `SELECT TABLE_SCHEMA, TABLE_NAME
	          FROM information_schema.TABLES
	          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
	            AND TABLE_NAME LIKE ? ESCAPE '\\'
	          ORDER BY TABLE_NAME LIMIT ?`
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

func (e *MySQLExtractor) ListForeignKeys(conn *sql.DB) ([]db.ForeignKey, error) {
	query := `SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME,
	                 REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
	          FROM information_schema.KEY_COLUMN_USAGE
	          WHERE REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_SCHEMA = DATABASE()
	          ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION`
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

func (e *MySQLExtractor) TableColumns(conn *sql.DB, schema, table string) ([]db.TableColumn, error) {
	query := `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
	          FROM information_schema.COLUMNS
	          WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
	          ORDER BY ORDINAL_POSITION`
	rows, err := conn.Query(query, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []db.TableColumn
	for rows.Next() {
		var name, dataType, nullable, key string
		if err := rows.Scan(&name, &dataType, &nullable, &key); err != nil {
			return nil, fmt.Errorf("scan table column: %w", err)
		}
		cols = append(cols, db.TableColumn{
			Name:       name,
			DataType:   dataType,
			Nullable:   strings.EqualFold(nullable, "YES"),
			PrimaryKey: key == "PRI",
		})
	}
	return cols, rows.Err()
}

func (e *MySQLExtractor) FillDefinition(conn *sql.DB, obj *db.DbObject) error {
	if obj.Type != db.StoredProcedure {
		return nil
	}
	query := `SELECT ROUTINE_DEFINITION
	          FROM information_schema.ROUTINES
	          WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?`
	row := conn.QueryRow(query, obj.Schema, obj.Name)
	var def sql.NullString
	if err := row.Scan(&def); err != nil {
		obj.Definition = ""
		return nil
	}
	if def.Valid && def.String != "" {
		obj.Definition = fmt.Sprintf("CREATE PROCEDURE %s()\n%s", obj.Name, def.String)
	}
	return nil
}
