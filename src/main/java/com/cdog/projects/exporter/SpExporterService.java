package com.cdog.projects.exporter;

import com.cdog.projects.db.ConnectionManager;
import com.cdog.projects.db.DbObject;

import javax.swing.*;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.function.Consumer;

public class SpExporterService extends SwingWorker<Void, String> {
    private final List<? extends DbObject> objects;
    private final File targetDirectory;
    private final Consumer<String> statusCallback;
    private final ConnectionManager connectionManager;
    private int currentProgress = 0;

    public SpExporterService(ConnectionManager connectionManager, List<? extends DbObject> objects, File targetDirectory, Consumer<String> statusCallback) {
        this.connectionManager = connectionManager;
        this.objects = objects;
        this.targetDirectory = targetDirectory;
        this.statusCallback = statusCallback;
    }

    @Override
    protected Void doInBackground() throws Exception {
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            throw new IOException("Could not create target directory.");
        }

        int total = objects.size();
        for (int i = 0; i < total; i++) {
            if (isCancelled()) {
                break;
            }

            DbObject obj = objects.get(i);
            
            // Lazy load definition if needed
            if (obj.getDefinition() == null) {
                connectionManager.fillDefinition(obj);
            }
            
            String safeName = obj.getFullName().replaceAll("[\\\\/:*?\"<>|]", "_");
            File file = new File(targetDirectory, safeName + ".sql");

            try (BufferedWriter writer = new BufferedWriter(new FileWriter(file))) {
                writer.write(obj.getDefinition() != null ? obj.getDefinition() : "-- No definition available");
            }

            currentProgress = (int) (((i + 1) / (double) total) * 100);
            setProgress(currentProgress);
            
            String status = String.format("Exportando: %d/%d - %s", (i + 1), total, obj.getFullName());
            publish(status);
        }
        return null;
    }

    @Override
    protected void process(List<String> chunks) {
        if (!chunks.isEmpty()) {
            statusCallback.accept(chunks.get(chunks.size() - 1));
        }
    }
}
