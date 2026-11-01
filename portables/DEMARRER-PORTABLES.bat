@echo off
chcp 65001 >nul
title Portables - serveur local
cd /d "%~dp0"
echo Demarrage de Portables...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serveur.ps1"
if errorlevel 1 (
  echo.
  echo Le serveur PowerShell n a pas demarre.
  where python >nul 2>&1 && (
    echo Essai avec Python...
    start "" "http://127.0.0.1:8765/"
    python -m http.server 8765 --bind 127.0.0.1
  ) || (
    echo Aucune solution de secours trouvee. Voir LISEZMOI.md.
    pause
  )
)
