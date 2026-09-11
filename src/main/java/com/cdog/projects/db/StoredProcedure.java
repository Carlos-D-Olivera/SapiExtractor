package com.cdog.projects.db;

public class StoredProcedure {
    private final String schema;
    private final String name;
    private final String definition;

    public StoredProcedure(String schema, String name, String definition) {
        this.schema = schema != null ? schema : "";
        this.name = name;
        this.definition = definition;
    }

    public String getSchema() { return schema; }
    public String getName() { return name; }
    public String getDefinition() { return definition; }
    
    public String getFullName() {
        return schema.isEmpty() ? name : schema + "." + name;
    }
}
