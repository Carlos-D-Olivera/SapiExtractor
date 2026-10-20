# SpExtractor (Edición Legacy — Java 17 + Swing)

Esta carpeta contiene la implementación original de **SpExtractor** desarrollada en **Java 17** con interfaz gráfica **Swing** y tema oscuro **FlatLaf** (`FlatMacDarkLaf`).

---

## 🏗️ Arquitectura y Estructura

```text
sp-extractor-java/
├── pom.xml                     # Configuración de Maven y dependencias (mssql, mysql, postgresql, flatlaf)
├── build_exe.bat               # Script para generar SpExtractor.exe con jpackage
├── SpExtractor.ico             # Ícono de la aplicación
└── src/
    └── main/
        ├── java/com/cdog/projects/
        │   ├── Main.java                      # Punto de entrada
        │   ├── config/                        # Historial de conexiones guardadas
        │   ├── db/                            # Manejador de conexiones y modelos
        │   │   └── extractors/                # Strategy Pattern (SqlServer, MySql, PostgreSql)
        │   ├── exporter/                      # Exportación asíncrona de SPs a disco
        │   └── ui/                            # Ventana principal, diálogo de conexión y componentes
        └── resources/
            └── icon.png                       # Ícono de ventana
```

---

## 🛠️ Requisitos de Compilación

1. **JDK 17 o superior** (con herramienta `jpackage` disponible en el `PATH`).
2. **Apache Maven 3.8+** (o el Maven integrado en IntelliJ IDEA / Eclipse).

---

## 🚀 Compilar y Ejecutar

### 1. Compilar el Uber-JAR con Maven
```powershell
mvn clean package -DskipTests
```
Esto generará el archivo JAR ejecutable con todas las dependencias en:
`target/SpExtractor-1.0-SNAPSHOT.jar`

### 2. Generar el Ejecutable Nativo de Windows (.exe)
```powershell
.\build_exe.bat
```
El instalador/aplicación nativa se generará en:
`dist\SpExtractor\SpExtractor.exe`
