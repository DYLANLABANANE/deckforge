#!/usr/bin/env bash
# Recalcul complet : base la plus large et la plus représentative possible (plusieurs heures).
#  1. tier list (qualité precise, 3 decks par carte) et duos (60 meilleures cartes) contre les decks les plus joués
#  2. ladder : 3000 joueurs, 4 tours de « jeu fictif » (chacun s'adapte à la méta moyenne des joueurs de son niveau)
#  3. tier list et duos recalculés contre la population finale
#  4. winrates de toute la base (20 000 parties par deck), notes de patch, construction du site
# usage: bash tools/night.sh            recalcul complet depuis le début
#        bash tools/night.sh --resume   reprend où il s'était arrêté : les étapes finies sont sautées, et chaque étape
#                                       reprend elle-même au dernier point sauvegardé (carte, paire, joueur, deck)
# Journal des étapes : tools/night.log ; étapes terminées : tools/night.state (une par ligne, avec la version).
set -e
cd "$(dirname "$0")/.."
VER=$(node -e "console.log(require('./data/cards.fr.json').version)")
RESUME=""; [ "$1" = "--resume" ] && RESUME=1
if [ -z "$RESUME" ]; then : > tools/night.log; : > tools/night.state; rm -f src/*.partial.json src/ladder_progress.json; fi
step() { echo "[$(date +%H:%M)] $1" | tee -a tools/night.log; }
# run <nom> <commande…> : lance l'étape sauf si elle est déjà terminée pour cette version
run() {
  local name="$1"; shift
  if grep -qx "$VER $name" tools/night.state 2>/dev/null; then step "$name : déjà fait"; return; fi
  step "$name"
  "$@"
  echo "$VER $name" >> tools/night.state
}
LADDER_FLAG=""; [ -n "$RESUME" ] && LADDER_FLAG="--resume"
ARCHIVE=$(cat tools/last_archive.txt 2>/dev/null || echo archive/spamdex-1.20)
run "tier list (precise)"            bash -c "node tools/tiers.js precise 3 > tools/tiers.log 2>&1"
run "duos (60 cartes)"               bash -c "node tools/pairs.js 60 fast > tools/pairs.log 2>&1"
run "ladder (3000 joueurs, 4 tours)" bash -c "node tools/ladder.js 3000 4 normal 30 $LADDER_FLAG >> tools/ladder.log 2>&1"
run "tier list finale"               bash -c "node tools/tiers.js precise 3 > tools/tiers2.log 2>&1"
run "duos finaux"                    bash -c "node tools/pairs.js 60 fast > tools/pairs2.log 2>&1"
run "winrates (20 000 parties)"      bash -c "node tools/winrates.js 20000 400 8000 > tools/winrates.log 2>&1"
run "notes de patch"                 bash -c "node tools/patch.js $ARCHIVE > tools/patch.log 2>&1"
run "construction"                   bash -c "node tools/build.js >> tools/night.log 2>&1"
step "TERMINÉ"
