package com.cdog.projects.ui.components;

import javax.swing.*;
import java.awt.*;
import java.awt.geom.RoundRectangle2D;

public class GradientPanel extends JPanel {
    private Color colorStart;
    private Color colorEnd;
    private int arcRadius;

    public GradientPanel(Color colorStart, Color colorEnd, int arcRadius) {
        this.colorStart = colorStart;
        this.colorEnd = colorEnd;
        this.arcRadius = arcRadius;
        setOpaque(false);
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2d = (Graphics2D) g.create();
        
        // Anti-aliasing
        g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);

        // Gradient
        int width = getWidth();
        int height = getHeight();
        GradientPaint gp = new GradientPaint(0, 0, colorStart, 0, height, colorEnd);
        g2d.setPaint(gp);

        // Draw rounded rectangle
        RoundRectangle2D.Float r2d = new RoundRectangle2D.Float(0, 0, width, height, arcRadius, arcRadius);
        g2d.fill(r2d);
        
        g2d.dispose();
    }
}
