package extractors

import (
	"database/sql"

	"sp-extractor-wails/pkg/db"
)

// Extractor is the Strategy interface — one implementation per DB engine.
type Extractor interface {
	// ExtractObjects lists objects of a type. term (optional) filters by schema/name
	// substring, case-insensitive; limit > 0 caps the rows. Both are applied in SQL.
	ExtractObjects(conn *sql.DB, objType db.DbObjectType, term string, limit int) ([]db.DbObject, error)
	// CountObjects returns the total number of objects of a type, optionally filtered by term.
	CountObjects(conn *sql.DB, objType db.DbObjectType, term string) (int, error)
	FillDefinition(conn *sql.DB, obj *db.DbObject) error
	// SearchTables returns tables whose name matches term (substring, case-insensitive).
	SearchTables(conn *sql.DB, term string, limit int) ([]db.DbObject, error)
	// ListForeignKeys returns every single-column foreign key in the database.
	ListForeignKeys(conn *sql.DB) ([]db.ForeignKey, error)
	// TableColumns returns the columns of a table, flagging primary keys.
	TableColumns(conn *sql.DB, schema, table string) ([]db.TableColumn, error)
	// TableMeta returns the full structural metadata of a table (for script generation).
	TableMeta(conn *sql.DB, schema, table string) (db.TableMeta, error)
	// TableMetaWithFKs is TableMeta reusing the database-wide FK list (from ListForeignKeys),
	// which avoids reloading it for every table when many tables are read.
	TableMetaWithFKs(conn *sql.DB, schema, table string, allFKs []db.ForeignKey) (db.TableMeta, error)
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
