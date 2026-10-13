package com.cdog.projects.db.extractors;

import com.cdog.projects.db.DbObject;
import com.cdog.projects.db.DbObjectType;
import com.cdog.projects.db.StoredProcedure;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public interface SpExtractorStrategy {
    List<StoredProcedure> extractNames(Connection connection) throws SQLException;
    void fillDefinition(Connection connection, StoredProcedure sp) throws SQLException;

    default List<DbObject> extractObjects(Connection connection, DbObjectType type) throws SQLException {
        if (type == DbObjectType.STORED_PROCEDURE) {
            return new ArrayList<>(extractNames(connection));
        }
        return new ArrayList<>();
    }

    default void fillDefinition(Connection connection, DbObject obj) throws SQLException {
        if (obj instanceof StoredProcedure sp) {
            fillDefinition(connection, sp);
        }
    }
}
