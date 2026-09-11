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
        panel.setBorder(BorderFactory.createEmptyBorder(20, 20, 20, 20));
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.insets = new Insets(5, 5, 5, 5);
        gbc.fill = GridBagConstraints.HORIZONTAL;
        
        int row = 0;
        
        // Engine
        gbc.gridx = 0; gbc.gridy = row;
        panel.add(new JLabel("Motor:"), gbc);
        cbDbType = new JComboBox<>(DatabaseType.values());
        gbc.gridx = 1; gbc.gridy = row;
        gbc.weightx = 1.0;
        panel.add(cbDbType, gbc);
        
        row++;
        
        // Host
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        panel.add(new JLabel("Host:"), gbc);
        txtHost = new FlatTextField();
        txtHost.setText("localhost");
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtHost, gbc);
        
        row++;
        
        // Port
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        panel.add(new JLabel("Puerto:"), gbc);
        txtPort = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtPort, gbc);
        
        row++;
        
        // DB Name
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        panel.add(new JLabel("Base de Datos:"), gbc);
        txtDbName = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtDbName, gbc);
        
        row++;
        
        // User
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        panel.add(new JLabel("Usuario:"), gbc);
        txtUser = new FlatTextField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtUser, gbc);
        
        row++;
        
        // Password
        gbc.gridx = 0; gbc.gridy = row; gbc.weightx = 0.0;
        panel.add(new JLabel("Contraseña:"), gbc);
        txtPassword = new FlatPasswordField();
        gbc.gridx = 1; gbc.gridy = row; gbc.weightx = 1.0;
        panel.add(txtPassword, gbc);
        
        row++;
        
        // Buttons
        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton btnConnect = new JButton("Conectar");
        JButton btnCancel = new JButton("Cancelar");
        
        btnConnect.addActionListener(this::handleConnect);
        btnCancel.addActionListener(e -> dispose());
        
        buttonPanel.add(btnCancel);
        buttonPanel.add(btnConnect);
        
        gbc.gridx = 0; gbc.gridy = row; gbc.gridwidth = 2;
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
