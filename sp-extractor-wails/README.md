# SpExtractor (Wails v2 + React + Tailwind)

Subproyecto que contiene la implementación moderna de escritorio de **SpExtractor** basada en **Wails v2**, **Go** y **React**.

## 🚀 Inicio Rápido

### Requisitos
- **Go 1.22+**
- **Node.js 20+**
- **Wails CLI:** `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Desarrollo en Vivo (Live Reload)
```powershell
wails dev
```
Inicia el backend en Go y el servidor de desarrollo Vite con Hot Module Replacement (HMR).

### Ejecutar Pruebas Unitarias
```powershell
go test -v ./...
```

### Compilar Ejecutable de Producción
```powershell
wails build -clean
```
El ejecutable binario para Windows se guardará en `build/bin/sp-extractor.exe`.

## 📁 Estructura del Código
- `app.go`: Bindings y métodos del backend expuestos hacia el frontend.
- `main.go`: Inicialización de la ventana de Wails.
- `pkg/config`: Almacenamiento local del historial de conexiones.
- `pkg/db`: Conexiones SQL y modelos unificados de objetos de base de datos.
- `pkg/db/extractors`: Estrategias de extracción por motor (SQL Server, MySQL, PostgreSQL).
- `pkg/exporter`: Servicio de sanitización y exportación de archivos `.sql`.
- `frontend/src`: Componentes de la interfaz de usuario en React con Tailwind CSS.

Para más detalles, consulta la [Guía de Contribución](../CONTRIBUTING.md) y el [Resumen de Migración](../README.migration.md).
