package com.cdog.projects.db;

public class DbObject {
    private final DbObjectType type;
    private final String schema;
    private final String parentName;
    private final String name;
    private String definition;

    public DbObject(DbObjectType type, String schema, String parentName, String name, String definition) {
        this.type = type != null ? type : DbObjectType.STORED_PROCEDURE;
        this.schema = schema != null ? schema : "";
        this.parentName = parentName != null ? parentName : "";
        this.name = name != null ? name : "";
        this.definition = definition;
    }

    public DbObject(DbObjectType type, String schema, String name, String definition) {
        this(type, schema, "", name, definition);
    }

    public DbObjectType getType() {
        return type;
    }

    public String getSchema() {
        return schema;
    }

    public String getParentName() {
        return parentName;
    }

    public String getName() {
        return name;
    }

    public String getDefinition() {
        return definition;
    }

    public void setDefinition(String definition) {
        this.definition = definition;
    }

    public String getFullName() {
        if (type == DbObjectType.COLUMN) {
            String tableFull = schema.isEmpty() ? parentName : schema + "." + parentName;
            return tableFull + " \u2192 " + name;
        }
        return schema.isEmpty() ? name : schema + "." + name;
    }

    public String getSqlIdentifier() {
        if (type == DbObjectType.COLUMN) {
            String tableFull = schema.isEmpty() ? String.format("[%s]", parentName) : String.format("[%s].[%s]", schema, parentName);
            return tableFull;
        }
        return schema.isEmpty() ? String.format("[%s]", name) : String.format("[%s].[%s]", schema, name);
    }

    @Override
    public String toString() {
        return getFullName();
    }
}
