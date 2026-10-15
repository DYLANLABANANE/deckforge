# Tech stack
- Node.js 18+ (Netlify build : NODE_VERSION 20), JavaScript pur, aucune dépendance npm, pas de package.json.
- Parallélisme : `worker_threads` (`tools/pool.js`, workers = cœurs − 2, env `WORKERS`), priorité processus BELOW_NORMAL.
- Sortie : une seule page HTML autonome (`Deckforge.html`, `dist/artifact.html`, `site/` pour Netlify avec manifest, `sw.js`, `_headers`).
- `tools/make_images.py` : Python + Pillow (icônes, og.png) — rarement utilisé.
- Scripts shell : `tools/night.sh` (bash, Git for Windows `C:\Program Files\Git\bin\bash.exe`), fichiers `.cmd` à la racine pour l'utilisateur.
- Analyse Serena : serveur de langage TypeScript sur les `.js`.
