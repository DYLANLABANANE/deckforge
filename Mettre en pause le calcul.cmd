@echo off
rem Met en pause le recalcul Deckforge : arrête les calculs en cours. Tout ce qui est fait reste sauvegardé ;
rem « Reprendre le calcul.cmd » repart au dernier point sauvegardé.
powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='node.exe' or Name='bash.exe'\" | Where-Object { $_.CommandLine -match 'tools[/\\](night\.sh|tiers|pairs|ladder|winrates|population|patch|build)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; 'arrete : ' + $_.ProcessId }"
echo Calcul en pause. Double-clique sur "Reprendre le calcul.cmd" pour continuer.
pause
