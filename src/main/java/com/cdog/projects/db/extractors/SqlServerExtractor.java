package com.cdog.projects.db.extractors;

import com.cdog.projects.db.DbObject;
import com.cdog.projects.db.DbObjectType;
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
        fillDefinition(connection, (DbObject) sp);
    }

    @Override
    public List<DbObject> extractObjects(Connection connection, DbObjectType type) throws SQLException {
        List<DbObject> list = new ArrayList<>();
        String query;

        switch (type) {
            case STORED_PROCEDURE -> {
                return new ArrayList<>(extractNames(connection));
            }
            case TABLE -> {
                query = "SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ObjectName " +
                        "FROM sys.tables " +
                        "ORDER BY SchemaName, ObjectName";
                try (PreparedStatement stmt = connection.prepareStatement(query);
                     ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        list.add(new DbObject(type, rs.getString("SchemaName"), rs.getString("ObjectName"), null));
                    }
                }
            }
            case COLUMN -> {
                query = "SELECT SCHEMA_NAME(t.schema_id) AS SchemaName, t.name AS TableName, c.name AS ColumnName " +
                        "FROM sys.columns c " +
                        "INNER JOIN sys.tables t ON c.object_id = t.object_id " +
                        "ORDER BY SchemaName, TableName, c.name";
                try (PreparedStatement stmt = connection.prepareStatement(query);
                     ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        list.add(new DbObject(
                            type,
                            rs.getString("SchemaName"),
                            rs.getString("TableName"),
                            rs.getString("ColumnName"),
                            null
                        ));
                    }
                }
            }
            case FUNCTION -> {
                query = "SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ObjectName " +
                        "FROM sys.objects " +
                        "WHERE type IN ('FN', 'IF', 'TF', 'FS', 'FT') " +
                        "ORDER BY SchemaName, ObjectName";
                try (PreparedStatement stmt = connection.prepareStatement(query);
                     ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        list.add(new DbObject(type, rs.getString("SchemaName"), rs.getString("ObjectName"), null));
                    }
                }
            }
            case TRIGGER -> {
                query = "SELECT SCHEMA_NAME(o.schema_id) AS SchemaName, t.name AS ObjectName, o.name AS TableName " +
                        "FROM sys.triggers t " +
                        "INNER JOIN sys.objects o ON t.parent_id = o.object_id " +
                        "ORDER BY SchemaName, ObjectName";
                try (PreparedStatement stmt = connection.prepareStatement(query);
                     ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        list.add(new DbObject(
                            type,
                            rs.getString("SchemaName"),
                            rs.getString("TableName"),
                            rs.getString("ObjectName"),
                            null
                        ));
                    }
                }
            }
            case VIEW -> {
                query = "SELECT SCHEMA_NAME(schema_id) AS SchemaName, name AS ObjectName " +
                        "FROM sys.views " +
                        "ORDER BY SchemaName, ObjectName";
                try (PreparedStatement stmt = connection.prepareStatement(query);
                     ResultSet rs = stmt.executeQuery()) {
                    while (rs.next()) {
                        list.add(new DbObject(type, rs.getString("SchemaName"), rs.getString("ObjectName"), null));
                    }
                }
            }
        }
        return list;
    }

    @Override
    public void fillDefinition(Connection connection, DbObject obj) throws SQLException {
        if (obj == null) return;

        switch (obj.getType()) {
            case STORED_PROCEDURE, FUNCTION, VIEW, TRIGGER -> fillRoutineOrViewDefinition(connection, obj);
            case COLUMN -> fillColumnDefinition(connection, obj);
            case TABLE -> fillTableDefinition(connection, obj);
        }
    }

    private void fillRoutineOrViewDefinition(Connection connection, DbObject obj) throws SQLException {
        String query = 
            "SELECT m.definition " +
            "FROM sys.objects o " +
            "INNER JOIN sys.sql_modules m ON o.object_id = m.object_id " +
            "WHERE SCHEMA_NAME(o.schema_id) = ? AND o.name = ?";
        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, obj.getSchema());
            stmt.setString(2, obj.getName());
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    obj.setDefinition(rs.getString("definition"));
                    return;
                }
            }
        }

        // Fallback using OBJECT_DEFINITION
        String fullObjName = obj.getSchema().isEmpty() ? obj.getName() : obj.getSchema() + "." + obj.getName();
        String fallback = "SELECT OBJECT_DEFINITION(OBJECT_ID(?)) AS definition";
        try (PreparedStatement stmt = connection.prepareStatement(fallback)) {
            stmt.setString(1, fullObjName);
            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    obj.setDefinition(rs.getString("definition"));
                } else {
                    obj.setDefinition(null);
                }
            }
        }
    }

    private void fillColumnDefinition(Connection connection, DbObject obj) throws SQLException {
        String query = 
            "SELECT " +
            "    tp.name AS TypeName, " +
            "    c.max_length, " +
            "    c.precision, " +
            "    c.scale, " +
            "    c.is_nullable, " +
            "    c.is_identity " +
            "FROM sys.columns c " +
            "INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id " +
            "INNER JOIN sys.tables t ON c.object_id = t.object_id " +
            "WHERE SCHEMA_NAME(t.schema_id) = ? AND t.name = ? AND c.name = ?";

        try (PreparedStatement stmt = connection.prepareStatement(query)) {
            stmt.setString(1, obj.getSchema());
            stmt.setString(2, obj.getParentName());
            stmt.setString(3, obj.getName());

            try (ResultSet rs = stmt.executeQuery()) {
                if (rs.next()) {
                    String typeName = rs.getString("TypeName");
                    int maxLength = rs.getInt("max_length");
                    int precision = rs.getInt("precision");
                    int scale = rs.getInt("scale");
                    boolean isNullable = rs.getBoolean("is_nullable");
                    boolean isIdentity = rs.getBoolean("is_identity");

                    String formattedType = formatSqlType(typeName, maxLength, precision, scale);
                    String nullability = isNullable ? "NULL" : "NOT NULL";
                    String identityStr = isIdentity ? " IDENTITY(1,1)" : "";

                    String tableFull = obj.getSchema().isEmpty() 
                        ? String.format("[%s]", obj.getParentName()) 
                        : String.format("[%s].[%s]", obj.getSchema(), obj.getParentName());
                    String colName = obj.getName();

                    StringBuilder sb = new StringBuilder();
                    sb.append("-- =======================================================\n");
                    sb.append(String.format("-- ADD COLUMN: %s -> [%s]\n", tableFull, colName));
                    sb.append("-- =======================================================\n");
                    sb.append(String.format("IF NOT EXISTS (\n" +
                            "    SELECT 1 FROM sys.columns \n" +
                            "    WHERE object_id = OBJECT_ID(N'%s') \n" +
                            "      AND name = '%s'\n" +
                            ")\n" +
                            "BEGIN\n" +
                            "    ALTER TABLE %s\n" +
                            "    ADD [%s] %s%s %s;\n" +
                            "END\n" +
                            "GO\n\n", tableFull, colName, tableFull, colName, formattedType, identityStr, nullability));

                    sb.append("-- =======================================================\n");
                    sb.append(String.format("-- ALTER COLUMN: %s -> [%s]\n", tableFull, colName));
                    sb.append("-- =======================================================\n");
                    sb.append(String.format("IF EXISTS (\n" +
                            "    SELECT 1 FROM sys.columns \n" +
                            "    WHERE object_id = OBJECT_ID(N'%s') \n" +
                            "      AND name = '%s'\n" +
                            ")\n" +
                            "BEGIN\n" +
                            "    ALTER TABLE %s\n" +
                            "    ALTER COLUMN [%s] %s %s;\n" +
                            "END\n" +
                            "GO\n", tableFull, colName, tableFull, colName, formattedType, nullability));

                    obj.setDefinition(sb.toString());
                } else {
                    obj.setDefinition("-- No se encontró información de la columna");
                }
            }
        }
    }

    private void fillTableDefinition(Connection connection, DbObject obj) throws SQLException {
        String colQuery = 
            "SELECT " +
            "    c.name AS ColumnName, " +
            "    tp.name AS TypeName, " +
            "    c.max_length, " +
            "    c.precision, " +
            "    c.scale, " +
            "    c.is_nullable, " +
            "    c.is_identity " +
            "FROM sys.columns c " +
            "INNER JOIN sys.types tp ON c.user_type_id = tp.user_type_id " +
            "INNER JOIN sys.tables t ON c.object_id = t.object_id " +
            "WHERE SCHEMA_NAME(t.schema_id) = ? AND t.name = ? " +
            "ORDER BY c.column_id";

        String pkQuery = 
            "SELECT i.name AS PkName, c.name AS ColName " +
            "FROM sys.indexes i " +
            "INNER JOIN sys.index_columns ic ON i.object_id = ic.object_id AND i.index_id = ic.index_id " +
            "INNER JOIN sys.columns c ON ic.object_id = c.object_id AND ic.column_id = c.column_id " +
            "INNER JOIN sys.tables t ON i.object_id = t.object_id " +
            "WHERE i.is_primary_key = 1 AND SCHEMA_NAME(t.schema_id) = ? AND t.name = ? " +
            "ORDER BY ic.key_ordinal";

        List<String> columnLines = new ArrayList<>();
        try (PreparedStatement stmt = connection.prepareStatement(colQuery)) {
            stmt.setString(1, obj.getSchema());
            stmt.setString(2, obj.getName());
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    String colName = rs.getString("ColumnName");
                    String typeName = rs.getString("TypeName");
                    int maxLength = rs.getInt("max_length");
                    int precision = rs.getInt("precision");
                    int scale = rs.getInt("scale");
                    boolean isNullable = rs.getBoolean("is_nullable");
                    boolean isIdentity = rs.getBoolean("is_identity");

                    String formattedType = formatSqlType(typeName, maxLength, precision, scale);
                    String identityStr = isIdentity ? " IDENTITY(1,1)" : "";
                    String nullability = isNullable ? "NULL" : "NOT NULL";

                    columnLines.add(String.format("    [%s] %s%s %s", colName, formattedType, identityStr, nullability));
                }
            }
        }

        String pkName = null;
        List<String> pkColumns = new ArrayList<>();
        try (PreparedStatement stmt = connection.prepareStatement(pkQuery)) {
            stmt.setString(1, obj.getSchema());
            stmt.setString(2, obj.getName());
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    if (pkName == null) pkName = rs.getString("PkName");
                    pkColumns.add("[" + rs.getString("ColName") + "]");
                }
            }
        }

        if (columnLines.isEmpty()) {
            obj.setDefinition("-- No se pudieron extraer columnas para la tabla.");
            return;
        }

        if (!pkColumns.isEmpty()) {
            String pkConstraint = String.format("    CONSTRAINT [%s] PRIMARY KEY CLUSTERED (%s)",
                pkName != null ? pkName : "PK_" + obj.getName(),
                String.join(", ", pkColumns));
            columnLines.add(pkConstraint);
        }

        String tableFull = obj.getSchema().isEmpty() 
            ? String.format("[%s]", obj.getName()) 
            : String.format("[%s].[%s]", obj.getSchema(), obj.getName());

        StringBuilder sb = new StringBuilder();
        sb.append(String.format("CREATE TABLE %s (\n", tableFull));
        sb.append(String.join(",\n", columnLines));
        sb.append("\n);\nGO\n");

        obj.setDefinition(sb.toString());
    }

    private String formatSqlType(String typeName, int maxLength, int precision, int scale) {
        if (typeName == null) return "VARCHAR(MAX)";
        String typeLower = typeName.toLowerCase();
        return switch (typeLower) {
            case "varchar", "char", "varbinary", "binary" -> {
                if (maxLength == -1) yield typeName.toUpperCase() + "(MAX)";
                yield typeName.toUpperCase() + "(" + maxLength + ")";
            }
            case "nvarchar", "nchar" -> {
                if (maxLength == -1) yield typeName.toUpperCase() + "(MAX)";
                yield typeName.toUpperCase() + "(" + (maxLength / 2) + ")";
            }
            case "decimal", "numeric" -> typeName.toUpperCase() + "(" + precision + ", " + scale + ")";
            case "time", "datetime2", "datetimeoffset" -> {
                if (scale != 7) yield typeName.toUpperCase() + "(" + scale + ")";
                yield typeName.toUpperCase();
            }
            default -> typeName.toUpperCase();
        };
    }
}
