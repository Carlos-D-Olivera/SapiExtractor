# 🗄️ SapiExtractor — Extractor de Objetos, Generador DDL y Entorno SQL

**SapiExtractor**  es una aplicación de escritorio nativa, moderna y de alto rendimiento diseñada para la administración ágil de bases de datos relacionales. Permite conectarse a múltiples motores, explorar y extraer definiciones completas de objetos de base de datos (**Stored Procedures, Tablas, Vistas, Funciones, Triggers y Columnas**), ejecutar consultas SQL interactivas, analizar relaciones entre tablas y generar scripts de datos `INSERT` en segundos.

Desarrollada con **Wails v2**, **Go 1.22+**, **React 19**, **Tailwind CSS** y **CodeMirror 6**, genera un binario nativo independiente para Windows de solo **~18 MB**, **sin requerir Java, JVM ni dependencias pesadas**.

---

## 🎯 Características Principales

### ⚡ Extracción y Exploración Masiva de Objetos
- **Soporte Multi-Objeto:** Extracción precisa de Stored Procedures, Tablas, Vistas, Funciones escalares / de tabla, Triggers y definiciones DDL de Columnas.
- **Rendimiento de Alta Escala:** Carga diferida (*lazy loading*), paginación optimizada y caché en memoria de definiciones para manejar miles de objetos sin degradar la interfaz.
- **Búsqueda Instantánea con Debounce:** Filtro en tiempo real por nombre de objeto o esquema resuelto directamente en base de datos.
- **Exportación Asíncrona por Lotes:** Selección individual o masiva (*Seleccionar Todos*) con exportación concurrente a archivos `.sql` independientes, barra de porcentaje en tiempo real y posibilidad de cancelación inmediata.
- **DDL Limpio e Inteligente:** Generación con validaciones condicionales `IF EXISTS DROP ... GO` para objetos programables, `IF NOT EXISTS` para tablas y scripts autocontenidos de alteración para columnas.

### 👁️ Vista Previa y Acciones Rápidas
- **Inspección Inmediata:** Vista previa con resaltado de sintaxis SQL del objeto seleccionado sin necesidad de abrir herramientas externas.
- **Acciones en Un Clic:**
  - 📋 **Copiar:** Copia la definición completa con su encabezado condicional al portapapeles.
  - 💾 **Guardar Como:** Exporta el objeto seleccionado como un archivo `.sql` individual.
  - 🚀 **Abrir en Editor:** Abre el script en el editor predeterminado del sistema operativo (SSMS, VS Code, Azure Data Studio, etc.).

### 📝 Espacio de Trabajo de Consultas (Query Workspace)
- **Editor SQL Multi-Pestaña:** Editor moderno impulsado por **CodeMirror 6** con resaltado de sintaxis, numeración de líneas y atajos de teclado (`F5` o `Ctrl + Enter` para ejecutar).
- **Ejecución Asíncrona Cancelable:** Ejecución en segundo plano con temporizador de duración en milisegundos, indicador de filas afectadas y cancelación activa de consultas en curso (`CancelQuery`).
- **Múltiples ResultSets:** Soporte nativo para visualizar múltiples conjuntos de resultados tabulares simultáneamente, con detección de tipos de datos de columnas y visualización distinguida de valores `NULL`.
- **Generador de Scripts INSERT:** Modal para convertir los resultados de cualquier consulta en sentencias `INSERT` listas para migración o seeding, incluyendo:
  - Tamaño de lote configurable (*Batch size*).
  - Soporte para `SET IDENTITY_INSERT ON/OFF`.
  - Detección automática de tipos de datos.
  - Opción de limpieza previa con `DELETE FROM`.

### ⚡ Autocompletados y Snippets Dinámicos (AutoCompletes)
- **Expansión con TAB:** Escribe un alias corto y expándelo al instante presionando `TAB`.
- **Posicionamiento Inteligente del Cursor (`#`):** Define dónde quedará el cursor tras la expansión del snippet mediante el comodín `#`.
- **Selección Automática de Texto:** Configura texto para que quede seleccionado automáticamente tras la expansión y pueda reemplazarse inmediatamente.
- **Resaltado Visual:** Palabras clave con autocompletados registrados destacadas visualmente en el editor.
- **Gestor Modal:** Interfaz para crear, editar y eliminar tus snippets personalizados.

### 🕸️ Visualizador de Relaciones y Generador de Scripts (Relations Panel)
- **Grafo de Dependencias:** Inspecciona claves foráneas (FKs) entrantes y salientes a partir de una tabla semilla.
- **Expansión por Profundidad:** Configura el nivel de profundidad (`depth`) para rastrear relaciones complejas en cascada.
- **Detalle de Columnas:** Visualización de columnas, tipos de datos, llaves primarias (PK) y llaves foráneas (FK).
- **Generador Automático de Scripts de Tabla:**
  - **DDL:** `CREATE TABLE`, índices, claves primarias y claves foráneas.
  - **DML:** Plantillas autogeneradas de `SELECT`, `INSERT`, `UPDATE` y `DELETE`.

### 🔌 Gestión de Conexiones Multimotor
- **Historial Persistente:** Guarda servidores, credenciales y bases de datos recientes para conexión rápida en un clic.
- **Exploración de BD:** Detección y listado de todas las bases de datos disponibles en el servidor seleccionado.
- **Soporte de Instancias:** Compatible con instancias nombradas de SQL Server (`SERVIDOR\INSTANCIA`), puertos personalizados y modos de autenticación SQL / Windows.

---

## 🗃️ Motores de Base de Datos Soportados

| Motor | Driver de Go | Funcionalidades |
|---|---|---|
| **Microsoft SQL Server** | `github.com/microsoft/go-mssqldb` | SPs, Tablas, Vistas, Funciones, Triggers, Columnas, Relaciones FK, DDL/DML, Query Workspace |
| **MySQL / MariaDB** | `github.com/go-sql-driver/mysql` | SPs, Tablas, Vistas, Funciones, Triggers, Columnas, Query Workspace |
| **PostgreSQL** | `github.com/jackc/pgx/v5` | SPs / Funciones, Tablas, Vistas, Triggers, Columnas, Query Workspace |

---

## 🛠️ Stack Tecnológico

- **Backend:** [Go](https://go.dev/) (1.22+) con [Wails v2](https://wails.io/)
- **Frontend:** [React 19](https://react.dev/), [Vite 7](https://vitejs.dev/), [Tailwind CSS 3.4](https://tailwindcss.com/)
- **Editor de Código:** [CodeMirror 6](https://codemirror.net/) con soporte SQL y autocompletados
- **Iconos:** [Lucide React](https://lucide.dev/)

---

## 🚀 Inicio Rápido y Desarrollo

### Prerrequisitos
1. **Go 1.22 o superior:** [Descargar Go](https://go.dev/dl/)
2. **Node.js (v20+ LTS) y npm:** [Descargar Node.js](https://nodejs.org/)
3. **Wails CLI v2:**
   ```powershell
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   ```
   Verifica tu entorno con:
   ```powershell
   wails doctor
   ```

### 💻 Ejecutar en Modo Desarrollo (Live Reload / HMR)
```powershell
cd sp-extractor-wails
wails dev
```
Permite modificar el frontend en React o el backend en Go con recarga en caliente automática.

### 🧪 Ejecutar Pruebas Unitarias
```powershell
cd sp-extractor-wails
go test -v ./...
```

### 📦 Compilar Binario de Producción (.exe)
```powershell
cd sp-extractor-wails
wails build -clean
```
El ejecutable binario optimizado para Windows se generará en:
```text
sp-extractor-wails/build/bin/SapiExtractor.exe
```

---

## 📁 Estructura del Proyecto

```text
SpExtractor/
├── CONTRIBUTING.md                 # Guía para desarrolladores y colaboradores
├── LICENSE                         # Licencia del proyecto (GPL-3.0)
├── README.md                       # Documentación principal del repositorio
├── SpExtractor.ico                 # Icono del aplicativo
└── sp-extractor-wails/             # Aplicación de escritorio (Wails + Go + React)
    ├── app.go                      # Métodos del backend expuestos hacia el frontend
    ├── app_test.go                 # Pruebas unitarias del puente Wails
    ├── main.go                     # Punto de entrada e inicialización de la ventana nativa
    ├── wails.json                  # Configuración de Wails v2 (versión, empaquetado, etc.)
    ├── pkg/
    │   ├── config/                 # Almacenamiento local del historial de conexiones
    │   └── db/                     # Conectores de base de datos y modelos
    │       ├── conn.go             # Apertura y pool de conexiones multimotor
    │       ├── types.go            # Modelos unificados (DbObject, SchemaModel, etc.)
    │       ├── extractors/         # Estrategias de extracción por motor (SQL Server, MySQL, Postgres)
    │       └── scriptgen/          # Generadores de DDL, DML e INSERT masivos
    └── frontend/                   # Interfaz de usuario (React 19 + Tailwind CSS)
        ├── src/
        │   ├── App.jsx             # Componente raíz y control de vistas
        │   └── components/
        │       ├── AutocompletesModal.jsx   # Gestor de snippets y autocompletados
        │       ├── ConnectionDialog.jsx     # Diálogo de conexión y selección de BD
        │       ├── ExportBar.jsx            # Barra de exportación con progreso
        │       ├── InsertScriptModal.jsx    # Generador de INSERT a partir de consultas
        │       ├── ObjectTable.jsx          # Tabla paginada de objetos con filtros
        │       ├── PreviewPanel.jsx         # Vista previa DDL y acciones rápidas
        │       ├── QueryWorkspace.jsx       # Espacio de trabajo de consultas SQL
        │       ├── RelationsPanel.jsx       # Diagrama de relaciones y dependencias FK
        │       ├── ScriptsPanel.jsx         # Panel de scripts de tablas
        │       └── SqlEditor.jsx            # Editor SQL basado en CodeMirror 6
        ├── package.json
        └── vite.config.js
```

---

## 🔄 Flujo de Trabajo Recomendado

1. **Conexión:** Abre la aplicación, selecciona el motor de base de datos e ingresa los datos de conexión (o elige una del historial). Haz clic en **Conectar / Listar BD** y selecciona tu base de datos.
2. **Exploración:** Filtra por tipo de objeto (**Stored Procedures, Tablas, Vistas, Funciones, Triggers, Columnas**) y busca por nombre en tiempo real.
3. **Vista Previa y Copia:** Selecciona cualquier objeto para inspeccionar su código SQL directamente, copiarlo o abrirlo en tu editor de cabecera.
4. **Exportación Masiva:** Selecciona los objetos deseados o pulsa *Seleccionar Todos*, elige la carpeta de destino y presiona **Exportar a SQL**.
5. **Consultas SQL:** Abre el apartado de **Consultas**, escribe sentencias SQL con soporte de snippets `TAB`, ejecuta con `F5` y genera scripts `INSERT` a partir de los resultados con un solo clic.
6. **Relaciones FK:** Explora la estructura y claves foráneas de cualquier tabla con el visualizador de relaciones y genera plantillas DDL/DML instantáneamente.

---

## 📚 Enlaces de Interés

- [Guía de Contribución (CONTRIBUTING.md)](file:///c:/Users/Usuario/Desktop/SpExtractor/CONTRIBUTING.md)
- [Licencia del Proyecto (LICENSE)](file:///c:/Users/Usuario/Desktop/SpExtractor/LICENSE)
