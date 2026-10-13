package com.cdog.projects.config;

import com.cdog.projects.db.DatabaseType;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class ConnectionHistoryManager {
    private static final String CONFIG_DIR = System.getProperty("user.home") + File.separator + ".spextractor";
    private static final String CONFIG_FILE = CONFIG_DIR + File.separator + "connections.json";
    private static final int MAX_RECENT = 15;

    public static List<SavedConnection> loadConnections() {
        List<SavedConnection> list = new ArrayList<>();
        Path path = Paths.get(CONFIG_FILE);
        if (!Files.exists(path)) {
            return list;
        }

        try {
            String json = Files.readString(path, StandardCharsets.UTF_8);
            list = parseJson(json);
            list.sort((a, b) -> Long.compare(b.getLastUsed(), a.getLastUsed()));
        } catch (Exception e) {
            System.err.println("Error al cargar conexiones recientes: " + e.getMessage());
        }

        return list;
    }

    public static void saveConnection(SavedConnection conn) {
        if (conn == null) return;
        List<SavedConnection> list = loadConnections();

        // Remove if duplicate exists (matches dbType, host, port, dbName, user)
        list.removeIf(existing -> existing.equals(conn));

        // Update timestamp and insert at top
        conn.setLastUsed(System.currentTimeMillis());
        list.add(0, conn);

        // Cap to MAX_RECENT
        if (list.size() > MAX_RECENT) {
            list = new ArrayList<>(list.subList(0, MAX_RECENT));
        }

        persist(list);
    }

    public static void deleteConnection(SavedConnection conn) {
        if (conn == null) return;
        List<SavedConnection> list = loadConnections();
        list.removeIf(existing -> existing.equals(conn));
        persist(list);
    }

    private static void persist(List<SavedConnection> list) {
        try {
            Path dir = Paths.get(CONFIG_DIR);
            if (!Files.exists(dir)) {
                Files.createDirectories(dir);
            }

            String json = toJson(list);
            Files.writeString(Paths.get(CONFIG_FILE), json, StandardCharsets.UTF_8);
        } catch (IOException e) {
            System.err.println("Error al guardar conexiones recientes: " + e.getMessage());
        }
    }

    private static String toJson(List<SavedConnection> list) {
        StringBuilder sb = new StringBuilder();
        sb.append("[\n");
        for (int i = 0; i < list.size(); i++) {
            SavedConnection c = list.get(i);
            sb.append("  {\n");
            sb.append("    \"dbType\": \"").append(escape(c.getDbType() != null ? c.getDbType().name() : "")).append("\",\n");
            sb.append("    \"host\": \"").append(escape(c.getHost())).append("\",\n");
            sb.append("    \"port\": \"").append(escape(c.getPort())).append("\",\n");
            sb.append("    \"dbName\": \"").append(escape(c.getDbName())).append("\",\n");
            sb.append("    \"user\": \"").append(escape(c.getUser())).append("\",\n");
            sb.append("    \"passwordBase64\": \"").append(escape(c.getPasswordBase64())).append("\",\n");
            sb.append("    \"rememberPassword\": ").append(c.isRememberPassword()).append(",\n");
            sb.append("    \"lastUsed\": ").append(c.getLastUsed()).append("\n");
            sb.append("  }");
            if (i < list.size() - 1) {
                sb.append(",");
            }
            sb.append("\n");
        }
        sb.append("]\n");
        return sb.toString();
    }

    private static List<SavedConnection> parseJson(String json) {
        List<SavedConnection> result = new ArrayList<>();
        if (json == null || json.isBlank()) return result;

        // Extract each JSON object inside { ... }
        Pattern objPattern = Pattern.compile("\\{([^{}]+)\\}");
        Matcher matcher = objPattern.matcher(json);

        while (matcher.find()) {
            String block = matcher.group(1);
            SavedConnection conn = new SavedConnection();

            String dbTypeStr = extractString(block, "dbType");
            if (dbTypeStr != null && !dbTypeStr.isEmpty()) {
                try {
                    conn.setDbType(DatabaseType.valueOf(dbTypeStr));
                } catch (IllegalArgumentException ignored) {}
            }

            conn.setHost(extractString(block, "host"));
            conn.setPort(extractString(block, "port"));
            conn.setDbName(extractString(block, "dbName"));
            conn.setUser(extractString(block, "user"));
            conn.setPasswordBase64(extractString(block, "passwordBase64"));
            conn.setRememberPassword(extractBoolean(block, "rememberPassword"));
            conn.setLastUsed(extractLong(block, "lastUsed"));

            result.add(conn);
        }

        return result;
    }

    private static String extractString(String block, String key) {
        Pattern p = Pattern.compile("\"" + key + "\"\\s*:\\s*\"([^\"]*)\"");
        Matcher m = p.matcher(block);
        if (m.find()) {
            return unescape(m.group(1));
        }
        return "";
    }

    private static boolean extractBoolean(String block, String key) {
        Pattern p = Pattern.compile("\"" + key + "\"\\s*:\\s*(true|false)", Pattern.CASE_INSENSITIVE);
        Matcher m = p.matcher(block);
        if (m.find()) {
            return Boolean.parseBoolean(m.group(1));
        }
        return false;
    }

    private static long extractLong(String block, String key) {
        Pattern p = Pattern.compile("\"" + key + "\"\\s*:\\s*(\\d+)");
        Matcher m = p.matcher(block);
        if (m.find()) {
            try {
                return Long.parseLong(m.group(1));
            } catch (NumberFormatException ignored) {}
        }
        return 0L;
    }

    private static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "\\r");
    }

    private static String unescape(String s) {
        if (s == null) return "";
        return s.replace("\\n", "\n").replace("\\r", "\r").replace("\\\"", "\"").replace("\\\\", "\\");
    }
}
