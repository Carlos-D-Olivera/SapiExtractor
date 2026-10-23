# SapiExtractor (Wails v2 + React + Tailwind)

Subproyecto que contiene la implementación de escritorio de **SapiExtractor** basada en **Wails v2**, **Go** y **React**.

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
El ejecutable binario para Windows se guardará en `build/bin/SapiExtractor.exe`.

## 📁 Estructura del Código
- `app.go`: Bindings y métodos del backend expuestos hacia el frontend (conexión, extracción, exportación, ejecución de queries).
- `main.go`: Inicialización de la ventana de Wails.
- `pkg/config`: Almacenamiento local del historial de conexiones.
- `pkg/db`: Conexiones SQL multimotor y modelos de objetos de base de datos.
- `pkg/db/extractors`: Estrategias de extracción por motor (SQL Server, MySQL, PostgreSQL) y modelos de relaciones.
- `pkg/db/scriptgen`: Generadores de DDL/DML para tablas y scripts `INSERT` masivos a partir de consultas.
- `frontend/src`: Componentes de la interfaz de usuario en React 19 con Tailwind CSS y CodeMirror 6.

Para más detalles, consulta la [Guía de Contribución](../CONTRIBUTING.md) y el [README principal](../README.md).
