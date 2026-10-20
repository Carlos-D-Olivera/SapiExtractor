# 🤝 Guía de Contribución para SpExtractor

¡Gracias por tu interés en contribuir a **SpExtractor**! Este documento proporciona pautas y pasos prácticos para configurar el entorno de desarrollo y colaborar eficazmente tanto en la versión moderna basada en **Wails (Go + React)** como en la versión histórica en **Java (Swing)**.

---

## 🧭 Estructura del Repositorio

El proyecto contiene dos implementaciones organizadas en carpetas independientes:
- `sp-extractor-wails/`: **Versión activa recomendada.** Desarrollada con Go 1.22+, Wails v2, React 19, Vite y Tailwind CSS.
- `sp-extractor-java/`: **Versión legacy.** Desarrollada con Java 17, Swing y FlatLaf (mantenida como referencia funcional).

---

## 💻 Entorno de Desarrollo (Versión Wails)

### Requisitos Previos
1. **Go 1.22 o superior:** [Instalar Go](https://go.dev/dl/). Asegúrate de que `C:\Program Files\Go\bin` y `%USERPROFILE%\go\bin` estén en tu variable `PATH`.
2. **Node.js (LTS v20+) y npm:** [Instalar Node.js](https://nodejs.org/).
3. **Wails CLI v2:**
   ```powershell
   go install github.com/wailsapp/wails/v2/cmd/wails@latest
   ```
   Verifica la instalación con:
   ```powershell
   wails doctor
   ```

---

## 🎨 Desarrollo del Frontend (React + Tailwind CSS)

El frontend se encuentra en `sp-extractor-wails/frontend/`.

### Comandos de npm
Dentro de `sp-extractor-wails/frontend`:
- `npm install`: Instala las dependencias de React, Tailwind CSS y Lucide Icons.
- `npm run dev`: Inicia el servidor de desarrollo Vite con Hot Module Replacement (HMR).
- `npm run build`: Compila los assets de producción hacia `frontend/dist/`.

### Convenciones de Frontend
- **Diseño y Estilo:** Usar exclusivamente utilidades de **Tailwind CSS**. Respetar la paleta oscura:
  - Fondo primario: `bg-slate-950` / `bg-slate-900`
  - Contenedores y paneles: `bg-slate-900/60` con bordes `border-slate-800` y efecto glassmorphism.
  - Acentos y selección: Azul FlatLaf (`bg-sky-500` / `text-sky-400`).
- **Iconografía:** Utilizar iconos consistentes de `lucide-react`.
- **Llamadas al Backend:** Las funciones expuestas por Go se importan desde `frontend/src/wailsjs/go/main/App.js` o mediante promesas asíncronas:
  ```javascript
  import { Connect, ListObjects, ExportObjects } from '../wailsjs/go/main/App';
  
  // Ejemplo de llamada
  const objects = await ListObjects("STORED_PROCEDURE");
  ```
- **Eventos en Tiempo Real:** Para operaciones largas (como exportaciones), suscribirse a eventos de Wails:
  ```javascript
  import { EventsOn, EventsOff } from '../wailsjs/runtime/runtime';

  useEffect(() => {
    EventsOn('export:progress', (data) => {
      console.log(`Exportando: ${data.name} (${data.percent}%)`);
    });
    return () => EventsOff('export:progress');
  }, []);
  ```

---

## ⚙️ Desarrollo del Backend (Go)

El backend se organiza en paquetes dentro de `sp-extractor-wails/pkg/`:

- [pkg/db/](file:///c:/Users/Usuario/Desktop/SpExtractor/sp-extractor-wails/pkg/db/):
  - `conn.go`: Configuración y apertura de conexiones SQL Server, MySQL y PostgreSQL.
  - `types.go`: Definiciones del modelo unificado (`DbObject`, `DbObjectType`, `ConnInfo`).
- [pkg/db/extractors/](file:///c:/Users/Usuario/Desktop/SpExtractor/sp-extractor-wails/pkg/db/extractors/):
  - `extractor.go`: Interfaz `Extractor`.
  - Implementaciones por motor: `sqlserver.go`, `mysql.go`, `postgres.go`.
- [pkg/config/](file:///c:/Users/Usuario/Desktop/SpExtractor/sp-extractor-wails/pkg/config/):
  - Persistencia del historial de conexiones recientes en `~/.spextractor/connections.json`.
- [pkg/exporter/](file:///c:/Users/Usuario/Desktop/SpExtractor/sp-extractor-wails/pkg/exporter/):
  - Sanitización de nombres de archivo y persistencia de definiciones en archivos `.sql`.
- [app.go](file:///c:/Users/Usuario/Desktop/SpExtractor/sp-extractor-wails/app.go):
  - Estructura `App` que actúa como puente (bridge) entre Go y el WebView de Wails.

### Cómo agregar un nuevo extractor o funcionalidad a un motor
1. Implementa la interfaz `Extractor` definida en [pkg/db/extractors/extractor.go](file:///c:/Users/Usuario/Desktop/SpExtractor/sp-extractor-wails/pkg/db/extractors/extractor.go):
   ```go
   type Extractor interface {
       ExtractObjects(db *sql.DB, objType db.DbObjectType) ([]db.DbObject, error)
       FillDefinition(db *sql.DB, obj *db.DbObject) error
   }
   ```
2. Agrega las consultas correspondientes en el extractor del motor deseado.
3. Añade la prueba unitaria correspondiente en `extractor_test.go`.

### Ejecutar Pruebas Unitarias
Ejecuta la suite de pruebas de Go en cualquier momento:
```powershell
cd sp-extractor-wails
go test -v ./...
```

---

## 🚀 Flujo de Desarrollo en Vivo (Live Development)

Para desarrollar con recarga en vivo de frontend y backend simultáneamente:
```powershell
cd sp-extractor-wails
wails dev
```
Wails compilará el backend en memoria y abrirá la ventana de la aplicación. Al modificar cualquier archivo `.jsx` o `.css`, los cambios se reflejarán inmediatamente en la interfaz.

---

## 📦 Compilación de Producción

Para generar el ejecutable de distribución para Windows:
```powershell
cd sp-extractor-wails
wails build -clean
```
El ejecutable resultante estará en:
```text
sp-extractor-wails/build/bin/sp-extractor.exe
```

---

## ☕ Versión Legacy (Java 17 / Swing)

Si necesitas compilar o modificar la versión original en Java:
1. Navega a la carpeta correspondiente:
   ```powershell
   cd sp-extractor-java
   ```
2. **Compilar el JAR sombreado (Uber-JAR):**
   ```powershell
   mvn clean package -DskipTests
   ```
3. **Generar el ejecutable `.exe` con `jpackage` (requiere JDK 17+):**
   ```powershell
   .\build_exe.bat
   ```

---

## 🔀 Flujo de Trabajo con Git

1. Crea una rama descriptiva para tu trabajo:
   ```powershell
   git checkout -b feature/nueva-funcionalidad
   # o
   git checkout -b bugfix/correccion-error
   ```
2. Asegúrate de que las pruebas pasen antes de confirmar los cambios:
   ```powershell
   cd sp-extractor-wails
   go test ./...
   npm run build --prefix frontend
   ```
3. Realiza commits claros y concisos siguiendo Conventional Commits (`feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`).
