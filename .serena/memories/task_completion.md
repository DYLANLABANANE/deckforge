# Task completion
Pas de linter, formateur ni suite de tests formelle.
1. Si `src/engine.js` ou `src/optimizer.js` changent : `node tools/smoke.js` (pas d'erreur, vitesse ~0,14 ms/partie) ; pour une optimisation pure, comparer l'empreinte d'un banc déterministe avant/après (doit être identique).
2. Si une mécanique de jeu change : `node tools/update.js --check` puis contrôle de couverture (aucune action/mot-clé inconnu signalé).
3. `node tools/build.js` puis ouvrir `Deckforge.html` (ou `site/index.html`) dans le navigateur : pas d'erreur console, version et bandeau de patch corrects.
4. Ne jamais modifier `tools/night.sh` pendant qu'il tourne (bash le lit au fil de l'eau) : arrêter le calcul d'abord.
5. Commit : résultats `src/*.json` inclus, états de calcul et sorties de build ignorés (`.gitignore`). Dépôt GitHub privé, branche `main`.
