package com.cdog.projects.db.extractors;

import com.cdog.projects.db.StoredProcedure;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class PostgreSqlExtractor implements SpExtractorStrategy {
    @Override
    public List<StoredProcedure> extractNames(Connection connection) throws SQLException {
        List<StoredProcedure> procedures = new ArrayList<>();
        String query = 
            "SELECT " +
            "    n.nspname AS SchemaName, " +
            "    p.proname AS ProcedureName " +
            "FROM pg_proc p " +
            "INNER JOIN pg_namespace n ON n.oid = p.pronamespace " +
            "WHERE (p.prokind = 'p' OR p.prokind = 'f') " +
            "  AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
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
            "SELECT pg_get_functiondef(p.oid) AS Definition " +
            "FROM pg_proc p " +
            "INNER JOIN pg_namespace n ON n.oid = p.pronamespace " +
            "WHERE n.nspname = ? AND p.proname = ?";
        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, sp.getSchema());
            stmt.setString(2, sp.getName());
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    sp.setDefinition(rs.getString("Definition"));
                } else {
                    sp.setDefinition(null);
                }
            }
        }
    }
}
