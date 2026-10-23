package config

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// AutoCompleteItem represents a quick SQL snippet expanded with TAB.
type AutoCompleteItem struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	Query       string `json:"query"`
	Seleccionar bool   `json:"seleccionar"`
}

// DefaultAutoCompletes contains standard snippets shipped with SpExtractor.
var DefaultAutoCompletes = []AutoCompleteItem{
	{ID: "sel", Code: "sel", Query: "SELECT * FROM ", Seleccionar: false},
	{ID: "seltop", Code: "seltop", Query: "SELECT TOP 100 * FROM ", Seleccionar: false},
	{ID: "ver", Code: "ver", Query: "SELECT * FROM admControlVersiones", Seleccionar: true},
	{ID: "dbs", Code: "dbs", Query: "SELECT * FROM admConfiguracion WHERE Codigo LIKE '%DBS%'", Seleccionar: true},
	{ID: "dbss", Code: "dbss", Query: "UPDATE admConfiguracion SET VlrTexto = 'SIOS' WHERE Codigo = 'DBSIOS'\nUPDATE admConfiguracion SET VrlTexto = 'GENOVA' WHERE Codigo = 'DBSIG'\nUPDATE admConfiguracion SET VrlTexto = '45.138.27.60' WHERE Codigo = 'SER_DBSIG'", Seleccionar: true},
	{ID: "chk", Code: "chk", Query: "SELECT * FROM admConfiguracion WHERE Codigo = '#'", Seleccionar: false},
	{ID: "upd", Code: "upd", Query: "UPDATE # SET Columna = valor WHERE  condicion", Seleccionar: false},
	{ID: "users", Code: "users", Query: "DECLARE @BD SYSNAME = DB_NAME(); EXEC master.dbo.usp_UsuariosPasswordModulo @BaseDatos = @BD", Seleccionar: true},
	{ID: "userf", Code: "userf", Query: "DECLARE @BD SYSNAME = DB_NAME(); EXEC master.dbo.usp_UsuariosPasswordModulo @BaseDatos = @BD, @NombreModulo = 'Facturacion';", Seleccionar: true},
	{ID: "userhc", Code: "userhc", Query: "DECLARE @BD SYSNAME = DB_NAME(); EXEC master.dbo.usp_UsuariosPasswordModulo @BaseDatos = @BD, @NombreModulo = 'Historia Clinica';", Seleccionar: true},
}

// autocompletesConfigPath returns the path to ~/.spextractor/autocompletes.json.
func autocompletesConfigPath() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, ".spextractor")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", err
	}
	return filepath.Join(dir, "autocompletes.json"), nil
}

// LoadAutoCompletes reads saved snippets from disk.
// If the configuration file doesn't exist yet, it initializes it with defaults.
func LoadAutoCompletes() ([]AutoCompleteItem, error) {
	path, err := autocompletesConfigPath()
	if err != nil {
		return DefaultAutoCompletes, err
	}

	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		// Initialize with defaults on first run
		_ = SaveAutoCompletes(DefaultAutoCompletes)
		return DefaultAutoCompletes, nil
	}
	if err != nil {
		return DefaultAutoCompletes, err
	}

	var items []AutoCompleteItem
	if err := json.Unmarshal(data, &items); err != nil {
		return DefaultAutoCompletes, err
	}

	return items, nil
}

// SaveAutoCompletes writes snippets to ~/.spextractor/autocompletes.json.
func SaveAutoCompletes(items []AutoCompleteItem) error {
	path, err := autocompletesConfigPath()
	if err != nil {
		return err
	}

	data, err := json.MarshalIndent(items, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}
