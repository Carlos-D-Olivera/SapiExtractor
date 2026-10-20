package com.cdog.projects.ui.components;

import com.cdog.projects.db.DbObjectType;

import javax.swing.*;
import javax.swing.border.EmptyBorder;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.geom.RoundRectangle2D;
import java.util.function.Consumer;

public class TypeDropdownButton extends JButton {
    private boolean hovered = false;
    private boolean pressed = false;

    private static final Color BG_NORMAL = new Color(30, 31, 32);       // #1E1F20
    private static final Color BG_HOVER = new Color(45, 46, 48);        // #2D2E30
    private static final Color BG_PRESSED = new Color(24, 25, 26);
    private static final Color TEXT_COLOR = new Color(227, 227, 227);   // #E3E3E3
    private static final Color POPUP_BG = new Color(30, 31, 32);
    private static final Color POPUP_BORDER = new Color(45, 46, 48);
    private static final Color ITEM_HOVER = new Color(0, 74, 119);      // #004A77

    private DbObjectType selectedType = DbObjectType.STORED_PROCEDURE;
    private Consumer<DbObjectType> onTypeSelected;

    public TypeDropdownButton() {
        super();
        init();
    }

    private void init() {
        updateLabel();
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

        addActionListener(e -> showPopup());
    }

    private void updateLabel() {
        setText(selectedType.getDisplayName() + "  \u25BE");
    }

    public void setOnTypeSelected(Consumer<DbObjectType> callback) {
        this.onTypeSelected = callback;
    }

    public DbObjectType getSelectedType() {
        return selectedType;
    }

    public void setSelectedType(DbObjectType type) {
        if (type == null) return;
        this.selectedType = type;
        updateLabel();
        repaint();
    }

    private void showPopup() {
        JPopupMenu menu = new JPopupMenu();
        menu.setBackground(POPUP_BG);
        menu.setBorder(BorderFactory.createLineBorder(POPUP_BORDER, 1, true));

        for (DbObjectType type : DbObjectType.values()) {
            JMenuItem item = new JMenuItem(type.getDisplayName());
            item.setOpaque(true);
            item.setBackground(POPUP_BG);
            item.setForeground(TEXT_COLOR);
            item.setFont(getFont().deriveFont(type == selectedType ? Font.BOLD : Font.PLAIN, 13f));
            item.setBorder(new EmptyBorder(8, 16, 8, 16));
            item.setCursor(new Cursor(Cursor.HAND_CURSOR));

            if (type == selectedType) {
                item.setText("\u2713  " + type.getDisplayName());
            } else {
                item.setText("    " + type.getDisplayName());
            }

            item.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseEntered(MouseEvent e) {
                    item.setBackground(ITEM_HOVER);
                }

                @Override
                public void mouseExited(MouseEvent e) {
                    item.setBackground(POPUP_BG);
                }
            });

            item.addActionListener(e -> {
                setSelectedType(type);
                if (onTypeSelected != null) {
                    onTypeSelected.accept(type);
                }
            });

            menu.add(item);
        }

        menu.show(this, 0, getHeight() + 4);
    }

    @Override
    public Dimension getPreferredSize() {
        Dimension d = super.getPreferredSize();
        return new Dimension(Math.max(160, d.width + 30), 42);
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
