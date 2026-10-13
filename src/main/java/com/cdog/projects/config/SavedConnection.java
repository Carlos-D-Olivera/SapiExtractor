package com.cdog.projects.config;

import com.cdog.projects.db.DatabaseType;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Objects;

public class SavedConnection {
    private DatabaseType dbType;
    private String host;
    private String port;
    private String dbName;
    private String user;
    private String passwordBase64;
    private boolean rememberPassword;
    private long lastUsed;

    public SavedConnection() {
    }

    public SavedConnection(DatabaseType dbType, String host, String port, String dbName, String user, String rawPassword, boolean rememberPassword) {
        this.dbType = dbType;
        this.host = host;
        this.port = port;
        this.dbName = dbName;
        this.user = user;
        this.rememberPassword = rememberPassword;
        this.lastUsed = System.currentTimeMillis();
        setPassword(rawPassword, rememberPassword);
    }

    public DatabaseType getDbType() {
        return dbType;
    }

    public void setDbType(DatabaseType dbType) {
        this.dbType = dbType;
    }

    public String getHost() {
        return host;
    }

    public void setHost(String host) {
        this.host = host;
    }

    public String getPort() {
        return port;
    }

    public void setPort(String port) {
        this.port = port;
    }

    public String getDbName() {
        return dbName;
    }

    public void setDbName(String dbName) {
        this.dbName = dbName;
    }

    public String getUser() {
        return user;
    }

    public void setUser(String user) {
        this.user = user;
    }

    public String getPasswordBase64() {
        return passwordBase64;
    }

    public void setPasswordBase64(String passwordBase64) {
        this.passwordBase64 = passwordBase64;
    }

    public boolean isRememberPassword() {
        return rememberPassword;
    }

    public void setRememberPassword(boolean rememberPassword) {
        this.rememberPassword = rememberPassword;
    }

    public long getLastUsed() {
        return lastUsed;
    }

    public void setLastUsed(long lastUsed) {
        this.lastUsed = lastUsed;
    }

    public String getPassword() {
        if (!rememberPassword || passwordBase64 == null || passwordBase64.isEmpty()) {
            return "";
        }
        try {
            byte[] decoded = Base64.getDecoder().decode(passwordBase64);
            return new String(decoded, StandardCharsets.UTF_8);
        } catch (Exception e) {
            return "";
        }
    }

    public void setPassword(String rawPassword, boolean remember) {
        this.rememberPassword = remember;
        if (remember && rawPassword != null && !rawPassword.isEmpty()) {
            this.passwordBase64 = Base64.getEncoder().encodeToString(rawPassword.getBytes(StandardCharsets.UTF_8));
        } else {
            this.passwordBase64 = "";
        }
    }

    public String getDisplayName() {
        String db = (dbName != null && !dbName.isBlank()) ? dbName : "(sin base)";
        String type = (dbType != null) ? dbType.getDisplayName() : "DB";
        String server = (host != null && !host.isBlank()) ? host : "localhost";
        String p = (port != null && !port.isBlank()) ? ":" + port : "";
        return db + " [" + type + " - " + server + p + "]";
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;
        SavedConnection that = (SavedConnection) o;
        return dbType == that.dbType &&
                Objects.equals(host, that.host) &&
                Objects.equals(port, that.port) &&
                Objects.equals(dbName, that.dbName) &&
                Objects.equals(user, that.user);
    }

    @Override
    public int hashCode() {
        return Objects.hash(dbType, host, port, dbName, user);
    }

    @Override
    public String toString() {
        return getDisplayName();
    }
}
