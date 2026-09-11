package com.cdog.projects.db.extractors;

import com.cdog.projects.db.StoredProcedure;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.List;

public interface SpExtractorStrategy {
    List<StoredProcedure> extract(Connection connection) throws SQLException;
}
