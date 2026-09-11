package com.cdog.projects.ui;

import com.cdog.projects.db.ConnectionManager;
import com.cdog.projects.db.StoredProcedure;
import com.cdog.projects.exporter.SpExporterService;
import com.cdog.projects.ui.components.GradientPanel;
import com.cdog.projects.ui.components.IconButton;
import com.cdog.projects.ui.components.RoundSearchField;
import com.cdog.projects.ui.dialogs.ConnectionDialog;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.*;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

public class MainFrame extends JFrame {
    private final ConnectionManager connectionManager = new ConnectionManager();
    private List<StoredProcedure> allProcedures = new ArrayList<>();
    
    private JLabel lblStatus;
    private RoundSearchField searchField;
    private DefaultListModel<String> listModel;
    private JList<String> listProcedures;
    private JLabel lblCount;
    private JTextArea previewArea;

    public MainFrame() {
        setTitle("SpExtractor - Database Stored Procedure Downloader");
        setSize(900, 600);
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setLocationRelativeTo(null);
        
        setupUI();
        
        // Ensure autofocus on search field
        SwingUtilities.invokeLater(() -> searchField.requestFocusInWindow());
    }

    private void setupUI() {
        setLayout(new BorderLayout());
        
        // 1. Header (Gradient Panel)
        GradientPanel headerPanel = new GradientPanel(new Color(15, 23, 42), new Color(30, 41, 59), 0);
        headerPanel.setLayout(new BorderLayout());
        headerPanel.setBorder(new EmptyBorder(10, 20, 10, 20));
        headerPanel.setPreferredSize(new Dimension(0, 60));

        // Header Left: Status and Connect Button
        JPanel headerLeft = new JPanel(new FlowLayout(FlowLayout.LEFT, 10, 5));
        headerLeft.setOpaque(false);
        
        lblStatus = new JLabel("🔴 Desconectado");
        lblStatus.setForeground(Color.LIGHT_GRAY);
        lblStatus.setFont(lblStatus.getFont().deriveFont(Font.BOLD));
        
        JButton btnConnect = new JButton("Conectar BD");
        btnConnect.putClientProperty("JButton.buttonType", "roundRect");
        btnConnect.addActionListener(e -> showConnectionDialog());
        
        headerLeft.add(lblStatus);
        headerLeft.add(btnConnect);
        
        // Header Right: Download Button
        JPanel headerRight = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 5));
        headerRight.setOpaque(false);
        
        IconButton btnDownload = new IconButton(UIManager.getIcon("FileChooser.upFolderIcon")); 
        btnDownload.setText("Descargar Todos");
        btnDownload.setForeground(Color.WHITE);
        btnDownload.addActionListener(e -> exportProcedures());
        
        headerRight.add(btnDownload);
        
        headerPanel.add(headerLeft, BorderLayout.WEST);
        headerPanel.add(headerRight, BorderLayout.EAST);
        
        add(headerPanel, BorderLayout.NORTH);

        // 2. Main Content SplitPane
        JSplitPane splitPane = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT);
        splitPane.setDividerLocation(300);
        splitPane.setBorder(null);

        // Left Panel (Search & List)
        JPanel leftPanel = new JPanel(new BorderLayout(5, 5));
        leftPanel.setBorder(new EmptyBorder(10, 10, 10, 10));
        
        searchField = new RoundSearchField();
        searchField.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { filterList(); }
            public void removeUpdate(DocumentEvent e) { filterList(); }
            public void changedUpdate(DocumentEvent e) { filterList(); }
        });
        
        listModel = new DefaultListModel<>();
        listProcedures = new JList<>(listModel);
        listProcedures.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        listProcedures.addListSelectionListener(e -> showPreview(listProcedures.getSelectedValue()));
        
        JScrollPane scrollList = new JScrollPane(listProcedures);
        scrollList.setBorder(BorderFactory.createLineBorder(new Color(60, 63, 65)));
        
        lblCount = new JLabel("Mostrando 0 de 0 procedimientos");
        lblCount.setFont(lblCount.getFont().deriveFont(10f));
        lblCount.setForeground(Color.GRAY);
        
        leftPanel.add(searchField, BorderLayout.NORTH);
        leftPanel.add(scrollList, BorderLayout.CENTER);
        leftPanel.add(lblCount, BorderLayout.SOUTH);
        
        // Right Panel (Preview)
        JPanel rightPanel = new JPanel(new BorderLayout());
        rightPanel.setBorder(new EmptyBorder(10, 10, 10, 10));
        
        JLabel lblPreviewTitle = new JLabel("Vista Previa (Código SQL)");
        lblPreviewTitle.setFont(lblPreviewTitle.getFont().deriveFont(Font.BOLD));
        lblPreviewTitle.setBorder(new EmptyBorder(0, 0, 5, 0));
        
        previewArea = new JTextArea();
        previewArea.setEditable(false);
        previewArea.setFont(new Font("Monospaced", Font.PLAIN, 12));
        previewArea.setMargin(new Insets(5, 5, 5, 5));
        JScrollPane scrollPreview = new JScrollPane(previewArea);
        scrollPreview.setBorder(BorderFactory.createLineBorder(new Color(60, 63, 65)));
        
        rightPanel.add(lblPreviewTitle, BorderLayout.NORTH);
        rightPanel.add(scrollPreview, BorderLayout.CENTER);
        
        splitPane.setLeftComponent(leftPanel);
        splitPane.setRightComponent(rightPanel);
        
        add(splitPane, BorderLayout.CENTER);
    }

    private void showConnectionDialog() {
        ConnectionDialog dialog = new ConnectionDialog(this, connectionManager);
        dialog.setVisible(true);
        
        if (dialog.isConnected()) {
            lblStatus.setText("🟢 Conectado");
            lblStatus.setForeground(new Color(110, 203, 131)); // Pastel green
            loadProcedures();
        } else {
            lblStatus.setText("🔴 Desconectado");
            lblStatus.setForeground(Color.LIGHT_GRAY);
            allProcedures.clear();
            updateList(allProcedures);
        }
    }

    private void loadProcedures() {
        try {
            allProcedures = connectionManager.extractProcedures();
            updateList(allProcedures);
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "Error cargando procedimientos:\n" + ex.getMessage(), "Error", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void updateList(List<StoredProcedure> procedures) {
        listModel.clear();
        for (StoredProcedure sp : procedures) {
            listModel.addElement(sp.getFullName());
        }
        lblCount.setText(String.format("Mostrando %d de %d procedimientos", procedures.size(), allProcedures.size()));
        
        if (!procedures.isEmpty()) {
            listProcedures.setSelectedIndex(0);
        } else {
            previewArea.setText("");
        }
    }

    private void filterList() {
        String sf = searchField.getText().toLowerCase();
        if (sf.isEmpty()) {
            updateList(allProcedures);
            return;
        }
        
        List<StoredProcedure> filtered = allProcedures.stream()
            .filter(sp -> sp.getFullName().toLowerCase().contains(sf))
            .collect(Collectors.toList());
            
        updateList(filtered);
    }

    private void showPreview(String fullName) {
        if (fullName == null) return;
        
        allProcedures.stream()
            .filter(sp -> sp.getFullName().equals(fullName))
            .findFirst()
            .ifPresent(sp -> {
                previewArea.setText(sp.getDefinition() != null ? sp.getDefinition() : "-- Sin definición obtenida");
                previewArea.setCaretPosition(0);
            });
    }

    private void exportProcedures() {
        if (allProcedures.isEmpty()) {
            JOptionPane.showMessageDialog(this, "No hay procedimientos para descargar.", "Advertencia", JOptionPane.WARNING_MESSAGE);
            return;
        }

        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("Seleccionar carpeta de destino");
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        
        if (chooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
            File targetDir = chooser.getSelectedFile();
            
            ProgressMonitor monitor = new ProgressMonitor(this, "Descargando Procedimientos", "", 0, 100);
            monitor.setProgress(0);
            
            SpExporterService service = new SpExporterService(allProcedures, targetDir, status -> {
                SwingUtilities.invokeLater(() -> monitor.setNote(status));
            }) {
                @Override
                protected void process(List<String> chunks) {
                    super.process(chunks);
                    if (!chunks.isEmpty()) {
                        monitor.setProgress(getProgress());
                    }
                }

                @Override
                protected void done() {
                    monitor.close();
                    if (!isCancelled()) {
                        JOptionPane.showMessageDialog(MainFrame.this, "¡Descarga completada con éxito en:\n" + targetDir.getAbsolutePath());
                    }
                }
            };
            
            // Check cancellation in a background timer thread just in case
            Thread monitorThread = new Thread(() -> {
                while (!service.isDone()) {
                    if (monitor.isCanceled()) {
                        service.cancel(true);
                        break;
                    }
                    try { Thread.sleep(100); } catch (Exception ignored) {}
                }
            });
            monitorThread.start();
            
            service.execute();
        }
    }
}
