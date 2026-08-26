@echo off
setlocal

REM Ensure this script always runs from repository root.
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%.."

set "PYTHON_EXE=python"
if exist ".venv\Scripts\python.exe" set "PYTHON_EXE=.venv\Scripts\python.exe"
if exist "venv\Scripts\python.exe" set "PYTHON_EXE=venv\Scripts\python.exe"

set "MATCHFILE=data\matches.json"
set "DB_PATH=data\dlns.sqlite3"
set "STATUS_PATH=data\matches_status.json"
set "CACHE_PATH=data\user_cache.json"
set "CONCURRENCY=4"
set "RECHECK=false"

if /I "%~1"=="recheckall" set "RECHECK=true"
if /I "%~1"=="--recheckall" set "RECHECK=true"
if /I "%~1"=="full" set "RECHECK=true"

if not exist "%MATCHFILE%" (
    echo.
    echo Match file not found: %MATCHFILE%
    popd
    exit /b 1
)

echo.
echo ========================================
echo   Updating DB from data\matches.json
echo ========================================
echo DB: %DB_PATH%
echo Match file: %MATCHFILE%
echo Recheck all: %RECHECK%
echo.

%PYTHON_EXE% backend\main.py -matchfile "%MATCHFILE%" -db "%DB_PATH%" -status "%STATUS_PATH%" -cache "%CACHE_PATH%" -concurrency %CONCURRENCY% -recheckall %RECHECK%

if errorlevel 1 (
    echo.
    echo Ingest failed.
    echo Ensure dependencies are installed in the active environment:
    echo   %PYTHON_EXE% -m pip install -r backend\requirements.txt
    popd
    exit /b 1
)

echo.
echo Inferring real lanes from match_paths (lane_real)...
%PYTHON_EXE% backend\main.py -db "%DB_PATH%" -laneinfer true

echo.
echo Backfilling game-reported lanes as fallback (lane)...
%PYTHON_EXE% backend\main.py -db "%DB_PATH%" -lanebackfill true

echo.
echo Backfilling soul sources (player_gold_sources)...
%PYTHON_EXE% backend\main.py -db "%DB_PATH%" -goldbackfill true

echo.
echo Backfilling damage sources (player_damage_sources)...
%PYTHON_EXE% backend\main.py -db "%DB_PATH%" -dmgbackfill true

echo.
echo DB update complete.

popd
endlocal
