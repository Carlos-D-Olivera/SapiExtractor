package com.cdog.projects.db.extractors;

import com.cdog.projects.db.StoredProcedure;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class MySqlExtractor implements SpExtractorStrategy {
    @Override
    public List<StoredProcedure> extractNames(Connection connection) throws SQLException {
        List<StoredProcedure> procedures = new ArrayList<>();
        String query = 
            "SELECT " +
            "    ROUTINE_SCHEMA AS SchemaName, " +
            "    ROUTINE_NAME AS ProcedureName " +
            "FROM information_schema.ROUTINES " +
            "WHERE ROUTINE_TYPE = 'PROCEDURE' " +
            "  AND ROUTINE_SCHEMA = DATABASE() " +
            "ORDER BY ProcedureName";

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
            "SELECT ROUTINE_DEFINITION " +
            "FROM information_schema.ROUTINES " +
            "WHERE ROUTINE_TYPE = 'PROCEDURE' " +
            "  AND ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ?";
        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, sp.getSchema());
            stmt.setString(2, sp.getName());
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    String def = rs.getString("ROUTINE_DEFINITION");
                    sp.setDefinition("CREATE PROCEDURE " + sp.getName() + "()\n" + def);
                }
            }
        }
    }
}
