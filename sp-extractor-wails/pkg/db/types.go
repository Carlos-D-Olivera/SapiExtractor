package db

// DatabaseType represents the supported database engines.
type DatabaseType string

const (
	SQLServer  DatabaseType = "SQL_SERVER"
	MySQL      DatabaseType = "MYSQL"
	PostgreSQL DatabaseType = "POSTGRESQL"
)

// DbObjectType represents the type of database object.
type DbObjectType string

const (
	StoredProcedure DbObjectType = "STORED_PROCEDURE"
	Table           DbObjectType = "TABLE"
	Column          DbObjectType = "COLUMN"
	Function        DbObjectType = "FUNCTION"
	Trigger         DbObjectType = "TRIGGER"
	View            DbObjectType = "VIEW"
)

// ConnInfo holds all parameters needed to open a database connection.
type ConnInfo struct {
	DbType   DatabaseType `json:"dbType"`
	Host     string       `json:"host"`
	Port     string       `json:"port"`
	DbName   string       `json:"dbName"`
	User     string       `json:"user"`
	Password string       `json:"password"`
}

// DbObject represents a generic database object (SP, table, column, etc.).
type DbObject struct {
	Type       DbObjectType `json:"type"`
	Schema     string       `json:"schema"`
	ParentName string       `json:"parentName"`
	Name       string       `json:"name"`
	Definition string       `json:"definition,omitempty"`
}

// TableColumn describes a single column of a table for the schema model view.
type TableColumn struct {
	Name       string `json:"name"`
	DataType   string `json:"dataType"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
}

// SchemaTable is a table node in the schema/relationship model.
type SchemaTable struct {
	Schema  string        `json:"schema"`
	Name    string        `json:"name"`
	Columns []TableColumn `json:"columns"`
}

// ForeignKey describes a single-column foreign-key relationship.
type ForeignKey struct {
	Name       string `json:"name"`
	FromSchema string `json:"fromSchema"`
	FromTable  string `json:"fromTable"`
	FromColumn string `json:"fromColumn"`
	ToSchema   string `json:"toSchema"`
	ToTable    string `json:"toTable"`
	ToColumn   string `json:"toColumn"`
}

// SchemaModel is a graph of tables connected by foreign keys, seeded from a
// specific table and expanded to a bounded depth.
type SchemaModel struct {
	Tables []SchemaTable `json:"tables"`
	Edges  []ForeignKey  `json:"edges"`
}


// FilePrefix returns the short prefix used in exported filenames (parity with
// the Java DbObjectType.getFilePrefix).
func (t DbObjectType) FilePrefix() string {
	switch t {
	case StoredProcedure:
		return "sp"
	case Table:
		return "table"
	case Column:
		return "col"
	case Function:
		return "func"
	case Trigger:
		return "trg"
	case View:
		return "view"
	}
	return "obj"
}

// FullName returns a display-friendly qualified name.
func (o DbObject) FullName() string {
	if o.Type == Column {
		table := o.ParentName
		if o.Schema != "" {
			table = o.Schema + "." + o.ParentName
		}
		return table + " → " + o.Name
	}
	if o.Schema != "" {
		return o.Schema + "." + o.Name
	}
	return o.Name
}
