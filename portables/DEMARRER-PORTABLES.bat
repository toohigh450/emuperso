@echo off
chcp 65001 >nul
title Portables - serveur local
cd /d "%~dp0"
echo Demarrage de Portables...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serveur.ps1"
if not errorlevel 1 exit /b 0
echo.
echo Le serveur PowerShell n a pas demarre.
python -c "import sys; sys.exit(0 if sys.version_info.major == 3 else 1)" >nul 2>&1
if errorlevel 1 goto sans_python
echo Essai avec Python 3...
start "" "http://127.0.0.1:8765/"
python -m http.server 8765 --bind 127.0.0.1
exit /b %errorlevel%
:sans_python
echo Aucun Python 3 executable trouve. Voir LISEZMOI.md.
pause
exit /b 1
