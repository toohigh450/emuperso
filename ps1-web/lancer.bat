@echo off
setlocal
cd /d "%~dp0"
title PS1 Web - demarrage local
echo PS1 Web - preparation et lancement automatiques
echo Aucune commande ni installation de Python n'est necessaire.
echo Gardez cette fenetre ouverte pendant l'utilisation.
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\launch-windows.ps1"
set "PS1_LAUNCH_RESULT=%errorlevel%"
echo.
if not "%PS1_LAUNCH_RESULT%"=="0" (
  echo Le lancement a rencontre un probleme. Le message reste affiche ici.
  echo Les details sont dans real-ps1\cache\launcher-bootstrap.log et launcher.log.
  echo Une capture de cette fenetre permet de diagnostiquer le probleme.
) else (
  echo Le serveur local est arrete.
)
pause
exit /b %PS1_LAUNCH_RESULT%
