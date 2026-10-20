package com.cdog.projects.ui;

import com.cdog.projects.db.ConnectionManager;
import com.cdog.projects.db.DbObject;
import com.cdog.projects.db.DbObjectType;
import com.cdog.projects.exporter.SpExporterService;
import com.cdog.projects.ui.components.ConnectionButton;
import com.cdog.projects.ui.components.GradientPanel;
import com.cdog.projects.ui.components.IconButton;
import com.cdog.projects.ui.components.PillActionButton;
import com.cdog.projects.ui.components.RoundSearchField;
import com.cdog.projects.ui.components.TypeDropdownButton;
import com.cdog.projects.ui.dialogs.ConnectionDialog;

import javax.imageio.ImageIO;
import javax.swing.*;
import javax.swing.border.EmptyBorder;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import java.awt.*;
import java.awt.datatransfer.StringSelection;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.io.File;
import java.io.FileWriter;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public class MainFrame extends JFrame {
    private final ConnectionManager connectionManager = new ConnectionManager();
    private final Map<DbObjectType, List<DbObject>> cachedObjects = new EnumMap<>(DbObjectType.class);
    private DbObjectType currentType = DbObjectType.STORED_PROCEDURE;
    private DbObject currentPreviewObject = null;
    
    private TypeDropdownButton btnTypeDropdown;
    private ConnectionButton btnConnection;
    private IconButton btnDownload;
    
    private JLabel titleLabel;
    private RoundSearchField searchField;
    private DefaultListModel<DbObject> listModel;
    private JList<DbObject> listObjects;
    private JScrollPane listScrollPane;
    
    private JPanel previewContainer;
    private JTextArea previewArea;
    private JScrollPane previewScrollPane;
    private PillActionButton btnRefresh;
    private PillActionButton btnCopy;
    private PillActionButton btnSaveAs;
    private PillActionButton btnOpenInSs;

    public MainFrame() {
        setTitle("SpExtractor");
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        
        loadAppIcon();
        setupUI();
        
        // Use setPreferredSize and setMinimumSize to 610x510
        setPreferredSize(new Dimension(610, 510));
        setMinimumSize(new Dimension(610, 510));
        setSize(new Dimension(610, 510));
        setLocationRelativeTo(null);
        
        SwingUtilities.invokeLater(() -> {
            setSize(new Dimension(610, 510));
            searchField.requestFocusInWindow();
        });
    }

    private void loadAppIcon() {
        try {
            InputStream is = getClass().getResourceAsStream("/icon.png");
            if (is != null) {
                Image img = ImageIO.read(is);
                if (img != null) {
                    setIconImage(img);
                    return;
                }
            }
            File iconPng = new File("src/main/resources/icon.png");
            if (iconPng.exists()) {
                setIconImage(ImageIO.read(iconPng));
                return;
            }
            File iconIco = new File("SpExtractor.ico");
            if (iconIco.exists()) {
                setIconImage(Toolkit.getDefaultToolkit().getImage(iconIco.getAbsolutePath()));
            }
        } catch (Exception ignored) {
        }
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
        JPanel topBar = new JPanel(new BorderLayout());
        topBar.setOpaque(false);

        // Top Left: Type dropdown button
        JPanel topLeftBar = new JPanel(new FlowLayout(FlowLayout.LEFT, 15, 15));
        topLeftBar.setOpaque(false);
        btnTypeDropdown = new TypeDropdownButton();
        btnTypeDropdown.setSelectedType(currentType);
        btnTypeDropdown.setOnTypeSelected(this::handleTypeChanged);
        topLeftBar.add(btnTypeDropdown);
        topBar.add(topLeftBar, BorderLayout.WEST);

        // Top Right: Download all + Connection button
        JPanel topRightBar = new JPanel(new FlowLayout(FlowLayout.RIGHT, 15, 15));
        topRightBar.setOpaque(false);
        
        btnDownload = new IconButton(UIManager.getIcon("FileChooser.upFolderIcon"));
        btnDownload.setText("Descargar todos");
        btnDownload.addActionListener(e -> exportCurrentObjects());
        
        btnConnection = new ConnectionButton();
        btnConnection.addActionListener(e -> showConnectionDialog());
        
        topRightBar.add(btnDownload);
        topRightBar.add(btnConnection);
        topBar.add(topRightBar, BorderLayout.EAST);
        
        mainPanel.add(topBar, BorderLayout.NORTH);

        // --- Center Content ---
        JPanel centerContainer = new JPanel(new GridBagLayout());
        centerContainer.setOpaque(false);
        
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.gridx = 0;
        gbc.fill = GridBagConstraints.HORIZONTAL;

        // Title: "Sp Extractor"
        titleLabel = new JLabel("Sp Extractor", SwingConstants.CENTER);
        titleLabel.setFont(titleLabel.getFont().deriveFont(Font.BOLD, 32f));
        titleLabel.setForeground(new Color(227, 227, 227));
        gbc.gridy = 0;
        gbc.weightx = 1.0;
        gbc.weighty = 0.0;
        gbc.insets = new Insets(10, 30, 10, 30);
        centerContainer.add(titleLabel, gbc);

        // Search Field (capsule pill, #1E1F20)
        searchField = new RoundSearchField();
        searchField.setPlaceholder(currentType.getSearchPlaceholder());
        searchField.getDocument().addDocumentListener(new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { handleSearch(); }
            public void removeUpdate(DocumentEvent e) { handleSearch(); }
            public void changedUpdate(DocumentEvent e) { handleSearch(); }
        });
        searchField.addActionListener(e -> {
            if (listObjects.getSelectedValue() != null) {
                showPreview(listObjects.getSelectedValue());
            } else if (listModel.getSize() > 0) {
                showPreview(listModel.getElementAt(0));
            }
        });
        searchField.addFocusListener(new java.awt.event.FocusAdapter() {
            @Override
            public void focusGained(java.awt.event.FocusEvent e) {
                if (!searchField.getText().trim().isEmpty() && !listScrollPane.isVisible()) {
                    handleSearch();
                }
            }
        });
        gbc.gridy = 1;
        gbc.weighty = 0.0;
        gbc.insets = new Insets(0, 30, 10, 30);
        centerContainer.add(searchField, gbc);

        // List
        listModel = new DefaultListModel<>();
        listObjects = new JList<>(listModel);
        listObjects.setSelectionMode(ListSelectionModel.SINGLE_SELECTION);
        listObjects.setFont(listObjects.getFont().deriveFont(14f));
        listObjects.setBackground(new Color(30, 31, 32));
        listObjects.setForeground(new Color(227, 227, 227));
        listObjects.setSelectionBackground(new Color(0, 74, 119));
        listObjects.setSelectionForeground(new Color(194, 231, 255));
        listObjects.setBorder(new EmptyBorder(8, 8, 8, 8));
        
        // Custom cell renderer to display object full names
        listObjects.setCellRenderer(new DefaultListCellRenderer() {
            @Override
            public Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean isSelected, boolean cellHasFocus) {
                Component c = super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus);
                if (value instanceof DbObject obj) {
                    setText("  " + obj.getFullName());
                }
                setBorder(new EmptyBorder(6, 12, 6, 12));
                return c;
            }
        });

        listObjects.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 1) {
                    showPreview(listObjects.getSelectedValue());
                }
            }
        });
        listObjects.addKeyListener(new java.awt.event.KeyAdapter() {
            @Override
            public void keyPressed(java.awt.event.KeyEvent e) {
                if (e.getKeyCode() == java.awt.event.KeyEvent.VK_ENTER) {
                    showPreview(listObjects.getSelectedValue());
                }
            }
        });

        listScrollPane = new JScrollPane(listObjects);
        listScrollPane.getViewport().setBackground(new Color(30, 31, 32));
        listScrollPane.setPreferredSize(new Dimension(0, 180));
        listScrollPane.setVisible(false);
        listScrollPane.setBorder(BorderFactory.createLineBorder(new Color(45, 46, 48), 1, true));
        
        gbc.gridy = 2;
        gbc.weighty = 0.5;
        gbc.fill = GridBagConstraints.BOTH;
        gbc.insets = new Insets(0, 30, 15, 30);
        centerContainer.add(listScrollPane, gbc);

        // --- Preview Container (Toolbar + Preview Text Area) ---
        previewContainer = new JPanel(new BorderLayout(0, 8));
        previewContainer.setOpaque(false);
        previewContainer.setVisible(false);

        // Preview Toolbar
        JPanel previewToolbar = new JPanel(new FlowLayout(FlowLayout.RIGHT, 6, 0));
        previewToolbar.setOpaque(false);

        btnRefresh = new PillActionButton("Recargar");
        btnRefresh.setToolTipText("Volver a consultar en la base de datos (F5)");
        btnRefresh.addActionListener(e -> {
            if (currentPreviewObject != null) {
                showPreview(currentPreviewObject);
            }
        });

        btnCopy = new PillActionButton(currentType.getCopyButtonText());
        btnCopy.setToolTipText("Copiar definición al portapapeles");
        btnCopy.addActionListener(e -> copyCurrentObject());

        btnSaveAs = new PillActionButton("Guardar como");
        btnSaveAs.setToolTipText("Guardar como archivo .sql");
        btnSaveAs.addActionListener(e -> saveCurrentObjectAs());

        btnOpenInSs = new PillActionButton("Abrir en SQL Server");
        btnOpenInSs.setToolTipText("Abrir archivo SQL en SQL Server / Editor predeterminado");
        btnOpenInSs.addActionListener(e -> openCurrentObjectInSqlServer());

        previewToolbar.add(btnRefresh);
        previewToolbar.add(btnCopy);
        previewToolbar.add(btnSaveAs);
        previewToolbar.add(btnOpenInSs);

        // Keyboard shortcuts: F5 to reload current object, Escape to return to list
        getRootPane().registerKeyboardAction(
            e -> {
                if (previewContainer.isVisible() && currentPreviewObject != null) {
                    showPreview(currentPreviewObject);
                }
            },
            KeyStroke.getKeyStroke(java.awt.event.KeyEvent.VK_F5, 0),
            JComponent.WHEN_IN_FOCUSED_WINDOW
        );

        getRootPane().registerKeyboardAction(
            e -> {
                if (previewContainer.isVisible() && !searchField.getText().trim().isEmpty()) {
                    previewContainer.setVisible(false);
                    listScrollPane.setVisible(true);
                    searchField.requestFocusInWindow();
                }
            },
            KeyStroke.getKeyStroke(java.awt.event.KeyEvent.VK_ESCAPE, 0),
            JComponent.WHEN_IN_FOCUSED_WINDOW
        );

        previewContainer.add(previewToolbar, BorderLayout.NORTH);

        // Preview Text Area
        previewArea = new JTextArea();
        previewArea.setEditable(false);
        previewArea.setFont(new Font(Font.MONOSPACED, Font.PLAIN, 13));
        previewArea.setBackground(new Color(24, 25, 26));
        previewArea.setForeground(new Color(227, 227, 227));
        previewArea.setCaretColor(new Color(227, 227, 227));
        previewArea.setSelectionColor(new Color(0, 74, 119));
        previewArea.setSelectedTextColor(new Color(194, 231, 255));
        previewArea.setMargin(new Insets(14, 16, 14, 16));
        
        previewScrollPane = new JScrollPane(previewArea);
        previewScrollPane.getViewport().setBackground(new Color(24, 25, 26));
        previewScrollPane.setPreferredSize(new Dimension(0, 220));
        previewScrollPane.setBorder(BorderFactory.createLineBorder(new Color(45, 46, 48), 1, true));
        
        previewContainer.add(previewScrollPane, BorderLayout.CENTER);

        gbc.gridy = 3;
        gbc.weighty = 1.0;
        gbc.fill = GridBagConstraints.BOTH;
        gbc.insets = new Insets(0, 30, 20, 30);
        centerContainer.add(previewContainer, gbc);

        // Fill remaining space
        JPanel filler = new JPanel();
        filler.setOpaque(false);
        gbc.gridy = 4;
        gbc.weighty = 0.01;
        centerContainer.add(filler, gbc);

        mainPanel.add(centerContainer, BorderLayout.CENTER);
    }

    private void handleTypeChanged(DbObjectType newType) {
        this.currentType = newType;
        searchField.setPlaceholder(newType.getSearchPlaceholder());
        btnCopy.setText(newType.getCopyButtonText());
        previewContainer.setVisible(false);

        if (connectionManager.isConnected()) {
            ensureObjectsLoadedForType(newType);
            handleSearch();
        } else {
            listModel.clear();
            listScrollPane.setVisible(false);
        }
    }

    private void ensureObjectsLoadedForType(DbObjectType type) {
        if (!cachedObjects.containsKey(type)) {
            try {
                setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
                List<DbObject> objects = connectionManager.extractObjects(type);
                cachedObjects.put(type, objects);
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(this, 
                    "Error cargando lista de " + type.getDisplayName() + ":\n" + ex.getMessage(), 
                    "Error", 
                    JOptionPane.ERROR_MESSAGE);
            } finally {
                setCursor(Cursor.getDefaultCursor());
            }
        }
    }

    private void handleSearch() {
        if (!connectionManager.isConnected()) return;
        
        String query = searchField.getText().trim().toLowerCase();
        
        if (query.isEmpty()) {
            listScrollPane.setVisible(false);
            previewContainer.setVisible(false);
        } else {
            ensureObjectsLoadedForType(currentType);
            List<DbObject> currentList = cachedObjects.getOrDefault(currentType, List.of());
            
            List<DbObject> filtered = currentList.stream()
                .filter(obj -> obj.getFullName().toLowerCase().contains(query))
                .collect(Collectors.toList());
                
            listModel.clear();
            for (DbObject obj : filtered) {
                listModel.addElement(obj);
            }
            
            listScrollPane.setVisible(true);
            previewContainer.setVisible(false); // hide preview while typing
        }
        revalidate();
        repaint();
    }

    private void showConnectionDialog() {
        ConnectionDialog dialog = new ConnectionDialog(this, connectionManager);
        dialog.setVisible(true);
        
        if (connectionManager.isConnected()) {
            btnConnection.setConnectedStatus(true, connectionManager.getConnectedDbName());
            cachedObjects.clear();
            ensureObjectsLoadedForType(currentType);
            handleSearch();
        } else {
            btnConnection.setConnectedStatus(false, "");
            cachedObjects.clear();
            listModel.clear();
            listScrollPane.setVisible(false);
            previewContainer.setVisible(false);
            revalidate();
            repaint();
        }
    }

    private void showPreview(DbObject obj) {
        if (obj == null) return;
        currentPreviewObject = obj;
        
        try {
            setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
            try {
                connectionManager.fillDefinition(obj, true);
            } finally {
                setCursor(Cursor.getDefaultCursor());
            }
            
            previewArea.setText(obj.getDefinition() != null ? obj.getDefinition() : "-- Sin definición disponible");
            previewArea.setCaretPosition(0);
            
            listScrollPane.setVisible(false);
            previewContainer.setVisible(true);
            revalidate();
            repaint();
        } catch (Exception ex) {
            setCursor(Cursor.getDefaultCursor());
            JOptionPane.showMessageDialog(this, "Error obteniendo definición:\n" + ex.getMessage(), "Error", JOptionPane.ERROR_MESSAGE);
        }
    }

    private String getObjectTextWithHeader(String originalText) {
        if (currentPreviewObject == null) return originalText;

        // Para columnas, el script ya contiene las validaciones completas IF NOT EXISTS ADD y IF EXISTS ALTER
        if (currentPreviewObject.getType() == DbObjectType.COLUMN) {
            return originalText;
        }

        String fullName = currentPreviewObject.getSchema().isEmpty() 
            ? String.format("[%s]", currentPreviewObject.getName()) 
            : String.format("[%s].[%s]", currentPreviewObject.getSchema(), currentPreviewObject.getName());

        String header = switch (currentPreviewObject.getType()) {
            case STORED_PROCEDURE -> String.format(
                "IF EXISTS (SELECT * FROM dbo.sysobjects WHERE id = OBJECT_ID(N'%s') AND OBJECTPROPERTY(id, N'IsProcedure') = 1)\n" +
                "BEGIN\n" +
                "    DROP PROCEDURE %s \n" +
                "END\n" +
                "GO\n\n", fullName, fullName);
            case TABLE -> String.format(
                "IF EXISTS (SELECT * FROM dbo.sysobjects WHERE id = OBJECT_ID(N'%s') AND OBJECTPROPERTY(id, N'IsUserTable') = 1)\n" +
                "BEGIN\n" +
                "    DROP TABLE %s \n" +
                "END\n" +
                "GO\n\n", fullName, fullName);
            case VIEW -> String.format(
                "IF EXISTS (SELECT * FROM dbo.sysobjects WHERE id = OBJECT_ID(N'%s') AND OBJECTPROPERTY(id, N'IsView') = 1)\n" +
                "BEGIN\n" +
                "    DROP VIEW %s \n" +
                "END\n" +
                "GO\n\n", fullName, fullName);
            case FUNCTION -> String.format(
                "IF EXISTS (SELECT * FROM dbo.sysobjects WHERE id = OBJECT_ID(N'%s') AND (OBJECTPROPERTY(id, N'IsScalarFunction') = 1 OR OBJECTPROPERTY(id, N'IsTableFunction') = 1))\n" +
                "BEGIN\n" +
                "    DROP FUNCTION %s \n" +
                "END\n" +
                "GO\n\n", fullName, fullName);
            case TRIGGER -> String.format(
                "IF EXISTS (SELECT * FROM dbo.sysobjects WHERE id = OBJECT_ID(N'%s') AND OBJECTPROPERTY(id, N'IsTrigger') = 1)\n" +
                "BEGIN\n" +
                "    DROP TRIGGER %s \n" +
                "END\n" +
                "GO\n\n", fullName, fullName);
            default -> "";
        };

        return header + originalText;
    }

    private void copyCurrentObject() {
        String content = previewArea.getText();
        if (content == null || content.isEmpty()) return;

        content = getObjectTextWithHeader(content);

        Toolkit.getDefaultToolkit().getSystemClipboard().setContents(new StringSelection(content), null);
        
        btnCopy.setText("\u2713 Copiado");
        Timer timer = new Timer(1500, e -> btnCopy.setText(currentType.getCopyButtonText()));
        timer.setRepeats(false);
        timer.start();
    }

    private void saveCurrentObjectAs() {
        if (currentPreviewObject == null) return;

        String dateStr = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
        String namePart;
        if (currentPreviewObject.getType() == DbObjectType.COLUMN) {
            namePart = String.format("%s.%s_%s", currentPreviewObject.getSchema(), currentPreviewObject.getParentName(), currentPreviewObject.getName());
        } else {
            namePart = String.format("%s.%s", currentPreviewObject.getSchema(), currentPreviewObject.getName());
        }

        String defaultFileName = String.format("%s_%s_%s.sql", dateStr, currentPreviewObject.getType().getFilePrefix(), namePart);

        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("Guardar como");
        chooser.setSelectedFile(new File(defaultFileName));

        if (chooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
            File targetFile = chooser.getSelectedFile();
            if (!targetFile.getName().toLowerCase().endsWith(".sql")) {
                targetFile = new File(targetFile.getParentFile(), targetFile.getName() + ".sql");
            }

            try (FileWriter writer = new FileWriter(targetFile, StandardCharsets.UTF_8)) {
                writer.write(getObjectTextWithHeader(previewArea.getText()));
                JOptionPane.showMessageDialog(this, "Guardado exitosamente:\n" + targetFile.getAbsolutePath(), "Archivo guardado", JOptionPane.INFORMATION_MESSAGE);
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(this, "Error al guardar el archivo:\n" + ex.getMessage(), "Error", JOptionPane.ERROR_MESSAGE);
            }
        }
    }

    private void openCurrentObjectInSqlServer() {
        if (currentPreviewObject == null) return;

        try {
            setCursor(Cursor.getPredefinedCursor(Cursor.WAIT_CURSOR));
            try {
                connectionManager.fillDefinition(currentPreviewObject, true);
            } finally {
                setCursor(Cursor.getDefaultCursor());
            }
            previewArea.setText(currentPreviewObject.getDefinition() != null ? currentPreviewObject.getDefinition() : "-- Sin definición disponible");
            previewArea.setCaretPosition(0);

            String dateStr = LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"));
            String namePart;
            if (currentPreviewObject.getType() == DbObjectType.COLUMN) {
                namePart = String.format("%s.%s_%s", currentPreviewObject.getSchema(), currentPreviewObject.getParentName(), currentPreviewObject.getName());
            } else {
                namePart = String.format("%s.%s", currentPreviewObject.getSchema(), currentPreviewObject.getName());
            }

            String prefix = String.format("%s_%s_%s_", dateStr, currentPreviewObject.getType().getFilePrefix(), namePart);
            
            // Clean invalid filename chars for prefix
            prefix = prefix.replaceAll("[^a-zA-Z0-9_.-]", "_");
            if (prefix.length() < 3) prefix = "obj_temp_";

            File tempFile = File.createTempFile(prefix, ".sql");
            tempFile.deleteOnExit();

            try (FileWriter writer = new FileWriter(tempFile, StandardCharsets.UTF_8)) {
                writer.write(getObjectTextWithHeader(previewArea.getText()));
            }

            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
                Desktop.getDesktop().open(tempFile);
            } else {
                new ProcessBuilder("cmd", "/c", "start", "", tempFile.getAbsolutePath()).start();
            }
        } catch (Exception ex) {
            setCursor(Cursor.getDefaultCursor());
            JOptionPane.showMessageDialog(this, "No se pudo abrir el archivo en el editor SQL:\n" + ex.getMessage(), "Error al abrir", JOptionPane.ERROR_MESSAGE);
        }
    }

    private void exportCurrentObjects() {
        List<DbObject> currentList = cachedObjects.get(currentType);
        if (currentList == null || currentList.isEmpty()) {
            JOptionPane.showMessageDialog(this, 
                "No hay elementos de tipo " + currentType.getDisplayName() + " para descargar. Por favor, conéctate y asegúrate de que existan registros.", 
                "Advertencia", 
                JOptionPane.WARNING_MESSAGE);
            return;
        }

        JFileChooser chooser = new JFileChooser();
        chooser.setDialogTitle("Seleccionar carpeta de destino");
        chooser.setFileSelectionMode(JFileChooser.DIRECTORIES_ONLY);
        
        if (chooser.showSaveDialog(this) == JFileChooser.APPROVE_OPTION) {
            File targetFile = chooser.getSelectedFile();
            
            ProgressMonitor monitor = new ProgressMonitor(this, "Descargando " + currentType.getDisplayName(), "", 0, 100);
            monitor.setProgress(0);
            
            SpExporterService service = new SpExporterService(connectionManager, currentList, targetFile, status -> {
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
                        JOptionPane.showMessageDialog(MainFrame.this, "¡Descarga completada con éxito en:\n" + targetFile.getAbsolutePath());
                    }
                }
            };
            service.execute();
        }
    }
}
