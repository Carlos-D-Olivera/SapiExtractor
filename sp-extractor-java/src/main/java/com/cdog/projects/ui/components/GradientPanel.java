package com.cdog.projects.ui.components;

import javax.swing.*;
import java.awt.*;
import java.awt.geom.Point2D;
import java.awt.geom.RoundRectangle2D;

public class GradientPanel extends JPanel {
    // Colors matching Img2:
    // Outer/base: #0F0F0F (15, 15, 15)
    // Center glow: #121A3B (18, 26, 59)
    private final Color centerColor = new Color(18, 26, 59);
    private final Color midColor = new Color(17, 22, 45);
    private final Color outerColor = new Color(15, 15, 15);
    private int arcRadius = 0;

    public GradientPanel() {
        this(0);
    }

    public GradientPanel(int arcRadius) {
        this.arcRadius = arcRadius;
        setOpaque(true);
        setBackground(outerColor);
    }

    public GradientPanel(Color colorStart, Color colorEnd, int arcRadius) {
        this(arcRadius);
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        Graphics2D g2d = (Graphics2D) g.create();
        
        g2d.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
        g2d.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);

        int width = getWidth();
        int height = getHeight();

        if (width <= 0 || height <= 0) {
            g2d.dispose();
            return;
        }

        // Base dark fill (#0F0F0F)
        g2d.setColor(outerColor);
        if (arcRadius > 0) {
            g2d.fill(new RoundRectangle2D.Float(0, 0, width, height, arcRadius, arcRadius));
        } else {
            g2d.fillRect(0, 0, width, height);
        }

        // Smooth radial gradient glow centered at (width / 2, height * 0.56)
        Point2D center = new Point2D.Float(width / 2.0f, height * 0.56f);
        float radius = Math.max(width, height) * 0.58f;
        float[] dist = {0.0f, 0.35f, 0.70f, 1.0f};
        Color[] colors = {
            centerColor,
            midColor,
            new Color(15, 17, 26),
            outerColor
        };
        RadialGradientPaint rgp = new RadialGradientPaint(center, radius, dist, colors);
        g2d.setPaint(rgp);
        
        if (arcRadius > 0) {
            g2d.fill(new RoundRectangle2D.Float(0, 0, width, height, arcRadius, arcRadius));
        } else {
            g2d.fillRect(0, 0, width, height);
        }

        g2d.dispose();
    }
}
