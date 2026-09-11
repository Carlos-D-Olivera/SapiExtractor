package com.cdog.projects.db;

public enum DatabaseType {
    SQL_SERVER("SQL Server", "com.microsoft.sqlserver.jdbc.SQLServerDriver", "jdbc:sqlserver://%s:%s;databaseName=%s;encrypt=false"),
    MYSQL("MySQL / MariaDB", "com.mysql.cj.jdbc.Driver", "jdbc:mysql://%s:%s/%s"),
    POSTGRESQL("PostgreSQL", "org.postgresql.Driver", "jdbc:postgresql://%s:%s/%s");

    private final String displayName;
    private final String driverClass;
    private final String connectionTemplate;

    DatabaseType(String displayName, String driverClass, String connectionTemplate) {
        this.displayName = displayName;
        this.driverClass = driverClass;
        this.connectionTemplate = connectionTemplate;
    }

    public String getDisplayName() { return displayName; }
    public String getDriverClass() { return driverClass; }
    
    public String buildUrl(String host, String port, String dbName) {
        return String.format(connectionTemplate, host, port, dbName);
    }

    @Override
    public String toString() {
        return displayName;
    }
}
