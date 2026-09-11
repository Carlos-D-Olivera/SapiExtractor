package com.cdog.projects.ui.dialogs;

import com.cdog.projects.db.DatabaseType;
import com.cdog.projects.db.ConnectionManager;
import com.formdev.flatlaf.extras.components.FlatTextField;
import com.formdev.flatlaf.extras.components.FlatPasswordField;

import javax.swing.*;
import java.awt.*;
import java.awt.event.ActionEvent;

public class ConnectionDialog extends JDialog {
    private JComboBox<DatabaseType> cbDbType;
    private FlatTextField txtHost;
    private FlatTextField txtPort;
    private FlatTextField txtDbName;
    private FlatTextField txtUser;
    private FlatPasswordField txtPassword;
    
    private boolean connected = false;
    private final ConnectionManager connectionManager;

    public ConnectionDialog(Frame parent, ConnectionManager connectionManager) {
        super(parent, "Conectar a Base de Datos", true);
        this.connectionManager = connectionManager;
        
        setupUI();
        pack();
        setLocationRelativeTo(parent);
    }
    
    private void setupUI() {
        JPanel panel = new JPanel(new GridBagLayout());
        panel.setBackground(new Color(24, 25, 26));
        panel.setBorder(BorderFactory.createEmptyBorder(24, 28, 24, 28));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(6, 6, 6, 6);
        gbc.fill = GridBagConstraints.HORIZONTAL;
        
        int row = 0;
        
        // Motor
        gbc.gridx = 0; gbc.gridy = row;
        JLabel lblMotor = new JLabel("Motor:");
        lblMotor.setForeground(new Color(227, 227, 227));
        panel.add(lblMotor, gbc);
        cbDbType = new JComboBox<>(DatabaseType.values());
        gbc.gridx = 1; gbc.gridy = row;
        gbc.weightx = 1.0;
        panel.add(cbDbType, gbc);
        
        row++;
        
        // Host
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblHost = new JLabel("Host:");
        lblHost.setForeground(new Color(227, 227, 227));
        panel.add(lblHost, gbc);
        txtHost = new FlatTextField();
        txtHost.setText("localhost");
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtHost, gbc);
        
        row++;
        
        // Puerto
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblPort = new JLabel("Puerto:");
        lblPort.setForeground(new Color(227, 227, 227));
        panel.add(lblPort, gbc);
        txtPort = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtPort, gbc);
        
        row++;
        
        // DB Name
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblDb = new JLabel("Base de Datos:");
        lblDb.setForeground(new Color(227, 227, 227));
        panel.add(lblDb, gbc);
        txtDbName = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtDbName, gbc);
        
        row++;
        
        // User
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblUser = new JLabel("Usuario:");
        lblUser.setForeground(new Color(227, 227, 227));
        panel.add(lblUser, gbc);
        txtUser = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtUser, gbc);
        
        row++;
        
        // Password
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        JLabel lblPass = new JLabel("Contraseña:");
        lblPass.setForeground(new Color(227, 227, 227));
        panel.add(lblPass, gbc);
        txtPassword = new FlatPasswordField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtPassword, gbc);
        
        row++;
        
        // Buttons
        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT, 10, 0));
        buttonPanel.setOpaque(false);
        
        JButton btnCancel = new JButton("Cancelar");
        btnCancel.putClientProperty("FlatLaf.style", "background: #2D2E30; foreground: #BDC1C6; arc: 12");
        btnCancel.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btnCancel.addActionListener(e -> dispose());
        
        JButton btnConnect = new JButton("Conectar");
        // Styled with #004A77 background and #C2E7FF foreground
        btnConnect.putClientProperty("FlatLaf.style", "background: #004A77; foreground: #C2E7FF; hoverBackground: #005B92; arc: 12; font: bold 13");
        btnConnect.setCursor(new Cursor(Cursor.HAND_CURSOR));
        btnConnect.addActionListener(this::handleConnect);
        
        buttonPanel.add(btnCancel);
        buttonPanel.add(btnConnect);
        
        gbc.gridx = 0; gbc.gridy = row; gbc.gridwidth = 2;
        gbc.insets = new Insets(16, 6, 4, 6);
        panel.add(buttonPanel, gbc);
        
        // Add dynamic port update
        cbDbType.addActionListener(e -> {
            DatabaseType type = (DatabaseType) cbDbType.getSelectedItem();
            if (type == DatabaseType.SQL_SERVER) txtPort.setText("1433");
            else if (type == DatabaseType.MYSQL) txtPort.setText("3306");
            else if (type == DatabaseType.POSTGRESQL) txtPort.setText("5432");
        });
        // Initial trigger
        cbDbType.setSelectedIndex(0);
        
        add(panel);
    }
    
    private void handleConnect(ActionEvent e) {
        try {
            connectionManager.connect(
                (DatabaseType) cbDbType.getSelectedItem(),
                txtHost.getText(),
                txtPort.getText(),
                txtDbName.getText(),
                txtUser.getText(),
                new String(txtPassword.getPassword())
            );
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
