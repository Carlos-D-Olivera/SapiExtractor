@echo off
setlocal
echo ===================================================
echo           Compilando SpExtractor a .EXE
echo ===================================================

set "JAVA_HOME=C:\Users\Usuario\.jdks\ms-17.0.16"
set "PATH=%JAVA_HOME%\bin;%PATH%"
set "MAVEN_CMD=C:\Program Files\JetBrains\IntelliJ IDEA 2025.2\plugins\maven-plugin\lib\maven3\bin\mvn.cmd"

if not exist "%MAVEN_CMD%" (
    set "MAVEN_CMD=mvn"
)

echo.
echo [1/2] Empaquetando Uber-JAR con Maven...
call "%MAVEN_CMD%" clean package -DskipTests
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo la compilacion con Maven.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo [2/2] Generando ejecutable SpExtractor.exe con jpackage...
if exist "dist" rmdir /s /q "dist"

"%JAVA_HOME%\bin\jpackage.exe" ^
    --type app-image ^
    --input "target" ^
    --name "SpExtractor" ^
    --main-jar "SpExtractor-1.0-SNAPSHOT.jar" ^
    --main-class "com.cdog.projects.Main" ^
    --dest "dist"

if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Fallo jpackage al crear el .exe.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ===================================================
echo   Exito! El ejecutable se encuentra en:
echo   dist\SpExtractor\SpExtractor.exe
echo ===================================================
echo.
pause
