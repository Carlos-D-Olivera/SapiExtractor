package com.cdog.projects.ui.dialogs;

import com.cdog.projects.config.ConnectionHistoryManager;
import com.cdog.projects.config.SavedConnection;
import com.cdog.projects.db.DatabaseType;
import com.cdog.projects.db.ConnectionManager;
import com.formdev.flatlaf.extras.components.FlatTextField;
import com.formdev.flatlaf.extras.components.FlatPasswordField;

import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;
import javax.swing.event.PopupMenuEvent;
import javax.swing.event.PopupMenuListener;
import java.awt.*;
import java.awt.event.ActionEvent;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.List;

public class ConnectionDialog extends JDialog {
    private JComboBox<SavedConnection> cbRecentConnections;
    private JButton btnDeleteRecent;

    private JComboBox<DatabaseType> cbDbType;
    private FlatTextField txtHost;
    private FlatTextField txtPort;
    private FlatTextField txtUser;
    private FlatPasswordField txtPassword;
    private JCheckBox chkRememberPassword;
    
    private JComboBox<String> cbDbName;
    
    private boolean connected = false;
    private boolean isUpdatingFields = false;
    private boolean isFetchingDbs = false;
    private boolean dbsLoadedForCurrentConfig = false;
    private final ConnectionManager connectionManager;

    public ConnectionDialog(Frame parent, ConnectionManager connectionManager) {
        super(parent, "Conectar a Base de Datos", true);
        this.connectionManager = connectionManager;
        
        setupUI();
        loadRecentConnections();
        pack();
        setLocationRelativeTo(parent);
    }
    
    private void setupUI() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBackground(new Color(24, 25, 26));
        panel.setBorder(BorderFactory.createEmptyBorder(20, 24, 20, 24));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(6, 6, 6, 6);
        gbc.fill = GridBagConstraints.HORIZONTAL;
        
        int row = 0;

        // 0. Conexiones Recientes
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblRecent = new JLabel("Recientes:");
        lblRecent.setForeground(new Color(227, 227, 227));
        lblRecent.setFont(lblRecent.getFont().deriveFont(Font.BOLD));
        panel.add(lblRecent, gbc);

        JPanel recentContainer = new JPanel(new BorderLayout(6, 0));
        recentContainer.setOpaque(false);

        cbRecentConnections = new JComboBox<>();
        cbRecentConnections.setRenderer(new DefaultListCellRenderer() {
            @Override
            public Component getListCellRendererComponent(JList<?> list, Object value, int index, boolean isSelected, boolean cellHasFocus) {
                Component c = super.getListCellRendererComponent(list, value, index, isSelected, cellHasFocus);
                if (value == null) {
                    setText("Nueva conexión");
                    setForeground(new Color(194, 231, 255));
                } else if (value instanceof SavedConnection sc) {
                    setText(sc.getDisplayName());
                }
                return c;
            }
        });
        cbRecentConnections.addActionListener(e -> onRecentSelectionChanged());
        recentContainer.add(cbRecentConnections, BorderLayout.CENTER);

        btnDeleteRecent = new JButton("X");
        btnDeleteRecent.setToolTipText("Eliminar conexión seleccionada");
        btnDeleteRecent.putClientProperty("FlatLaf.style", "background: #2D2E30; foreground: #FF7B72; arc: 10; font: bold 12");
        btnDeleteRecent.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btnDeleteRecent.setPreferredSize(new Dimension(34, 30));
        btnDeleteRecent.setEnabled(false);
        btnDeleteRecent.addActionListener(e -> handleDeleteRecent());
        recentContainer.add(btnDeleteRecent, BorderLayout.EAST);

        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(recentContainer, gbc);

        row++;

        // Separator
        gbc.gridx = 0; gbc.gridy = row; gbc.gridwidth = 2;
        JSeparator sep = new JSeparator();
        sep.setForeground(new Color(45, 46, 48));
        panel.add(sep, gbc);
        gbc.gridwidth = 1;

        row++;
        
        // 1. Motor
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblMotor = new JLabel("Motor:");
        lblMotor.setForeground(new Color(227, 227, 227));
        panel.add(lblMotor, gbc);
        cbDbType = new JComboBox<>(DatabaseType.values());
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(cbDbType, gbc);
        
        row++;
        
        // 2. Host
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblHost = new JLabel("Host:");
        lblHost.setForeground(new Color(227, 227, 227));
        panel.add(lblHost, gbc);
        txtHost = new FlatTextField();
        txtHost.setText("localhost");
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtHost, gbc);
        
        row++;
        
        // 3. Puerto
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblPort = new JLabel("Puerto:");
        lblPort.setForeground(new Color(227, 227, 227));
        panel.add(lblPort, gbc);
        txtPort = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtPort, gbc);
        
        row++;
        
        // 4. Usuario
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblUser = new JLabel("Usuario:");
        lblUser.setForeground(new Color(227, 227, 227));
        panel.add(lblUser, gbc);
        txtUser = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtUser, gbc);
        
        row++;
        
        // 5. Contraseña
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblPass = new JLabel("Contraseña:");
        lblPass.setForeground(new Color(227, 227, 227));
        panel.add(lblPass, gbc);
        txtPassword = new FlatPasswordField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtPassword, gbc);
        
        row++;

        // 6. Recordar contraseña checkbox
        gbc.gridx = 1; gbc.gridy = row;
        chkRememberPassword = new JCheckBox("Recordar contraseña");
        chkRememberPassword.setForeground(new Color(189, 193, 198));
        chkRememberPassword.setOpaque(false);
        chkRememberPassword.setFocusPainted(false);
        panel.add(chkRememberPassword, gbc);

        row++;

        // 7. Base de Datos (al final, carga automática al dar clic en el dropdown)
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblDb = new JLabel("Base de Datos:");
        lblDb.setForeground(new Color(227, 227, 227));
        lblDb.setFont(lblDb.getFont().deriveFont(Font.BOLD));
        panel.add(lblDb, gbc);

        cbDbName = new JComboBox<>();
        cbDbName.setEditable(true);

        // Auto-fetch when dropdown popup opens
        cbDbName.addPopupMenuListener(new PopupMenuListener() {
            @Override
            public void popupMenuWillBecomeVisible(PopupMenuEvent e) {
                if (!dbsLoadedForCurrentConfig && !isFetchingDbs) {
                    fetchDatabases(false);
                }
            }

            @Override
            public void popupMenuWillBecomeInvisible(PopupMenuEvent e) {}

            @Override
            public void popupMenuCanceled(PopupMenuEvent e) {}
        });

        // Auto-fetch when clicking or focusing the editor
        Component editorComp = cbDbName.getEditor().getEditorComponent();
        editorComp.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (!dbsLoadedForCurrentConfig && !isFetchingDbs) {
                    fetchDatabases(false);
                }
            }
        });
        editorComp.addFocusListener(new FocusAdapter() {
            @Override
            public void focusGained(FocusEvent e) {
                if (!dbsLoadedForCurrentConfig && !isFetchingDbs && cbDbName.getItemCount() == 0) {
                    fetchDatabases(false);
                }
            }
        });

        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(cbDbName, gbc);
        
        row++;
        
        // 8. Botones de acción
        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 0));
        buttonPanel.setOpaque(false);
        
        JButton btnCancel = new JButton("Cancelar");
        btnCancel.putClientProperty("FlatLaf.style", "background: #2D2E30; foreground: #BDC1C6; arc: 12");
        btnCancel.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btnCancel.addActionListener(e -> dispose());
        
        JButton btnConnect = new JButton("Conectar");
        btnConnect.putClientProperty("FlatLaf.style", "background: #004A77; foreground: #C2E7FF; hoverBackground: #005B92; arc: 12; font: bold 13");
        btnConnect.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btnConnect.addActionListener(this::handleConnect);
        
        buttonPanel.add(btnCancel);
        buttonPanel.add(btnConnect);
        
        gbc.gridx = 0; gbc.gridy = row; gbc.gridwidth = 2;
        gbc.insets = new Insets(16, 6, 4, 6);
        panel.add(buttonPanel, gbc);
        
        // Add dynamic port update on engine change and invalidate loaded dbs cache
        cbDbType.addActionListener(e -> {
            if (isUpdatingFields) return;
            DatabaseType type = (DatabaseType) cbDbType.getSelectedItem();
            if (type == DatabaseType.SQL_SERVER) txtPort.setText("1433");
            else if (type == DatabaseType.MYSQL) txtPort.setText("3306");
            else if (type == DatabaseType.POSTGRESQL) txtPort.setText("5432");
            invalidateDbsCache();
        });

        DocumentListener credentialDocListener = new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { if (!isUpdatingFields) invalidateDbsCache(); }
            public void removeUpdate(DocumentEvent e) { if (!isUpdatingFields) invalidateDbsCache(); }
            public void changedUpdate(DocumentEvent e) { if (!isUpdatingFields) invalidateDbsCache(); }
        };

        txtHost.getDocument().addDocumentListener(credentialDocListener);
        txtPort.getDocument().addDocumentListener(credentialDocListener);
        txtUser.getDocument().addDocumentListener(credentialDocListener);
        txtPassword.getDocument().addDocumentListener(credentialDocListener);

        // Initial trigger
        cbDbType.setSelectedIndex(0);
        
        add(panel);
    }

    private void invalidateDbsCache() {
        dbsLoadedForCurrentConfig = false;
    }

    private void loadRecentConnections() {
        isUpdatingFields = true;
        cbRecentConnections.removeAllItems();
        cbRecentConnections.addItem(null); // Option for new connection

        List<SavedConnection> recents = ConnectionHistoryManager.loadConnections();
        for (SavedConnection sc : recents) {
            cbRecentConnections.addItem(sc);
        }

        if (!recents.isEmpty()) {
            cbRecentConnections.setSelectedIndex(1); // Select the most recent one
        } else {
            cbRecentConnections.setSelectedIndex(0);
        }
        isUpdatingFields = false;
        onRecentSelectionChanged();
    }

    private void onRecentSelectionChanged() {
        SavedConnection selected = (SavedConnection) cbRecentConnections.getSelectedItem();
        isUpdatingFields = true;
        invalidateDbsCache();

        if (selected == null) {
            btnDeleteRecent.setEnabled(false);
            cbDbType.setSelectedIndex(0);
            txtHost.setText("localhost");
            txtPort.setText("1433");
            txtUser.setText("");
            txtPassword.setText("");
            setDbNameField("");
            chkRememberPassword.setSelected(false);
        } else {
            btnDeleteRecent.setEnabled(true);
            if (selected.getDbType() != null) {
                cbDbType.setSelectedItem(selected.getDbType());
            }
            txtHost.setText(selected.getHost() != null ? selected.getHost() : "localhost");
            txtPort.setText(selected.getPort() != null ? selected.getPort() : "");
            txtUser.setText(selected.getUser() != null ? selected.getUser() : "");
            txtPassword.setText(selected.getPassword());
            setDbNameField(selected.getDbName() != null ? selected.getDbName() : "");
            chkRememberPassword.setSelected(selected.isRememberPassword());
        }

        isUpdatingFields = false;
    }

    private void setDbNameField(String dbName) {
        cbDbName.removeAllItems();
        if (dbName != null && !dbName.isBlank()) {
            cbDbName.addItem(dbName);
            cbDbName.setSelectedItem(dbName);
        } else {
            cbDbName.getEditor().setItem("");
        }
    }

    private String getSelectedDbName() {
        Object item = cbDbName.getEditor().getItem();
        return item != null ? item.toString().trim() : "";
    }

    private void fetchDatabases(boolean showErrorDialog) {
        if (isFetchingDbs) return;

        DatabaseType type = (DatabaseType) cbDbType.getSelectedItem();
        String host = txtHost.getText().trim();
        String port = txtPort.getText().trim();
        String user = txtUser.getText().trim();
        String pass = new String(txtPassword.getPassword());

        if (host.isEmpty() || port.isEmpty()) {
            if (showErrorDialog) {
                JOptionPane.showMessageDialog(this, "Por favor especifica el Host y el Puerto antes de cargar las bases de datos.", "Aviso", JOptionPane.WARNING_MESSAGE);
            }
            return;
        }

        String currentVal = getSelectedDbName();
        isFetchingDbs = true;

        SwingWorker<List<String>, Void> worker = new SwingWorker<>() {
            @Override
            protected List<String> doInBackground() throws Exception {
                return connectionManager.listDatabases(type, host, port, user, pass);
            }

            @Override
            protected void done() {
                try {
                    List<String> dbs = get();
                    cbDbName.removeAllItems();
                    for (String db : dbs) {
                        cbDbName.addItem(db);
                    }
                    if (!currentVal.isEmpty()) {
                        cbDbName.setSelectedItem(currentVal);
                    } else if (!dbs.isEmpty()) {
                        cbDbName.setSelectedIndex(0);
                    }
                    dbsLoadedForCurrentConfig = true;
                    if (cbDbName.isShowing()) {
                        cbDbName.showPopup();
                    }
                } catch (Exception ex) {
                    if (showErrorDialog) {
                        Throwable cause = ex.getCause() != null ? ex.getCause() : ex;
                        JOptionPane.showMessageDialog(ConnectionDialog.this,
                                "No se pudieron obtener las bases de datos:\n" + cause.getMessage(),
                                "Error al listar bases de datos",
                                JOptionPane.ERROR_MESSAGE);
                    }
                } finally {
                    isFetchingDbs = false;
                }
            }
        };

        worker.execute();
    }

    private void handleDeleteRecent() {
        SavedConnection selected = (SavedConnection) cbRecentConnections.getSelectedItem();
        if (selected == null) return;

        int confirm = JOptionPane.showConfirmDialog(
                this,
                "¿Deseas eliminar la conexión guardada:\n" + selected.getDisplayName() + "?",
                "Eliminar conexión",
                JOptionPane.YES_NO_OPTION
        );

        if (confirm == JOptionPane.YES_OPTION) {
            ConnectionHistoryManager.deleteConnection(selected);
            loadRecentConnections();
        }
    }
    
    private void handleConnect(ActionEvent e) {
        DatabaseType type = (DatabaseType) cbDbType.getSelectedItem();
        String host = txtHost.getText().trim();
        String port = txtPort.getText().trim();
        String dbName = getSelectedDbName();
        String user = txtUser.getText().trim();
        String password = new String(txtPassword.getPassword());
        boolean remember = chkRememberPassword.isSelected();

        if (dbName.isEmpty()) {
            JOptionPane.showMessageDialog(this, "Por favor ingresa o selecciona el nombre de la Base de Datos.", "Campo requerido", JOptionPane.WARNING_MESSAGE);
            cbDbName.requestFocusInWindow();
            return;
        }

        try {
            connectionManager.connect(type, host, port, dbName, user, password);
            
            // Connection successful -> save to history
            SavedConnection conn = new SavedConnection(type, host, port, dbName, user, password, remember);
            ConnectionHistoryManager.saveConnection(conn);

            connected = true;
            dispose();
        } catch (Exception ex) {
            JOptionPane.showMessageDialog(this, 
                "Error al conectar:\n" + ex.getMessage(), 
                "Error de conexión", 
                JOptionPane.ERROR_MESSAGE);
            connected = false;
        }
    }
    
    public boolean isConnected() {
        return connected;
    }
}
