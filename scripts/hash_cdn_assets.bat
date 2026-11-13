@echo off
setlocal
pushd "%~dp0.."
if not defined PYTHON_EXE (
    set "PYTHON_EXE=python"
    if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
    if exist "venv\Scripts\python.exe" set "PYTHON_EXE=venv\Scripts\python.exe"
)
"%PYTHON_EXE%" -m scripts.sync_cdn_assets %*
set "RESULT=%ERRORLEVEL%"
popd
exit /b %RESULT%
