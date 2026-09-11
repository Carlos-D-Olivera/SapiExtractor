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
    public List<StoredProcedure> extract(Connection connection) throws SQLException {
        List<StoredProcedure> procedures = new ArrayList<>();
        // In MySQL, we typically get routines for the current database schema.
        String query = 
            "SELECT " +
            "    ROUTINE_SCHEMA AS SchemaName, " +
            "    ROUTINE_NAME AS ProcedureName, " +
            "    ROUTINE_DEFINITION AS Definition " +
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
                    // In MySQL ROUTINE_DEFINITION often needs CREATE PROCEDURE prepended to be fully reproducible
                    // or SHOW CREATE PROCEDURE can be used for exact text. For simplicity we use the view.
                    "CREATE PROCEDURE " + rs.getString("ProcedureName") + "()\n" + rs.getString("Definition")
                ));
            }
        }
        return procedures;
    }
}
