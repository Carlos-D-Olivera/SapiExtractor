package com.cdog.projects.ui;

import com.cdog.projects.db.ConnectionManager;
import com.cdog.projects.db.StoredProcedure;
import com.cdog.projects.exporter.SpExporterService;
import com.cdog.projects.ui.components.ConnectionButton;
import com.cdog.projects.ui.components.GradientPanel;
import com.cdog.projects.ui.components.IconButton;
import com.cdog.projects.ui.components.RoundSearchField;
import com.cdog.projects.ui.dialogs.ConnectionDialog;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

public class MainFrame extends JFrame {
    private final ConnectionManager connectionManager = new ConnectionManager();
    private List<StoredProcedure> allProcedures = new ArrayList<>();
    
    private ConnectionButton btnConnection;
    private IconButton btnDownload;
    
    private JLabel titleLabel;
    private RoundSearchField searchField;
    private DefaultListModel<StoredProcedure> listModel;
    private JList<StoredProcedure> listProcedures;
    private JScrollPane listScrollPane;
    
    private JTextArea previewArea;
    private JScrollPane previewScrollPane;

    public MainFrame() {
        setTitle("SpExtractor");
        setSize(992, 661);
        setMinimumSize(new Dimension(800, 550));
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        setLocationRelativeTo(null);
        
        setupUI();
        
        SwingUtilities.invokeLater(() -> searchField.requestFocusInWindow());
    }

    private void setupUI() {
        // FlatLaf title bar colors (#0F0F0F / #E3E3E3)
        getRootPane().putClientProperty("JRootPane.titleBarBackground", new Color(15, 15, 15));
        getRootPane().putClientProperty("JRootPane.titleBarForeground", new Color(227, 227, 227));
        
        // Background with radial glow matching Img2
        GradientPanel mainPanel = new GradientPanel();
        mainPanel.setLayout(new BorderLayout());
        setContentPane(mainPanel);

        // --- Top Bar ---
        JPanel topBar = new JPanel(new FlowLayout(FlowLayout.RIGHT, 15, 15));
        topBar.setOpaque(false);
        
        btnDownload = new IconButton(UIManager.getIcon("FileChooser.upFolderIcon"));
        btnDownload.setText("Descargar");
        btnDownload.addActionListener(e -> exportProcedures());
        
        btnConnection = new ConnectionButton();
        btnConnection.addActionListener(e -> showConnectionDialog());
        
        topBar.add(btnDownload);
        topBar.add(btnConnection);
        
        mainPanel.add(topBar, BorderLayout.NORTH);

        // --- Center Content ---
        JPanel centerContainer = new JPanel(new GridBagLayout());
        centerContainer.setOpaque(false);
        
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.gridx = 0;
        gbc.fill = GridBagConstraints.HORIZONTAL;

        // Title: "Sp Extractor" (as shown in Img2)
        titleLabel = new JLabel("Sp Extractor", SwingConstants.CENTER);
        titleLabel.setFont(titleLabel.getFont().deriveFont(Font.BOLD, 36f));
        titleLabel.setForeground(new Color(227, 227, 227));
        gbc.gridy = 0;
        gbc.weightx = 1.0;
        gbc.weighty = 0.0;
        gbc.insets = new Insets(40, 50, 20, 50);
        centerContainer.add(titleLabel, gbc);

        // Search Field (capsule pill, #1E1F20, placeholder "Buscar procedimientos...")
        searchField = new RoundSearchField();
        searchField.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { handleSearch(); }
            public void removeUpdate(DocumentEvent e) { handleSearch(); }
            public void changedUpdate(DocumentEvent e) { handleSearch(); }
        });
        gbc.gridy = 1;
        gbc.weighty = 0.0;
        gbc.insets = new Insets(0, 50, 15, 50);
        centerContainer.add(searchField, gbc);

        // List
        listModel = new DefaultListModel<>();
        listProcedures = new JList<>(listModel);
        listProcedures.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        listProcedures.setFont(listProcedures.getFont().deriveFont(14f));
        listProcedures.setBackground(new Color(30, 31, 32));
        listProcedures.setForeground(new Color(227, 227, 227));
        listProcedures.setSelectionBackground(new Color(0, 74, 119));
        listProcedures.setSelectionForeground(new Color(194, 231, 255));
        listProcedures.setBorder(new EmptyBorder(8, 8, 8, 8));
        
        // Custom cell renderer to display SP names
        listProcedures.setCellRenderer(new DefaultListCellRenderer() {
            @Override
            public Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean isSelected, boolean cellHasFocus) {
                Component c = super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus);
                if (value instanceof StoredProcedure) {
                    setText("  " + ((StoredProcedure) value).getFullName());
                }
                setBorder(new EmptyBorder(6, 12, 6, 12));
                return c;
            }
        });

        listProcedures.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 1) {
                    showPreview(listProcedures.getSelectedValue());
                }
            }
        });

        listScrollPane = new JScrollPane(listProcedures);
        listScrollPane.getViewport().setBackground(new Color(30, 31, 32));
        listScrollPane.setPreferredSize(new Dimension(660, 260));
        listScrollPane.setVisible(false);
        listScrollPane.setBorder(BorderFactory.createLineBorder(new Color(45, 46, 48), 1, true));
        
        gbc.gridy = 2;
        gbc.weighty = 0.5;
        gbc.fill = GridBagConstraints.BOTH;
        gbc.insets = new Insets(0, 50, 20, 50);
        centerContainer.add(listScrollPane, gbc);

        // Preview Area
        previewArea = new JTextArea();
        previewArea.setEditable(false);
        previewArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        previewArea.setBackground(new Color(24, 25, 26));
        previewArea.setForeground(new Color(227, 227, 227));
        previewArea.setCaretColor(new Color(227, 227, 227));
        previewArea.setSelectionColor(new Color(0, 74, 119));
        previewArea.setSelectedTextColor(new Color(194, 231, 255));
        previewArea.setMargin(new Insets(12, 14, 12, 14));
        
        previewScrollPane = new JScrollPane(previewArea);
        previewScrollPane.getViewport().setBackground(new Color(24, 25, 26));
        previewScrollPane.setPreferredSize(new Dimension(660, 320));
        previewScrollPane.setVisible(false);
        previewScrollPane.setBorder(BorderFactory.createLineBorder(new Color(45, 46, 48), 1, true));
        
        gbc.gridy = 3;
        gbc.weighty = 1.0;
        centerContainer.add(previewScrollPane, gbc);

        // Push everything up nicely if there's space left
        JPanel filler = new JPanel();
        filler.setOpaque(false);
        gbc.gridy = 4;
        gbc.weighty = 2.0;
        centerContainer.add(filler, gbc);

        mainPanel.add(centerContainer, BorderLayout.CENTER);
    }

    private void handleSearch() {
        if (!connectionManager.isConnected()) return;
        
        String query = searchField.getText().toLowerCase();
        
        if (query.isEmpty()) {
            listScrollPane.setVisible(false);
            previewScrollPane.setVisible(false);
        } else {
            List<StoredProcedure> filtered = allProcedures.stream()
                .filter(sp -> sp.getFullName().toLowerCase().contains(query))
                .collect(Collectors.toList());
                
            listModel.clear();
            for (StoredProcedure sp : filtered) {
                listModel.addElement(sp);
            }
            
            listScrollPane.setVisible(true);
            previewScrollPane.setVisible(false); // hide preview while typing
        }
        revalidate();
        repaint();
    }

    private void showConnectionDialog() {
        ConnectionDialog dialog = new ConnectionDialog(this, connectionManager);
        dialog.setVisible(true);
        
        if (connectionManager.isConnected()) {
            btnConnection.setConnectedStatus(true, connectionManager.getConnectedDbName());
            loadProcedureNames();
        } else {
            btnConnection.setConnectedStatus(false, "");
            allProcedures.clear();
            listModel.clear();
            listScrollPane.setVisible(false);
            previewScrollPane.setVisible(false);
            revalidate();
            repaint();
        }
    }

    private void loadProcedureNames() {
        try {
            allProcedures = connectionManager.extractProcedureNames();
            handleSearch();
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, "Error cargando lista de procedimientos:\n" + ex.getMessage(), "Error", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void showPreview(StoredProcedure sp) {
        if (sp == null) return;
        
        try {
            if (sp.getDefinition() == null) {
                setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
                connectionManager.fillProcedureDefinition(sp);
                setCursor(Cursor.getDefaultCursor());
            }
            
            previewArea.setText(sp.getDefinition() != null ? sp.getDefinition() : "-- Sin definición disponible");
            previewArea.setCaretPosition(0);
            
            listScrollPane.setVisible(false);
            previewScrollPane.setVisible(true);
            revalidate();
            repaint();
        } catch (Exception ex) {
            setCursor(Cursor.getDefaultCursor());
            JOptionPane.showMessageDialog(this, "Error obteniendo definición:\n" + ex.getMessage(), "Error", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void exportProcedures() {
        if (allProcedures.isEmpty()) {
            JOptionPane.showMessageDialog(this, "No hay procedimientos para descargar. Por favor, conéctate y asegúrate de que existan SPs.", "Advertencia", JOptionPane.WARNING_MESSAGE);
            return;
        }

        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("Seleccionar carpeta de destino");
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        
        if (chooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
            File targetDir = chooser.getSelectedFile();
            
            ProgressMonitor monitor = new ProgressMonitor(this, "Descargando Procedimientos", "", 0, 100);
            monitor.setProgress(0);
            
            SpExporterService service = new SpExporterService(connectionManager, allProcedures, targetDir, status -> {
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
            service.execute();
        }
    }
}
