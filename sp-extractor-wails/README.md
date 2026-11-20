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
## Búsqueda y navegación en SQL

- **Ctrl+F** abre el buscador arriba a la derecha del editor o visor. Las coincidencias se muestran en amarillo; Enter/F3 avanza, Shift+Enter/Shift+F3 retrocede y Escape cierra. El editor permite desplegar los controles de reemplazo.
- El navegador derecho, de 26 px de ancho, sustituye la barra vertical: arrastra el control o pulsa la franja para desplazarte sin cambiar la selección. También admite rueda y las teclas de desplazamiento; la barra horizontal se conserva. Muestra coincidencias amarillas, líneas añadidas/modificadas verdes y eliminaciones rojas. Pulsa una marca para ir a su línea, incluso si estaba plegada. Si hay varias marcas en un mismo punto, los clics sucesivos recorren sus destinos.
- Los cambios se comparan con el contenido **al abrir la pestaña**. Guardar o cambiar de pestaña conserva las marcas; volver al texto inicial las elimina. Una nueva apertura establece una nueva referencia.
- Los procedimientos en `EXEC`, `EXECUTE` o `CALL` se subrayan **solo al pasar el puntero**. Haz clic o usa Alt+Enter con el cursor en el nombre para abrir la definición. Si hay varios esquemas, elige el procedimiento. Los comentarios, cadenas y destinos de otras bases no se convierten en vínculos.
- El menú contextual usa el portapapeles nativo de Wails y muestra los errores de pegado. Ctrl+V sigue disponible. Si cambias de pestaña o modificas la selección mientras se lee el portapapeles, se cancela el pegado pendiente.

Para validar el frontend: `npm test`, `npm run test:e2e` y `npm run build` desde `frontend/`. Las pruebas E2E usan Microsoft Edge y un servidor local; sus respuestas de Wails son simuladas. El portapapeles del sistema y una conexión real deben comprobarse también en la aplicación nativa.
