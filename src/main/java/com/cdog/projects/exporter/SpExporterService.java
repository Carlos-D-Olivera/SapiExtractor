package com.cdog.projects.exporter;

import com.cdog.projects.db.ConnectionManager;
import com.cdog.projects.db.StoredProcedure;

import javax.swing.*;
import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.util.List;
import java.util.function.Consumer;

public class SpExporterService extends SwingWorker<Void, String> {
    private final List<StoredProcedure> procedures;
    private final File targetDirectory;
    private final Consumer<String> statusCallback;
    private final ConnectionManager connectionManager;
    private int currentProgress = 0;

    public SpExporterService(ConnectionManager connectionManager, List<StoredProcedure> procedures, File targetDirectory, Consumer<String> statusCallback) {
        this.connectionManager = connectionManager;
        this.procedures = procedures;
        this.targetDirectory = targetDirectory;
        this.statusCallback = statusCallback;
    }

    @Override
    protected Void doInBackground() throws Exception {
        if (!targetDirectory.exists() && !targetDirectory.mkdirs()) {
            throw new IOException("Could not create target directory.");
        }

        int total = procedures.size();
        for (int i = 0; i < total; i++) {
            if (isCancelled()) {
                break;
            }

            StoredProcedure sp = procedures.get(i);
            
            // Lazy load definition if needed
            if (sp.getDefinition() == null) {
                connectionManager.fillProcedureDefinition(sp);
            }
            
            String safeName = sp.getFullName().replaceAll("[\\\\/:*?\"<>|]", "_");
            File file = new File(targetDirectory, safeName + ".sql");

            try (BufferedWriter writer = new BufferedWriter(new FileWriter(file))) {
                writer.write(sp.getDefinition() != null ? sp.getDefinition() : "-- No definition available");
            }

            currentProgress = (int) (((i + 1) / (double) total) * 100);
            setProgress(currentProgress);
            
            String status = String.format("Exportando: %d/%d - %s", (i + 1), total, sp.getFullName());
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
