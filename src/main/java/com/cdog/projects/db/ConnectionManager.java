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
    private SpExtractorStrategy currentExtractor;
    private String connectedDbName;

    public void connect(DatabaseType type, String host, String port, String dbName, String user, String password) throws SQLException, ClassNotFoundException {
        disconnect();
        
        Class.forName(type.getDriverClass());
        String url = type.buildUrl(host, port, dbName);
        
        currentConnection = DriverManager.getConnection(url, user, password);
        currentType = type;
        connectedDbName = dbName;
        
        currentExtractor = switch (type) {
            case SQL_SERVER -> new SqlServerExtractor();
            case MYSQL -> new MySqlExtractor();
            case POSTGRESQL -> new PostgreSqlExtractor();
        };
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
                currentExtractor = null;
                connectedDbName = null;
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
    
    public String getConnectedDbName() {
        return connectedDbName;
    }
    
    public List<StoredProcedure> extractProcedureNames() throws SQLException {
        if (!isConnected()) {
            throw new SQLException("No active connection");
        }
        return currentExtractor.extractNames(currentConnection);
    }
    
    public void fillProcedureDefinition(StoredProcedure sp) throws SQLException {
        if (!isConnected()) {
            throw new SQLException("No active connection");
        }
        if (sp.getDefinition() == null) {
            currentExtractor.fillDefinition(currentConnection, sp);
        }
    }
}
