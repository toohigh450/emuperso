@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22.17 ou plus recent requis. Aucun droit administrateur necessaire.
  pause
  exit /b 1
)
node "%~dp0cli.mjs" %*
if errorlevel 1 (
  echo.
  echo Erreur : consulter le message et les journaux de la campagne.
  exit /b 1
)
