package extractors

import (
	"database/sql"

	"sp-extractor-wails/pkg/db"
)

// Extractor is the Strategy interface — one implementation per DB engine.
type Extractor interface {
	ExtractObjects(conn *sql.DB, objType db.DbObjectType) ([]db.DbObject, error)
	FillDefinition(conn *sql.DB, obj *db.DbObject) error
	// SearchTables returns tables whose name matches term (substring, case-insensitive).
	SearchTables(conn *sql.DB, term string, limit int) ([]db.DbObject, error)
	// ListForeignKeys returns every single-column foreign key in the database.
	ListForeignKeys(conn *sql.DB) ([]db.ForeignKey, error)
	// TableColumns returns the columns of a table, flagging primary keys.
	TableColumns(conn *sql.DB, schema, table string) ([]db.TableColumn, error)
}

// New returns the correct Extractor implementation for the given DB type.
func New(t db.DatabaseType) Extractor {
	switch t {
	case db.SQLServer:
		return &SqlServerExtractor{}
	case db.MySQL:
		return &MySQLExtractor{}
	case db.PostgreSQL:
		return &PostgresExtractor{}
	}
	return &SqlServerExtractor{}
}
