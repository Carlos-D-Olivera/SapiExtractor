package db

import (
	"database/sql"
	"fmt"
	"net/url"
	"strings"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/microsoft/go-mssqldb"
)

// AppName is the client application name this app reports to SQL Server.
const AppName = "SapiExtractor"

// buildSQLServerDSN builds a go-mssqldb URL connection string.
//
// The host may contain a named instance using the SQL Server "host\instance"
// (or "host/instance") notation. In the driver URL the instance must live in
// the path (sqlserver://user:pass@host/instance), never in the host portion,
// otherwise url.Parse fails with `invalid character "\" in host name`.
//
// When a named instance is present the port is intentionally omitted so the
// driver resolves the instance's dynamic port via SQL Server Browser. If a port
// were included, go-mssqldb skips the browser lookup and dials that fixed port,
// connecting to whatever instance listens there (e.g. the default instance)
// instead of the requested one.
//
// User/password and query values are URL-encoded so special characters are safe.
func buildSQLServerDSN(c ConnInfo, dbName string) string {
	host := c.Host
	instance := ""
	if i := strings.IndexAny(host, `\/`); i >= 0 {
		instance = host[i+1:]
		host = host[:i]
	}

	u := &url.URL{
		Scheme: "sqlserver",
		User:   url.UserPassword(c.User, c.Password),
		Host:   host,
	}
	// Only set an explicit port for the default instance. Named instances are
	// resolved through the SQL Browser, which requires the port to be unset.
	if c.Port != "" && instance == "" {
		u.Host = host + ":" + c.Port
	}
	if instance != "" {
		u.Path = "/" + instance
	}

	q := url.Values{}
	q.Set("encrypt", "disable")
	q.Set("TrustServerCertificate", "true")
	q.Set("app name", AppName) // lets the trace tool tell this app's statements apart from others'
	if dbName != "" {
		q.Set("database", dbName)
	}
	u.RawQuery = q.Encode()
	return u.String()
}

// buildDSN constructs the driver-specific connection string.
func buildDSN(c ConnInfo, serverOnly bool) string {
	switch c.DbType {
	case SQLServer:
		dbName := ""
		if !serverOnly {
			dbName = c.DbName
		}
		return buildSQLServerDSN(c, dbName)
	case MySQL:
		if serverOnly {
			return fmt.Sprintf("%s:%s@tcp(%s:%s)/?tls=skip-verify&allowPublicKeyRetrieval=true",
				c.User, c.Password, c.Host, c.Port)
		}
		return fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?tls=skip-verify&allowPublicKeyRetrieval=true",
			c.User, c.Password, c.Host, c.Port, c.DbName)
	case PostgreSQL:
		dbName := c.DbName
		if serverOnly || dbName == "" {
			dbName = "postgres"
		}
		return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=prefer",
			c.Host, c.Port, c.User, c.Password, dbName)
	}
	return ""
}

// driverName returns the registered sql driver name for the given DB type.
func driverName(t DatabaseType) string {
	switch t {
	case SQLServer:
		return "sqlserver"
	case MySQL:
		return "mysql"
	case PostgreSQL:
		return "pgx"
	}
	return ""
}

// Open opens a connection to the specified database.
func Open(c ConnInfo) (*sql.DB, error) {
	dsn := buildDSN(c, false)
	db, err := sql.Open(driverName(c.DbType), dsn)
	if err != nil {
		return nil, err
	}
	if err = db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// ListDatabases connects at the server level and returns all available databases.
func ListDatabases(c ConnInfo) ([]string, error) {
	serverConn := c
	serverConn.DbName = ""
	dsn := buildDSN(serverConn, true)
	sqlDB, err := sql.Open(driverName(c.DbType), dsn)
	if err != nil {
		return nil, err
	}
	defer sqlDB.Close()
	if err = sqlDB.Ping(); err != nil {
		return nil, err
	}

	var query string
	switch c.DbType {
	case SQLServer:
		query = "SELECT name FROM sys.databases WHERE state = 0 ORDER BY name"
	case MySQL:
		query = "SHOW DATABASES"
	case PostgreSQL:
		query = "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"
	}

	rows, err := sqlDB.Query(query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var dbs []string
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("scan database name: %w", err)
		}
		if name != "" {
			dbs = append(dbs, name)
		}
	}
	return dbs, rows.Err()
}
