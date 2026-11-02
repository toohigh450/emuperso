@echo off
setlocal
if not exist "%~dp0real-n64\lancer.bat" (
  echo Le ZIP doit etre extrait completement avant le lancement.
  echo Le dossier real-n64 est manquant a cote de ce fichier.
  pause
  exit /b 1
)
call "%~dp0real-n64\lancer.bat"
exit /b %errorlevel%
