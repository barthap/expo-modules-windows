@echo off
REM Build script for the HostFXR proof-of-concept
REM Run from the repo root: test\hostfxr-poc\build.bat
REM Or from this directory: build.bat

setlocal enabledelayedexpansion

REM Determine script directory
set "SCRIPT_DIR=%~dp0"
REM Strip trailing backslash to avoid quote-escaping issues
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "REPO_ROOT=%SCRIPT_DIR%\..\.."

echo === Building HostFXR PoC ===
echo.

REM Step 1: Build the C# class library
echo [1/3] Building C# class library...
dotnet build "%REPO_ROOT%\dotnet\Expo.Modules.HostTest\Expo.Modules.HostTest.csproj" -c Release
if %ERRORLEVEL% neq 0 (
    echo ERROR: C# build failed
    exit /b 1
)
echo.

REM Step 2: Configure CMake
echo [2/3] Configuring CMake...
if not exist "%SCRIPT_DIR%\build" mkdir "%SCRIPT_DIR%\build"
cmake -A x64 -S "%SCRIPT_DIR%" -B "%SCRIPT_DIR%\build"
if %ERRORLEVEL% neq 0 (
    echo ERROR: CMake configure failed
    echo.
    echo If nethost was not found, specify it manually:
    echo   cmake -S . -B build -A x64 -DNETHOST_DIR="C:\Program Files\dotnet\packs\Microsoft.NETCore.App.Host.win-x64\9.0.0\runtimes\win-x64\native"
    exit /b 1
)
echo.

REM Step 3: Build C++ project
echo [3/3] Building C++ project...
cmake --build "%SCRIPT_DIR%\build" --config Release
if %ERRORLEVEL% neq 0 (
    echo ERROR: C++ build failed
    exit /b 1
)

echo.
echo === Build complete ===
echo.
echo Executable: %SCRIPT_DIR%\build\Release\hostfxr_poc.exe
echo.
echo To run:
echo   cd %REPO_ROOT%
echo   test\hostfxr-poc\build\Release\hostfxr_poc.exe
echo.
