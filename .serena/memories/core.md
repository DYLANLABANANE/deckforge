# Deckforge — core

SPAM (jeu de cartes, Ticroco) : optimiseur de decks de 4 cartes par simulation Monte-Carlo. Projet de fan, UI et textes en français.

## Source map
- `src/engine.js` — moteur d'une partie : `load(data)` compile le SpamDex (`compileCard/Ability/Skill/Talent`), `playGame(deckA, deckB, opts)`, IA (`chooseEnemy`, `estDmg`, `threat`), Tox/boutique (`shop`, `placeTox`, `toxCtx`), Gel (`freeze`, `breakIce`), RNG `mulberry32` via `seed()`.
- `src/optimizer.js` — `optimize` (pré-filtre solo → proxy interactif `makeProxy` → marginales/paires → recherche locale → `evalVs` → passes de talents), `improveDeck`, `rolesOf`, `winrateTable`, `computeMeta`. Profils `QUALITY` fast/normal/precise.
- `src/app.js|app.html|app.css` — UI ; `tools/build.js` injecte tout dans `app.html` via des marqueurs `/*CSS*/ /*DATA*/ /*META*/ /*TIERS*/ /*WINRATES*/ /*POP*/ /*PATCH*/ /*ASSETS*/ /*ENGINE*/ /*OPTIMIZER*/ /*APP*/`.
- `src/*.json` — résultats précalculés (meta, tiers, pairs, population, winrates, patch, real_decks) embarqués au build. Générés par `tools/`, ne pas éditer à la main (sauf `real_decks.json`).
- `data/cards.fr.json` — SpamDex brut (source https://www.spamgame.com/data/index.json) ; `assets/` miniatures.
- `archive/spamdex-<ver>/` — données + winrates de la version précédente (pour les notes de patch) ; `tools/last_archive.txt` pointe la dernière.
- `tools/` — pipeline de calcul (parallèle via `pool.js` + `worker.js`) et outillage de patch ; détails : `mem:pipeline`.

## Invariants
- `engine.js` et `optimizer.js` sont des IIFE UMD (`module.exports` en Node, `root.SpamEngine` / `root.SpamOptimizer` dans le navigateur) : pas de `require` de modules externes, pas de dépendances npm, pas de `new Function`/`eval` (CSP du site).
- Les valeurs de jeu (PV, dégâts, recharges, valeurs de talents via `tv(c, effect, défaut)`, dégâts du Gel `GEL_DMG`) sont lues dans le SpamDex ; seules les *mécaniques* nouvelles exigent du code.
- Toute optimisation de performance du moteur doit garder les résultats bit-identiques (empreinte d'un banc déterministe avant/après) ; voir `mem:conventions` pour les pièges V8.
- Rôles de carte (carry/support/soigneur/tank) doivent rester cohérents avec le kit (`rolesOf` vérifie l'éligibilité).
- Cartes « gardées » (`must`/`locked`) : jamais remplacées par `optimize`/`improveDeck`.

Stack et versions : `mem:tech_stack`. Commandes : `mem:suggested_commands`. Fin de tâche : `mem:task_completion`. Pipeline de recalcul, reprise et mise à jour de patch : `mem:pipeline`.
