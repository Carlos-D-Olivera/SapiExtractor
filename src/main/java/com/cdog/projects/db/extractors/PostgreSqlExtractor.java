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
    public List<StoredProcedure> extract(Connection connection) throws SQLException {
        List<StoredProcedure> procedures = new ArrayList<>();
        String query = 
            "SELECT " +
            "    n.nspname AS SchemaName, " +
            "    p.proname AS ProcedureName, " +
            "    pg_get_functiondef(p.oid) AS Definition " +
            "FROM pg_proc p " +
            "INNER JOIN pg_namespace n ON n.oid = p.pronamespace " +
            "WHERE p.prokind = 'p' OR p.prokind = 'f' " + // Procedures and functions
            "  AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
            "ORDER BY SchemaName, ProcedureName";

        try (PreparedStatement stmt = connection.prepareStatement(query);
             ResultSet rs = stmt.executeQuery()) {
             
            while (rs.next()) {
                procedures.add(new StoredProcedure(
                    rs.getString("SchemaName"),
                    rs.getString("ProcedureName"),
                    rs.getString("Definition")
                ));
            }
        }
        return procedures;
    }
}
