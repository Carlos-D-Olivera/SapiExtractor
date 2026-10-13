package com.cdog.projects;

import com.cdog.projects.ui.MainFrame;
import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.themes.FlatMacDarkLaf;

import javax.swing.*;
import java.awt.*;
import java.util.Arrays;

public class Main {
    public static void main(String[] args) {
        // Find best modern font
        String[] possibleFonts = {"Google Sans Flex", "Google Sans", "Inter", "Segoe UI", "Helvetica Neue", "SansSerif"};
        String chosenFont = "SansSerif";
        String[] systemFonts = GraphicsEnvironment.getLocalGraphicsEnvironment().getAvailableFontFamilyNames();
        
        for (String f : possibleFonts) {
            if (Arrays.asList(systemFonts).contains(f)) {
                chosenFont = f;
                break;
            }
        }
        
        try {
            UIManager.put("defaultFont", new Font(chosenFont, Font.PLAIN, 14));
            
            // macOS Title Bar Controls (Traffic lights) for Windows
            UIManager.put("TitlePane.buttonStyle", "mac");
            UIManager.put("TitlePane.centerTitle", true);
            UIManager.put("TitlePane.unifiedBackground", false);
            UIManager.put("TitlePane.background", new Color(15, 15, 15));
            UIManager.put("TitlePane.foreground", new Color(227, 227, 227));
            UIManager.put("TitlePane.inactiveBackground", new Color(15, 15, 15));
            UIManager.put("TitlePane.inactiveForeground", new Color(140, 140, 140));
            
            // UI Component radii
            UIManager.put("Button.arc", 999);
            UIManager.put("Component.arc", 15);
            UIManager.put("ProgressBar.arc", 15);
            UIManager.put("TextComponent.arc", 999);
            
            // Selection colors matching #004A77 and #C2E7FF
            UIManager.put("Component.accentColor", new Color(0, 74, 119));
            UIManager.put("List.selectionBackground", new Color(0, 74, 119));
            UIManager.put("List.selectionForeground", new Color(194, 231, 255));
            UIManager.put("TextComponent.selectionBackground", new Color(0, 74, 119));
            UIManager.put("TextComponent.selectionForeground", new Color(194, 231, 255));

            UIManager.setLookAndFeel(new FlatMacDarkLaf());
        } catch (Exception ex) {
            System.err.println("Failed to initialize FlatLaf: " + ex.getMessage());
        }

        SwingUtilities.invokeLater(() -> {
            MainFrame mainFrame = new MainFrame();
            mainFrame.setVisible(true);
        });
    }
}
