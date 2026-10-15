@echo off
rem Reprend le recalcul Deckforge là où il s'était arrêté (étapes finies sautées, reprise au dernier point sauvegardé).
rem Le calcul tourne en priorité basse : le PC reste utilisable.
cd /d "%~dp0"
title Deckforge - recalcul en cours (fermer cette fenetre = pause)
"C:\Program Files\Git\bin\bash.exe" tools/night.sh --resume
pause
