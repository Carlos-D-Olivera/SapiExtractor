package extractors

import (
	"database/sql"

	"sp-extractor-wails/pkg/db"
)

// PostgresExtractor implements the Extractor interface for PostgreSQL.
type PostgresExtractor struct{}

func (e *PostgresExtractor) ExtractObjects(conn *sql.DB, objType db.DbObjectType) ([]db.DbObject, error) {
	if objType != db.StoredProcedure {
		return nil, nil
	}
	query := `SELECT n.nspname AS SchemaName, p.proname AS ProcedureName
	          FROM pg_proc p
	          INNER JOIN pg_namespace n ON n.oid = p.pronamespace
	          WHERE (p.prokind = 'p' OR p.prokind = 'f')
	            AND n.nspname NOT IN ('pg_catalog', 'information_schema')
	          ORDER BY SchemaName, ProcedureName`
	rows, err := conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []db.DbObject
	for rows.Next() {
		var schema, name string
		if err := rows.Scan(&schema, &name); err != nil {
			continue
		}
		list = append(list, db.DbObject{Type: db.StoredProcedure, Schema: schema, Name: name})
	}
	return list, rows.Err()
}

func (e *PostgresExtractor) FillDefinition(conn *sql.DB, obj *db.DbObject) error {
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
