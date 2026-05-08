@echo off
setlocal

REM Ensure this script always runs from repository root, regardless of caller CWD.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."

set "PYTHON_EXE=python"
if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
if exist "venv\Scripts\python.exe" set "PYTHON_EXE=venv\Scripts\python.exe"

set "NPM_EXE=npm"

echo.
echo ========================================
echo   Starting Waitress (Flask)
echo ========================================
echo.

echo [1/3] Preparing frontend build...
pushd frontend
if not exist node_modules (
	echo Installing frontend dependencies...
	call %NPM_EXE% install
	if errorlevel 1 (
		echo.
		echo Frontend dependency install failed.
		popd
		exit /b 1
	)
)

echo Building frontend...
call %NPM_EXE% run build
if errorlevel 1 (
	echo.
	echo Frontend build failed.
	popd
	exit /b 1
)
popd

echo [2/3] Starting Waitress...

echo Listening on http://127.0.0.1:5050
%PYTHON_EXE% -m waitress --listen=127.0.0.1:5050 --threads=12 --channel-timeout=180 wsgi:app

if errorlevel 1 (
	echo.
	echo Failed to start Waitress.
	echo Ensure dependencies are installed in the active environment:
	echo   %PYTHON_EXE% -m pip install -r backend/requirements.txt
	popd
	exit /b 1
)

popd
endlocal
