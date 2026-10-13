# 🗄️ SpExtractor — Extractor de Stored Procedures

**SpExtractor** es una aplicación de escritorio desarrollada en **Java 17** con **Swing** que permite conectarse a bases de datos, listar sus stored procedures y exportar sus definiciones (código fuente SQL) como archivos `.sql` individuales.

## 🎯 Propósito

Facilitar la extracción masiva del código fuente de stored procedures desde un servidor de base de datos, permitiendo respaldarlos o migrarlos de forma rápida como archivos `.sql`.

## 🗃️ Bases de datos soportadas

| Motor              | Driver                  |
| ------------------ | ----------------------- |
| **SQL Server**     | `mssql-jdbc 12.8.1`    |
| **MySQL / MariaDB**| `mysql-connector-j 9.1.0` |
| **PostgreSQL**     | `postgresql 42.7.4`    |

## 🏗️ Arquitectura

El proyecto sigue una estructura clara por capas:

| Paquete          | Responsabilidad                                          |
| ---------------- | -------------------------------------------------------- |
| `db/`            | Conexión y consulta a bases de datos                     |
| `db/extractors/` | **Strategy Pattern** — un extractor por motor de BD      |
| `exporter/`      | Exportación asíncrona de SPs a disco (vía `SwingWorker`) |
| `config/`        | Historial de conexiones guardadas                        |
| `ui/`            | Interfaz gráfica (ventana principal, diálogos, componentes) |

**Patrón Strategy**: La interfaz `SpExtractorStrategy` define dos métodos (`extractNames` y `fillDefinition`) con implementaciones concretas por motor: `SqlServerExtractor`, `MySqlExtractor` y `PostgreSqlExtractor`.

## 🎨 Interfaz gráfica

- Utiliza **FlatLaf** (`FlatMacDarkLaf`) para un look & feel oscuro moderno estilo macOS.
- Componentes UI personalizados: `GradientPanel`, `IconButton`, `PillActionButton`, `RoundSearchField`, `ConnectionButton`.
- Paleta de colores con acentos azules (`#004A77` / `#C2E7FF`), esquinas redondeadas y tipografía moderna (Google Sans / Inter / Segoe UI).

## 📦 Build y distribución

- **Maven** con **Shade Plugin** para generar un uber-JAR con todas las dependencias incluidas.
- Script `build_exe.bat` que empaqueta el JAR en un **ejecutable nativo de Windows** (`.exe`) mediante `jpackage`, con ícono personalizado.

### Compilar y ejecutar

```bash
# Compilar el JAR
mvn clean package -DskipTests

# Generar el .exe (requiere JDK 17+ con jpackage)
build_exe.bat
```

## 🔄 Flujo de uso

1. El usuario abre la app y se conecta a un servidor de BD mediante un diálogo de conexión.
2. Se listan las bases de datos disponibles en el servidor.
3. Al seleccionar una BD, se extraen los nombres de todos sus stored procedures.
4. El usuario selecciona los SPs deseados y los exporta como archivos `.sql` a una carpeta de destino.
