package com.cdog.projects.db.extractors;

import com.cdog.projects.db.StoredProcedure;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class SqlServerExtractor implements SpExtractorStrategy {
    @Override
    public List<StoredProcedure> extractNames(Connection connection) throws SQLException {
        List<StoredProcedure> procedures = new ArrayList<>();
        String query = 
            "SELECT " +
            "    SCHEMA_NAME(schema_id) AS SchemaName, " +
            "    name AS ProcedureName " +
            "FROM sys.procedures " +
            "ORDER BY SchemaName, ProcedureName";

        try (PreparedStatement stmt = connection.prepareStatement(query);
             ResultSet rs = stmt.executeQuery()) {
            while (rs.next()) {
                procedures.add(new StoredProcedure(
                    rs.getString("SchemaName"),
                    rs.getString("ProcedureName"),
                    null
                ));
            }
        }
        return procedures;
    }

    @Override
    public void fillDefinition(Connection connection, StoredProcedure sp) throws SQLException {
        String query = 
            "SELECT m.definition " +
            "FROM sys.procedures p " +
            "INNER JOIN sys.sql_modules m ON p.object_id = m.object_id " +
            "WHERE SCHEMA_NAME(p.schema_id) = ? AND p.name = ?";
        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, sp.getSchema());
            stmt.setString(2, sp.getName());
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    sp.setDefinition(rs.getString("definition"));
                } else {
                    sp.setDefinition(null);
                }
            }
        }
    }
}
