# Suggested commands (Windows ; Bash = Git Bash, PowerShell 5.1 disponible)
- `node tools/build.js` — régénère Deckforge.html, dist/, site/.
- `node tools/smoke.js` — test rapide du moteur (vitesse, durée des parties).
- `node tools/trace.js "C1,C2,C3,C4" "C1,..."` — trace une partie tour par tour.
- `node tools/update.js --check | (rien) | --run quick | --run full | --force` — mise à jour SpamDex (voir `mem:pipeline`).
- `bash tools/night.sh` (complet, efface les états) / `bash tools/night.sh --resume` (reprend).
- Étapes isolées : `node tools/tiers.js precise 3`, `node tools/pairs.js 60 fast`, `node tools/ladder.js 3000 4 normal 30 [--resume]`, `node tools/winrates.js 20000 400`, `node tools/patch.js archive/spamdex-<ver>`.
- Pause/reprise pour l'utilisateur : `Mettre en pause le calcul.cmd` / `Reprendre le calcul.cmd`.
- Windows : lancer un calcul détaché qui survit à la session via PowerShell `Start-Process -WindowStyle Hidden` sur bash.exe ; tuer un calcul : filtrer `Get-CimInstance Win32_Process` par CommandLine `tools[/\\](night.sh|tiers|pairs|ladder|winrates|...)` (ce que fait le .cmd de pause).
- `gh` : `C:\Program Files\GitHub CLI\gh.exe` (pas toujours dans le PATH de Git Bash).
