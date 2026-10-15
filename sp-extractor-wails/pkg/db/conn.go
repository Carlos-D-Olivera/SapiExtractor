package db

import (
	"database/sql"
	"fmt"

	_ "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/microsoft/go-mssqldb"
)

// buildDSN constructs the driver-specific connection string.
func buildDSN(c ConnInfo, serverOnly bool) string {
	switch c.DbType {
	case SQLServer:
		if serverOnly {
			return fmt.Sprintf("sqlserver://%s:%s@%s:%s?encrypt=disable&TrustServerCertificate=true",
				c.User, c.Password, c.Host, c.Port)
		}
		return fmt.Sprintf("sqlserver://%s:%s@%s:%s?database=%s&encrypt=disable&TrustServerCertificate=true",
			c.User, c.Password, c.Host, c.Port, c.DbName)
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
		return fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
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
			continue
		}
		if name != "" {
			dbs = append(dbs, name)
		}
	}
	return dbs, rows.Err()
}
