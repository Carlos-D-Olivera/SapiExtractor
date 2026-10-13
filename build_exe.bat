@echo off
echo ============================================
echo   Compilando SpExtractor y creando .exe
echo ============================================

where mvn >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    set MVN_CMD=mvn
) else (
    set "MVN_CMD=C:\Program Files\JetBrains\IntelliJ IDEA 2025.2\plugins\maven-plugin\lib\maven3\bin\mvn.cmd"
)

echo [1/2] Empaquetando JAR con dependencias...
call "%MVN_CMD%" clean package -DskipTests
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la compilacion con Maven.
    pause
    exit /b %ERRORLEVEL%
)

echo [2/2] Generando SpExtractor.exe con icono mediante jpackage...
if exist dist rmdir /s /q dist
jpackage --type app-image ^
  --input target ^
  --name SpExtractor ^
  --main-jar SpExtractor-1.0-SNAPSHOT.jar ^
  --main-class com.cdog.projects.Main ^
  --icon SpExtractor.ico ^
  --dest dist

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo   Exito: Ejecutable creado en:
    echo   dist\SpExtractor\SpExtractor.exe
    echo ============================================
) else (
    echo [ERROR] Fallo la generacion con jpackage.
)
pause
