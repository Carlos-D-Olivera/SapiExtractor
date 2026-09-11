package com.cdog.projects.ui.components;

import com.formdev.flatlaf.extras.components.FlatTextField;
import java.awt.event.FocusAdapter;
import java.awt.event.FocusEvent;

public class RoundSearchField extends FlatTextField {
    public RoundSearchField() {
        putClientProperty("JTextField.placeholderText", "Buscar stored procedure...");
        putClientProperty("JTextField.showClearButton", true);
        putClientProperty("JComponent.roundRect", true);
        
        // Add auto-select behavior if needed
        addFocusListener(new FocusAdapter() {
            @Override
            public void focusGained(FocusEvent e) {
                selectAll();
            }
        });
    }
}
