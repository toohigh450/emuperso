@echo off
chcp 65001 >nul
title EMUPERSO - Analyse autonome en direct
cd /d "%~dp0"
echo EMUPERSO - Analyse locale, un jeu a la fois, sans IA.
echo Cette fenetre affiche les jeux et leur resultat au fil de l'analyse.
echo Tu peux la reduire et fermer Codex. Garde cette fenetre ouverte.
echo Ctrl+C demande un arret propre. LAB.bat resume reprend les essais restants.
echo.
node "%~dp0cli.mjs" resume %*
echo.
echo Session terminee, en pause ou arretee. Consulter le rapport pour les details.
pause
