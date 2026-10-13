package com.cdog.projects.ui.components;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;

public class IconButton extends JButton {
    private boolean hovered = false;
    private boolean pressed = false;

    private static final Color BG_NORMAL = new Color(30, 31, 32);       // #1E1F20
    private static final Color BG_HOVER = new Color(45, 46, 48);        // #2D2E30
    private static final Color BG_PRESSED = new Color(24, 25, 26);
    private static final Color TEXT_COLOR = new Color(227, 227, 227);   // #E3E3E3

    public IconButton(Icon icon) {
        super(icon);
        init();
    }

    public IconButton(String text) {
        super(text);
        init();
    }

    private void init() {
        setContentAreaFilled(false);
        setBorderPainted(false);
        setFocusPainted(false);
        setCursor(new Cursor(Cursor.HAND_CURSOR));
        setOpaque(false);
        setForeground(TEXT_COLOR);
        setFont(getFont().deriveFont(Font.BOLD, 13f));
        setIconTextGap(8);

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
        Dimension d = super.getPreferredSize();
        return new Dimension(Math.max(120, d.width + 30), 42);
    }

    @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        int width = getWidth();
        int height = getHeight();

        Color bg = pressed ? BG_PRESSED : (hovered ? BG_HOVER : BG_NORMAL);
        g2.setColor(bg);
        g2.fill(new RoundRectangle2D.Float(0, 0, width, height, height, height));

        g2.dispose();
        super.paintComponent(g);
    }
}
