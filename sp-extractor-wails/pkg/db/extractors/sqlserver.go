package extractors

import (
	"database/sql"
	"fmt"
	"strings"

	"sp-extractor-wails/pkg/db"
)

// SqlServerExtractor implements the Extractor interface for Microsoft SQL Server.
type SqlServerExtractor struct{}

func (e *SqlServerExtractor) ExtractObjects(conn *sql.DB, objType db.DbObjectType) ([]db.DbObject, error) {
	switch objType {
	case db.StoredProcedure:
		return e.extractSPs(conn)
	case db.Table:
		return e.extractTables(conn)
	case db.Column:
		return e.extractColumns(conn)
	case db.Function:
		return e.extractFunctions(conn)
	case db.Trigger:
		return e.extractTriggers(conn)
	case db.View:
		return e.extractViews(conn)
	}
	return nil, nil
}

func (e *SqlServerExtractor) extractSPs(conn *sql.DB) ([]db.DbObject, error) {
	query := `SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ProcedureName
	          FROM sys.procedures ORDER BY SchemaName, ProcedureName`
	return e.queryObjects(conn, query, db.StoredProcedure)
}

func (e *SqlServerExtractor) extractTables(conn *sql.DB) ([]db.DbObject, error) {
	query := `SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ObjectName
	          FROM sys.tables ORDER BY SchemaName, ObjectName`
	return e.queryObjects(conn, query, db.Table)
}

func (e *SqlServerExtractor) extractViews(conn *sql.DB) ([]db.DbObject, error) {
	query := `SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ObjectName
	          FROM sys.views ORDER BY SchemaName, ObjectName`
	return e.queryObjects(conn, query, db.View)
}

func (e *SqlServerExtractor) extractFunctions(conn *sql.DB) ([]db.DbObject, error) {
	query := `SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ObjectName
	          FROM sys.objects WHERE type IN ('FN','IF','TF','FS','FT')
	          ORDER BY SchemaName, ObjectName`
	return e.queryObjects(conn, query, db.Function)
}

func (e *SqlServerExtractor) extractTriggers(conn *sql.DB) ([]db.DbObject, error) {
	query := `SELECT SCHEMA_NAME(o.schema_id) AS SchemaName, t.name AS ObjectName, o.name AS ParentName
	          FROM sys.triggers t
	          INNER JOIN sys.objects o ON t.parent_id = o.object_id
	          ORDER BY SchemaName, ObjectName`
	rows, err := conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []db.DbObject
	for rows.Next() {
		var schema, name, parent string
		if err := rows.Scan(&schema, &name, &parent); err != nil {
			return nil, fmt.Errorf("scan trigger row: %w", err)
		}
		list = append(list, db.DbObject{Type: db.Trigger, Schema: schema, ParentName: parent, Name: name})
	}
	return list, rows.Err()
}

func (e *SqlServerExtractor) extractColumns(conn *sql.DB) ([]db.DbObject, error) {
	query := `SELECT SCHEMA_NAME(t.schema_id) AS SchemaName, t.name AS TableName, c.name AS ColumnName
	          FROM sys.columns c
	          INNER JOIN sys.tables t ON c.object_id = t.object_id
	          ORDER BY SchemaName, TableName, c.name`
	rows, err := conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []db.DbObject
	for rows.Next() {
		var schema, table, col string
		if err := rows.Scan(&schema, &table, &col); err != nil {
			return nil, fmt.Errorf("scan column row: %w", err)
		}
		list = append(list, db.DbObject{Type: db.Column, Schema: schema, ParentName: table, Name: col})
	}
	return list, rows.Err()
}

// ---- Schema model support ----

func (e *SqlServerExtractor) SearchTables(conn *sql.DB, term string, limit int) ([]db.DbObject, error) {
	query := `SELECT TOP (@p2) SCHEMA_NAME(schema_id) AS SchemaName, name AS TableName
	          FROM sys.tables
	          WHERE name LIKE @p1 ESCAPE '\'
	          ORDER BY name`
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

func (e *SqlServerExtractor) ListForeignKeys(conn *sql.DB) ([]db.ForeignKey, error) {
	query := `SELECT fk.name,
	                 SCHEMA_NAME(pt.schema_id), pt.name, pc.name,
	                 SCHEMA_NAME(rt.schema_id), rt.name, rc.name
	          FROM sys.foreign_key_columns fkc
	          INNER JOIN sys.foreign_keys fk ON fk.object_id = fkc.constraint_object_id
	          INNER JOIN sys.tables pt ON pt.object_id = fkc.parent_object_id
	          INNER JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
	          INNER JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id
	          INNER JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
	          ORDER BY fk.name`
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

func (e *SqlServerExtractor) TableColumns(conn *sql.DB, schema, table string) ([]db.TableColumn, error) {
	query := `SELECT c.name, tp.name AS TypeName, c.max_length, c.precision, c.scale, c.is_nullable,
	                 CASE WHEN pk.column_id IS NOT NULL THEN 1 ELSE 0 END AS IsPk
	          FROM sys.columns c
	          INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
	          INNER JOIN sys.tables t ON c.object_id = t.object_id
	          LEFT JOIN (
	              SELECT ic.object_id, ic.column_id
	              FROM sys.index_columns ic
	              INNER JOIN sys.indexes i ON i.object_id = ic.object_id AND i.index_id = ic.index_id
	              WHERE i.is_primary_key = 1
	          ) pk ON pk.object_id = c.object_id AND pk.column_id = c.column_id
	          WHERE SCHEMA_NAME(t.schema_id) = @p1 AND t.name = @p2
	          ORDER BY c.column_id`
	rows, err := conn.Query(query, schema, table)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var cols []db.TableColumn
	for rows.Next() {
		var name, typeName string
		var maxLen, prec, scale int
		var nullable, isPk bool
		if err := rows.Scan(&name, &typeName, &maxLen, &prec, &scale, &nullable, &isPk); err != nil {
			return nil, fmt.Errorf("scan table column: %w", err)
		}
		cols = append(cols, db.TableColumn{
			Name:       name,
			DataType:   formatSQLType(typeName, maxLen, prec, scale),
			Nullable:   nullable,
			PrimaryKey: isPk,
		})
	}
	return cols, rows.Err()
}

func (e *SqlServerExtractor) queryObjects(conn *sql.DB, query string, objType db.DbObjectType) ([]db.DbObject, error) {
	rows, err := conn.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var list []db.DbObject
	for rows.Next() {
		var schema, name string
		if err := rows.Scan(&schema, &name); err != nil {
			return nil, fmt.Errorf("scan object row: %w", err)
		}
		list = append(list, db.DbObject{Type: objType, Schema: schema, Name: name})
	}
	return list, rows.Err()
}

func (e *SqlServerExtractor) FillDefinition(conn *sql.DB, obj *db.DbObject) error {
	switch obj.Type {
	case db.StoredProcedure, db.Function, db.View, db.Trigger:
		return e.fillRoutineOrView(conn, obj)
	case db.Column:
		return e.fillColumn(conn, obj)
	case db.Table:
		return e.fillTable(conn, obj)
	}
	return nil
}

func (e *SqlServerExtractor) fillRoutineOrView(conn *sql.DB, obj *db.DbObject) error {
	query := `SELECT m.definition
	          FROM sys.objects o
	          INNER JOIN sys.sql_modules m ON o.object_id = m.object_id
	          WHERE SCHEMA_NAME(o.schema_id) = @p1 AND o.name = @p2`
	row := conn.QueryRow(query, obj.Schema, obj.Name)
	var def sql.NullString
	if err := row.Scan(&def); err == nil && def.Valid {
		obj.Definition = def.String
		return nil
	}

	// Fallback: OBJECT_DEFINITION
	fullName := obj.Name
	if obj.Schema != "" {
		fullName = obj.Schema + "." + obj.Name
	}
	row = conn.QueryRow("SELECT OBJECT_DEFINITION(OBJECT_ID(@p1)) AS definition", fullName)
	row.Scan(&def)
	if def.Valid {
		obj.Definition = def.String
	}
	return nil
}

func (e *SqlServerExtractor) fillColumn(conn *sql.DB, obj *db.DbObject) error {
	query := `SELECT tp.name AS TypeName, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity
	          FROM sys.columns c
	          INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
	          INNER JOIN sys.tables t ON c.object_id = t.object_id
	          WHERE SCHEMA_NAME(t.schema_id) = @p1 AND t.name = @p2 AND c.name = @p3`
	var typeName string
	var maxLen, prec, scale int
	var nullable, identity bool
	row := conn.QueryRow(query, obj.Schema, obj.ParentName, obj.Name)
	if err := row.Scan(&typeName, &maxLen, &prec, &scale, &nullable, &identity); err != nil {
		obj.Definition = "-- No se encontró información de la columna"
		return nil
	}

	fmtType := formatSQLType(typeName, maxLen, prec, scale)
	nullStr := "NOT NULL"
	if nullable {
		nullStr = "NULL"
	}
	idStr := ""
	if identity {
		idStr = " IDENTITY(1,1)"
	}
	tableFull := fmt.Sprintf("[%s].[%s]", obj.Schema, obj.ParentName)
	if obj.Schema == "" {
		tableFull = fmt.Sprintf("[%s]", obj.ParentName)
	}
	colName := obj.Name

	sb := &strings.Builder{}
	fmt.Fprintf(sb, "-- =======================================================\n")
	fmt.Fprintf(sb, "-- ADD COLUMN: %s -> [%s]\n", tableFull, colName)
	fmt.Fprintf(sb, "-- =======================================================\n")
	fmt.Fprintf(sb, "IF NOT EXISTS (\n    SELECT 1 FROM sys.columns\n    WHERE object_id = OBJECT_ID(N'%s')\n      AND name = '%s'\n)\nBEGIN\n    ALTER TABLE %s\n    ADD [%s] %s%s %s;\nEND\nGO\n\n",
		tableFull, colName, tableFull, colName, fmtType, idStr, nullStr)
	fmt.Fprintf(sb, "-- =======================================================\n")
	fmt.Fprintf(sb, "-- ALTER COLUMN: %s -> [%s]\n", tableFull, colName)
	fmt.Fprintf(sb, "-- =======================================================\n")
	fmt.Fprintf(sb, "IF EXISTS (\n    SELECT 1 FROM sys.columns\n    WHERE object_id = OBJECT_ID(N'%s')\n      AND name = '%s'\n)\nBEGIN\n    ALTER TABLE %s\n    ALTER COLUMN [%s] %s %s;\nEND\nGO\n",
		tableFull, colName, tableFull, colName, fmtType, nullStr)

	obj.Definition = sb.String()
	return nil
}

func (e *SqlServerExtractor) fillTable(conn *sql.DB, obj *db.DbObject) error {
	colQuery := `SELECT c.name AS ColumnName, tp.name AS TypeName, c.max_length, c.precision, c.scale, c.is_nullable, c.is_identity
	             FROM sys.columns c
	             INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id
	             INNER JOIN sys.tables t ON c.object_id = t.object_id
	             WHERE SCHEMA_NAME(t.schema_id) = @p1 AND t.name = @p2
	             ORDER BY c.column_id`
	pkQuery := `SELECT i.name AS PkName, c.name AS ColName
	            FROM sys.indexes i
	            INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id
	            INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id
	            INNER JOIN sys.tables t ON i.object_id = t.object_id
	            WHERE i.is_primary_key = 1 AND SCHEMA_NAME(t.schema_id) = @p1 AND t.name = @p2
	            ORDER BY ic.key_ordinal`

	rows, err := conn.Query(colQuery, obj.Schema, obj.Name)
	if err != nil {
		return err
	}
	defer rows.Close()

	var colLines []string
	for rows.Next() {
		var colName, typeName string
		var maxLen, prec, scale int
		var nullable, identity bool
		if err := rows.Scan(&colName, &typeName, &maxLen, &prec, &scale, &nullable, &identity); err != nil {
			return fmt.Errorf("scan table column: %w", err)
		}
		fmtType := formatSQLType(typeName, maxLen, prec, scale)
		idStr := ""
		if identity {
			idStr = " IDENTITY(1,1)"
		}
		nullStr := "NOT NULL"
		if nullable {
			nullStr = "NULL"
		}
		colLines = append(colLines, fmt.Sprintf("    [%s] %s%s %s", colName, fmtType, idStr, nullStr))
	}

	pkRows, err := conn.Query(pkQuery, obj.Schema, obj.Name)
	if err != nil {
		return err
	}
	defer pkRows.Close()
	var pkName string
	var pkCols []string
	for pkRows.Next() {
		var pk, col string
		if err := pkRows.Scan(&pk, &col); err != nil {
			return fmt.Errorf("scan primary key column: %w", err)
		}
		if pkName == "" {
			pkName = pk
		}
		pkCols = append(pkCols, "["+col+"]")
	}

	if len(colLines) == 0 {
		obj.Definition = "-- No se pudieron extraer columnas para la tabla."
		return nil
	}
	if len(pkCols) > 0 {
		if pkName == "" {
			pkName = "PK_" + obj.Name
		}
		colLines = append(colLines, fmt.Sprintf("    CONSTRAINT [%s] PRIMARY KEY CLUSTERED (%s)", pkName, strings.Join(pkCols, ", ")))
	}

	tableFull := fmt.Sprintf("[%s].[%s]", obj.Schema, obj.Name)
	if obj.Schema == "" {
		tableFull = fmt.Sprintf("[%s]", obj.Name)
	}
	obj.Definition = fmt.Sprintf("CREATE TABLE %s (\n%s\n);\nGO\n", tableFull, strings.Join(colLines, ",\n"))
	return nil
}

func formatSQLType(typeName string, maxLen, prec, scale int) string {
	if typeName == "" {
		return "VARCHAR(MAX)"
	}
	t := strings.ToLower(typeName)
	switch t {
	case "varchar", "char", "varbinary", "binary":
		if maxLen == -1 {
			return strings.ToUpper(typeName) + "(MAX)"
		}
		return fmt.Sprintf("%s(%d)", strings.ToUpper(typeName), maxLen)
	case "nvarchar", "nchar":
		if maxLen == -1 {
			return strings.ToUpper(typeName) + "(MAX)"
		}
		return fmt.Sprintf("%s(%d)", strings.ToUpper(typeName), maxLen/2)
	case "decimal", "numeric":
		return fmt.Sprintf("%s(%d, %d)", strings.ToUpper(typeName), prec, scale)
	case "time", "datetime2", "datetimeoffset":
		if scale != 7 {
			return fmt.Sprintf("%s(%d)", strings.ToUpper(typeName), scale)
		}
		return strings.ToUpper(typeName)
	default:
		return strings.ToUpper(typeName)
	}
}
