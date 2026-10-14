@echo off
setlocal

REM Run from the repository root, like start_web.bat, so the default DB path and the
REM default _cache output directory resolve the same way wherever this is called from.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."

set "PYTHON_EXE=python"
if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
if exist "venv\Scripts\python.exe" set "PYTHON_EXE=venv\Scripts\python.exe"

"%PYTHON_EXE%" scripts\backup_db.py %*
set "CODE=%ERRORLEVEL%"
popd
exit /b %CODE%
