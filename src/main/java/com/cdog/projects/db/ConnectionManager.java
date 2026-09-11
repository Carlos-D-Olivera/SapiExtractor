package com.cdog.projects.db;

import com.cdog.projects.db.extractors.MySqlExtractor;
import com.cdog.projects.db.extractors.PostgreSqlExtractor;
import com.cdog.projects.db.extractors.SpExtractorStrategy;
import com.cdog.projects.db.extractors.SqlServerExtractor;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.List;

public class ConnectionManager {
    private Connection currentConnection;
    private DatabaseType currentType;

    public void connect(DatabaseType type, String host, String port, String dbName, String user, String password) throws SQLException, ClassNotFoundException {
        disconnect();
        
        Class.forName(type.getDriverClass());
        String url = type.buildUrl(host, port, dbName);
        
        currentConnection = DriverManager.getConnection(url, user, password);
        currentType = type;
    }

    public void disconnect() {
        if (currentConnection != null) {
            try {
                currentConnection.close();
            } catch (SQLException e) {
                e.printStackTrace();
            } finally {
                currentConnection = null;
                currentType = null;
            }
        }
    }

    public boolean isConnected() {
        try {
            return currentConnection != null && !currentConnection.isClosed();
        } catch (SQLException e) {
            return false;
        }
    }
    
    public List<StoredProcedure> extractProcedures() throws SQLException {
        if (!isConnected()) {
            throw new SQLException("No active connection");
        }
        
        SpExtractorStrategy extractor = switch (currentType) {
            case SQL_SERVER -> new SqlServerExtractor();
            case MYSQL -> new MySqlExtractor();
            case POSTGRESQL -> new PostgreSqlExtractor();
        };
        
        return extractor.extract(currentConnection);
    }
}
