# 🗄️ SpExtractor — Extractor de Objetos y Stored Procedures

**SpExtractor** es una herramienta de escritorio de alto rendimiento diseñada para conectarse a motores de bases de datos relacionales, listar sus objetos (**stored procedures, tablas, vistas, funciones, triggers y columnas**) y exportar sus definiciones SQL completas como archivos `.sql` individuales.

> ⚡ **Edición Recomendada — Wails (Go + React + Tailwind):** El proyecto cuenta con una versión moderna en el directorio `sp-extractor-wails/` con recarga en vivo (Hot-Reload), binario nativo independiente para Windows de solo **~18 MB** y **sin requerir la instalación de Java o JDK**. Consulta [README.migration.md](file:///c:/Users/Usuario/Desktop/SpExtractor/README.migration.md) para el detalle completo de la arquitectura y la migración.

---

## 🎯 Propósito y Características

- **Extracción Masiva Rápida:** Conexión a la base de datos y extracción de definiciones DDL en segundos.
- **Soporte Multi-Objeto:** Extracción de Stored Procedures, Tablas, Vistas, Funciones escalares/tabla, Triggers y estructura de Columnas.
- **Historial de Conexiones:** Almacena servidores y bases de datos recientes para conexión instantánea en un clic.
- **Generación DDL Inteligente:** Soporte para sentencias `CREATE TABLE`, `IF NOT EXISTS` / `ALTER` para columnas y validaciones condicionales `IF EXISTS DROP ... GO`.
- **Exportación Asíncrona:** Progreso en tiempo real con barra de porcentaje y reporte de archivos exportados sin bloquear la interfaz.

---

## 🗃️ Motores de Base de Datos Soportados

| Motor | Versión Wails (Go) | Versión Legacy (Java) |
|---|---|---|
| **SQL Server** | `github.com/microsoft/go-mssqldb` | `mssql-jdbc 12.8.1` |
| **MySQL / MariaDB** | `github.com/go-sql-driver/mysql` | `mysql-connector-j 9.1.0` |
| **PostgreSQL** | `github.com/jackc/pgx/v5` | `postgresql 42.7.4` |

---

## 🚀 Versión Wails (Go + React) — *Recomendada*

### Prerrequisitos
- **Go 1.22+**
- **Node.js 20+** y `npm`
- **Wails CLI v2:** `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Ejecutar en Desarrollo (Hot-Reload)
```powershell
cd sp-extractor-wails
wails dev
```
Permite modificar el frontend en React o el backend en Go con recarga instantánea.

### Ejecutar Pruebas
```powershell
cd sp-extractor-wails
go test -v ./...
```

### Compilar el Ejecutable (.exe)
```powershell
cd sp-extractor-wails
wails build -clean
```
El ejecutable optimizado e independiente se generará en:
`sp-extractor-wails/build/bin/sp-extractor.exe` (~18.2 MB).

---

## ☕ Versión Legacy (Java 17 + Swing)

Ubicada en el subdirectorio `sp-extractor-java/`. Para compilar y empaquetar la versión original basada en Java 17 y Swing (FlatMacDarkLaf):

### Prerrequisitos
- **JDK 17 o superior**
- **Apache Maven 3.8+**

### Compilar y Ejecutar
```powershell
# 1. Navegar a la carpeta de la versión Java
cd sp-extractor-java

# 2. Compilar el Uber-JAR
mvn clean package -DskipTests

# 3. Empaquetar el ejecutable nativo (.exe) mediante jpackage
.\build_exe.bat
```

---

## 🔄 Flujo de Uso

1. **Conexión:** Abre la aplicación e ingresa los datos de conexión (o selecciona una conexión previa del historial).
2. **Seleccionar BD:** Haz clic en **Conectar / Listar BD** y selecciona la base de datos de trabajo.
3. **Explorar Objetos:** Filtra por tipo de objeto (Stored Procedures, Tablas, Vistas, etc.) y busca por nombre en tiempo real.
4. **Vista Previa:** Selecciona cualquier objeto para inspeccionar su código SQL directamente en el panel de vista previa o copiarlo al portapapeles.
5. **Exportación:** Selecciona uno o varios objetos, elige la carpeta de destino con el explorador nativo y presiona **Exportar a SQL**.

---

## 📚 Documentación Adicional

- [Plan y Estado de la Migración a Wails (README.migration.md)](file:///c:/Users/Usuario/Desktop/SpExtractor/README.migration.md)
- [Plan de Trabajo Original (migration_plan_wails.md)](file:///c:/Users/Usuario/Desktop/SpExtractor/migration_plan_wails.md)
- [Guía para Contribuidores (CONTRIBUTING.md)](file:///c:/Users/Usuario/Desktop/SpExtractor/CONTRIBUTING.md)
- [Licencia (LICENSE)](file:///c:/Users/Usuario/Desktop/SpExtractor/LICENSE)
