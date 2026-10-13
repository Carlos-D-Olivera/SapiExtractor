package com.cdog.projects.ui.components;

import com.formdev.flatlaf.extras.components.FlatTextField;

import javax.swing.*;
import java.awt.*;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;
import java.awt.geom.RoundRectangle2D;

public class RoundSearchField extends FlatTextField {
    // Colors matching Img2:
    // Background: #1E1F20 (30, 31, 32)
    // Foreground: #E3E3E3 (227, 227, 227)
    // Placeholder: #BDC1C6 (189, 193, 198)
    private static final Color BG_COLOR = new Color(30, 31, 32);
    private static final Color TEXT_COLOR = new Color(227, 227, 227);
    private static final Color PLACEHOLDER_COLOR = new Color(189, 193, 198);
    private static final Color SELECTION_BG = new Color(0, 74, 119);
    private static final Color SELECTION_FG = new Color(194, 231, 255);

    public RoundSearchField() {
        putClientProperty("JTextField.placeholderText", "Buscar procedimientos...");
        putClientProperty("JTextField.showClearButton", true);
        putClientProperty("JComponent.roundRect", true);
        putClientProperty("JTextField.placeholderForeground", PLACEHOLDER_COLOR);
        putClientProperty("FlatLaf.style",
            "arc: 999; " +
            "background: #1E1F20; " +
            "foreground: #E3E3E3; " +
            "caretColor: #E3E3E3; " +
            "borderColor: #1E1F20; " +
            "focusedBorderColor: #004A77; " +
            "margin: 8,20,8,20"); // Reduced margin slightly to fit better horizontally

        setBackground(BG_COLOR);
        setForeground(TEXT_COLOR);
        setCaretColor(TEXT_COLOR);
        setSelectionColor(SELECTION_BG);
        setSelectedTextColor(SELECTION_FG);
        setFont(getFont().deriveFont(15f));
        setOpaque(false);

        // Allow layout manager to shrink field if needed by setting height only via preferredSize
        setPreferredSize(new Dimension(0, 52));

        addFocusListener(new FocusAdapter() {
            @Override
            public void focusGained(FocusEvent e) {
                selectAll();
            }
        });
    }

    @Override
    protected void paintComponent(Graphics g) {
        Graphics2D g2 = (Graphics2D) g.create();
        g2.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2.setColor(BG_COLOR);
        g2.fill(new RoundRectangle2D.Float(0, 0, getWidth(), getHeight(), getHeight(), getHeight()));
        g2.dispose();

        super.paintComponent(g);
    }
}
