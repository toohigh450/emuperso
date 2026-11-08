@echo off
rem Essai des jeux et de leurs cheats sur toutes les consoles du lanceur, sans surveillance.
rem Reprend tout seul apres un plantage ou une fermeture : les jeux deja notes sont sautes.
rem Dossiers des jeux et du site : %LOCALAPPDATA%\emuperso\tests-cheats\dossiers.json (voir l'en-tete
rem de tools\test-cheats-collection.mjs). Resultats : %LOCALAPPDATA%\emuperso\tests-cheats\RESULTATS-CHEATS.md
rem Usage : TESTER-CHEATS.bat [nombre de postes en parallele, 2 par defaut]
setlocal
cd /d "%~dp0"
set "POSTES=%~1"
if "%POSTES%"=="" set "POSTES=2"
set "PW=%LOCALAPPDATA%\emuperso\pw"
set "PLAYWRIGHT_MODULE=%PW%\node_modules\playwright-core\index.mjs"
if not exist "%PLAYWRIGHT_MODULE%" (
  echo Installation de playwright-core hors du depot, sans telecharger de navigateur...
  if not exist "%PW%" mkdir "%PW%"
  call npm install --prefix "%PW%" playwright-core@1.49.1 --no-audit --no-fund
)
:boucle
node tools\test-cheats-collection.mjs --postes=%POSTES%
if errorlevel 1 (
  echo Arret inattendu : reprise dans 15 secondes, la ou l essai s etait arrete.
  timeout /t 15 /nobreak >nul
  goto boucle
)
echo Essai termine. Resume : %LOCALAPPDATA%\emuperso\tests-cheats\RESULTATS-CHEATS.md
pause
