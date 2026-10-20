package com.cdog.projects.db;

public class StoredProcedure extends DbObject {
    public StoredProcedure(String schema, String name, String definition) {
        super(DbObjectType.STORED_PROCEDURE, schema, name, definition);
    }
}
