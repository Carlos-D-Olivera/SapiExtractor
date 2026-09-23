package com.cdog.projects.ui.components;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;

public class PillActionButton extends JButton {
    private boolean hovered = false;
    private boolean pressed = false;

    // Matching ConnectionButton style: #004A77 / #C2E7FF
    public static final Color BG_NORMAL = new Color(0, 74, 119);
    public static final Color BG_HOVER = new Color(0, 91, 146);
    public static final Color BG_PRESSED = new Color(0, 61, 99);
    public static final Color TEXT_COLOR = new Color(194, 231, 255);

    public PillActionButton(String text) {
        super(text);
        init();
    }

    public PillActionButton(String text, Icon icon) {
        super(text, icon);
        init();
    }

    private void init() {
        setContentAreaFilled(false);
        setBorderPainted(false);
        setFocusPainted(false);
        setCursor(new Cursor(Cursor.HAND_CURSOR));
        setOpaque(false);
        setForeground(TEXT_COLOR);
        setFont(getFont().deriveFont(Font.BOLD, 12f));
        setIconTextGap(6);

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

    @Override
    public Dimension getPreferredSize() {
        FontMetrics fm = getFontMetrics(getFont());
        String text = getText();
        int textWidth = (text != null) ? fm.stringWidth(text) : 40;
        int iconWidth = (getIcon() != null) ? getIcon().getIconWidth() + getIconTextGap() : 0;
        return new Dimension(Math.max(100, textWidth + iconWidth + 28), 32);
    }

    @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.setRenderingHint(RenderingHints.KEY_TEXT_ANTIALIASING, RenderingHints.VALUE_TEXT_ANTIALIAS_ON);

        int width = getWidth();
        int height = getHeight();

        Color bg = pressed ? BG_PRESSED : (hovered ? BG_HOVER : BG_NORMAL);
        g2.setColor(bg);
        g2.fill(new RoundRectangle2D.Float(0, 0, width, height, height, height));

        g2.dispose();
        super.paintComponent(g);
    }
}
