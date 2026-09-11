package com.cdog.projects.ui.components;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;

public class ConnectionButton extends JButton {
    private boolean connected = false;
    private boolean hovered = false;
    private boolean pressed = false;
    private String dbName = "";

    // Colors matching Img1:
    // Background: #004A77 (0, 74, 119)
    // Hover: #005B92 (0, 91, 146)
    // Text: #C2E7FF (194, 231, 255)
    // Connected dot: #00FF00 (0, 255, 0)
    public static final Color BG_NORMAL = new Color(0, 74, 119);
    public static final Color BG_HOVER = new Color(0, 91, 146);
    public static final Color BG_PRESSED = new Color(0, 61, 99);
    public static final Color TEXT_COLOR = new Color(194, 231, 255);
    public static final Color DOT_CONNECTED = new Color(0, 255, 0);
    public static final Color DOT_DISCONNECTED = new Color(255, 75, 75);

    public ConnectionButton() {
        super("Conectar");
        setContentAreaFilled(false);
        setBorderPainted(false);
        setFocusPainted(false);
        setCursor(new Cursor(Cursor.HAND_CURSOR));
        setOpaque(false);
        setForeground(TEXT_COLOR);
        setFont(getFont().deriveFont(Font.BOLD, 13.5f));
        setToolTipText("Haz clic para conectar a una base de datos");

        addMouseListener(new MouseAdapter() {
            @Override
            public void mouseEntered(MouseEvent e) {
                hovered = true;
                repaint();
            }

            @Override
            public void mouseExited(MouseEvent e) {
                hovered = false;
                pressed = false;
                repaint();
            }

            @Override
            public void mousePressed(MouseEvent e) {
                pressed = true;
                repaint();
            }

            @Override
            public void mouseReleased(MouseEvent e) {
                pressed = false;
                repaint();
            }
        });
    }

    public void setConnectedStatus(boolean connected, String dbName) {
        this.connected = connected;
        this.dbName = (dbName != null) ? dbName.trim() : "";
        if (connected) {
            setText(this.dbName.isEmpty() ? "Conectado" : this.dbName);
            setToolTipText("Conectado a: " + this.dbName);
        } else {
            setText("Conectar");
            setToolTipText("Haz clic para conectar a una base de datos");
        }
        revalidate();
        repaint();
    }

    public boolean isConnected() {
        return connected;
    }

    @Override
    public Dimension getPreferredSize() {
        FontMetrics fm = getFontMetrics(getFont());
        String text = getText();
        int textWidth = (text != null) ? fm.stringWidth(text) : 60;
        // 18 (left) + 12 (dot) + 14 (gap) + textWidth + 24 (right)
        int calculatedWidth = 18 + 12 + 14 + textWidth + 24;
        return new Dimension(Math.max(170, calculatedWidth), 42);
    }

    @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);

        int width = getWidth();
        int height = getHeight();

        // 1. Pill Background (#004A77)
        Color bg = pressed ? BG_PRESSED : (hovered ? BG_HOVER : BG_NORMAL);
        g2.setColor(bg);
        g2.fill(new RoundRectangle2D.Float(0, 0, width, height, height, height));

        // 2. Status Dot (#00FF00 if connected)
        int dotSize = 12;
        int dotX = 18;
        int dotY = (height - dotSize) / 2;
        g2.setColor(connected ? DOT_CONNECTED : DOT_DISCONNECTED);
        g2.fillOval(dotX, dotY, dotSize, dotSize);

        // 3. Text (#C2E7FF)
        g2.setColor(TEXT_COLOR);
        g2.setFont(getFont());
        FontMetrics fm = g2.getFontMetrics();
        String text = getText();

        int textStartX = dotX + dotSize + 14;
        int availableSpace = width - textStartX - 18;
        int textWidth = fm.stringWidth(text);
        int textX = textStartX + Math.max(0, (availableSpace - textWidth) / 2);
        int textY = (height - fm.getHeight()) / 2 + fm.getAscent();

        g2.drawString(text, textX, textY);

        g2.dispose();
    }
}
