@echo off
setlocal
pushd "%~dp0.."
if not defined PYTHON_EXE (
    set "PYTHON_EXE=python"
    if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
    if exist "venv\Scripts\python.exe" set "PYTHON_EXE=venv\Scripts\python.exe"
)
echo Starting CDN on http://127.0.0.1:5051
"%PYTHON_EXE%" -m waitress --listen=127.0.0.1:5051 --threads=8 cdn_wsgi:app
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
