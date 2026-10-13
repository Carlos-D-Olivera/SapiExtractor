package com.cdog.projects.db;

public enum DbObjectType {
    STORED_PROCEDURE("Stored Procedures", "Buscar procedimientos...", "Copiar SP", "sp"),
    TABLE("Tables", "Buscar tablas...", "Copiar Tabla", "table"),
    COLUMN("Columns", "Buscar columnas...", "Copiar Columna", "col"),
    FUNCTION("Functions", "Buscar funciones...", "Copiar Función", "func"),
    TRIGGER("Triggers", "Buscar triggers...", "Copiar Trigger", "trg"),
    VIEW("Views", "Buscar vistas...", "Copiar Vista", "view");

    private final String displayName;
    private final String searchPlaceholder;
    private final String copyButtonText;
    private final String filePrefix;

    DbObjectType(String displayName, String searchPlaceholder, String copyButtonText, String filePrefix) {
        this.displayName = displayName;
        this.searchPlaceholder = searchPlaceholder;
        this.copyButtonText = copyButtonText;
        this.filePrefix = filePrefix;
    }

    public String getDisplayName() {
        return displayName;
    }

    public String getSearchPlaceholder() {
        return searchPlaceholder;
    }

    public String getCopyButtonText() {
        return copyButtonText;
    }

    public String getFilePrefix() {
        return filePrefix;
    }

    @Override
    public String toString() {
        return displayName;
    }
}
