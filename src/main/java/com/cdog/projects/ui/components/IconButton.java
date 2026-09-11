package com.cdog.projects.ui.components;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;

public class IconButton extends JButton {
    public IconButton(Icon icon) {
        super(icon);
        setContentAreaFilled(false);
        setBorderPainted(false);
        setFocusPainted(false);
        setCursor(new Cursor(Cursor.HAND_CURSOR));
        setOpaque(false);
        
        addMouseListener(new MouseAdapter() {
            @Override
            public void mouseEntered(MouseEvent e) {
                setOpaque(true);
                setBackground(new Color(255, 255, 255, 30));
                repaint();
            }

            @Override
            public void mouseExited(MouseEvent e) {
                setOpaque(false);
                setBackground(null);
                repaint();
            }
        });
    }
}
