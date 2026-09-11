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
    public List<StoredProcedure> extract(Connection connection) throws SQLException {
        List<StoredProcedure> procedures = new ArrayList<>();
        String query = 
            "SELECT " +
            "    SCHEMA_NAME(p.schema_id) AS SchemaName, " +
            "    p.name AS ProcedureName, " +
            "    m.definition AS Definition " +
            "FROM sys.procedures p " +
            "INNER JOIN sys.sql_modules m ON p.object_id = m.object_id " +
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
