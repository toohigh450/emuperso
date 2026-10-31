@echo off
setlocal
cd /d "%~dp0"
py -3 tools\fetch_runtime.py --verify-only
if errorlevel 1 (
  echo Preparation requise : py -3 tools\fetch_runtime.py
  pause
  exit /b 1
)
echo Ouvrir Google Chrome sur http://127.0.0.1:8770/
echo Ctrl+C pour arreter le serveur local.
py -3 tools\serve.py
