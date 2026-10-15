# SpExtractor Migration to Wails (Go + React + Tailwind)

## Resumen de la Migración

La migración de **SpExtractor** desde Java/Swing (FlatLaf) a **Wails v2 (Go + React + Tailwind CSS)** ha sido completada exitosamente siguiendo el plan detallado en [migration_plan_wails.md](file:///c:/Users/Usuario/Desktop/SpExtractor/migration_plan_wails.md).

---

## Estado de las Fases

| Fase | Descripción | Estado |
|---|---|:---:|
| **Fase 0** | Preparación e instalación de herramientas (Go 1.24+, Node, Wails v2) | ✅ Completado |
| **Fase 1** | Scaffold del proyecto Wails React en `sp-extractor-wails/` | ✅ Completado |
| **Fase 2** | Portado del backend de base de datos a Go (`pkg/db`, extractores SQL Server, MySQL, Postgres) | ✅ Completado |
| **Fase 3** | Definición de bindings de Wails en `app.go` (`Connect`, `ListDatabases`, `ListObjects`, `ExportObjects`, etc.) | ✅ Completado |
| **Fase 4** | Desarrollo del frontend en React con Tailwind CSS (Paleta oscura `#004A77` / `#C2E7FF`, Lucide Icons, Glassmorphism) | ✅ Completado |
| **Fase 5** | Integración asíncrona de eventos con `runtime.EventsEmit` (`export:progress`, `export:done`, `export:error`) | ✅ Completado |
| **Fase 6** | Pruebas unitarias de Go (`go test -v ./...`) cubriendo config, db, extractores y exportador | ✅ 100% Pasadas |
| **Fase 7** | Compilación del binario nativo Windows (`sp-extractor.exe` ~18MB con ícono oficial embebido) | ✅ Completado |
| **Fase 8** | Documentación de desarrollo y compilación | ✅ Completado |

---

## Estructura del Proyecto Migrado (`sp-extractor-wails/`)

```
sp-extractor-wails/
├── app.go                      # Bridge Wails backend-frontend
├── main.go                     # Entrypoint Wails con configuración de ventana y shutdown
├── wails.json                  # Configuración de Wails
├── pkg/
│   ├── config/                 # Historial de conexiones (persistido en ~/.spextractor/connections.json)
│   │   ├── connections.go
│   │   └── connections_test.go # Pruebas unitarias
│   ├── db/                     # Conectores de base de datos y modelos
│   │   ├── conn.go             # Manejador de drivers (mssql, mysql, pgx)
│   │   ├── types.go            # Tipos de datos (DbObject, DbObjectType, etc.)
│   │   ├── types_test.go       # Pruebas de nombres calificados y constantes
│   │   └── extractors/         # Patrón Strategy por motor
│   │       ├── extractor.go    # Interfaz Extractor
│   │       ├── sqlserver.go    # Extractor SQL Server (SPs, Tablas, Columnas, Funciones, Triggers, Vistas)
│   │       ├── mysql.go        # Extractor MySQL / MariaDB
│   │       ├── postgres.go     # Extractor PostgreSQL
│   │       └── extractor_test.go # Pruebas de la factoría New()
│   └── exporter/               # Escritura de archivos .sql con sanitización de nombres
│       ├── exporter.go
│       └── exporter_test.go    # Pruebas unitarias
├── frontend/                   # UI React 19 + Tailwind CSS + Lucide Icons
│   ├── src/
│   │   ├── App.jsx             # Vista principal con barra de herramientas, selector de tipo y estado
│   │   ├── style.css           # Estilos globales y paleta oscura
│   │   ├── components/
│   │   │   ├── ConnectionDialog.jsx # Modal de conexión y pestañas Nueva / Recientes
│   │   │   ├── ObjectTable.jsx      # Tabla filtrable, ordenable con selección múltiple
│   │   │   └── ExportBar.jsx        # Barra de progreso reactiva a eventos Wails
│   │   └── wailsjs/            # Bindings y runtime generados automáticamente
└── build/
    ├── bin/
    │   └── sp-extractor.exe    # Binario final para Windows (~18 MB)
    └── windows/
        └── icon.ico            # Ícono oficial de SpExtractor
```

---

## Cómo Ejecutar en Modo Desarrollo

```powershell
cd sp-extractor-wails
wails dev
```
Esto inicia Vite con **Hot Module Replacement (HMR)** para el frontend y recompilación automática al editar código en Go.

---

## Cómo Compilar el Ejecutable Final

```powershell
cd sp-extractor-wails
wails build -clean
```
El ejecutable generado se ubicará en:
`sp-extractor-wails/build/bin/sp-extractor.exe`

---

## Cómo Ejecutar las Pruebas

```powershell
cd sp-extractor-wails
go test -v ./...
```
