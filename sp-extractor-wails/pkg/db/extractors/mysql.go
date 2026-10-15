package extractors

import (
	"database/sql"
	"fmt"

	"sp-extractor-wails/pkg/db"
)

// MySQLExtractor implements the Extractor interface for MySQL / MariaDB.
type MySQLExtractor struct{}

func (e *MySQLExtractor) ExtractObjects(conn *sql.DB, objType db.DbObjectType) ([]db.DbObject, error) {
	if objType != db.StoredProcedure {
		return nil, nil
	}
	query := `SELECT ROUTINE_SCHEMA AS SchemaName, ROUTINE_NAME AS ProcedureName
	          FROM information_schema.ROUTINES
	          WHERE ROUTINE_TYPE = 'PROCEDURE' AND ROUTINE_SCHEMA = DATABASE()
	          ORDER BY ProcedureName`
	rows, err := conn.Query(query)
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
