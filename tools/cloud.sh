#!/usr/bin/env bash
# Recalcul complet réparti sur plusieurs machines (GitHub Actions, voir .github/workflows/update.yml).
# Mêmes étapes et mêmes réglages que tools/night.sh (à garder identiques) :
#   bash tools/cloud.sh <étape> part <i> <N>   calcule la part i (0 … N-1) de l'étape → parts/<étape>.<i>.json
#   bash tools/cloud.sh <étape> merge          réunit les parts (parts/<étape>.*.json) et écrit le résultat de l'étape
# étapes, dans l'ordre : tiers1 pairs1 ladder1 ladder2 ladder3 ladder4 tiers2 pairs2 winrates
# SCALE=test : réglages minuscules pour tester la chaîne en quelques minutes.
set -e
cd "$(dirname "$0")/.."
STEP="$1"; MODE="$2"; I="$3"; N="$4"
if [ "$SCALE" = test ]; then T="fast 1"; P="8 fast"; L="120 normal 10"; W="400 40 200"
else T="precise 3"; P="60 fast"; L="3000 normal 30"; W="20000 400 8000"; fi
set -- $L; LP=$1; LQ=$2; LK=$3
case "$STEP" in
  tiers*)   CMD="node tools/tiers.js $T";                                   PART=src/tiers.partial.json ;;
  pairs*)   CMD="node tools/pairs.js $P";                                   PART=src/pairs.partial.json ;;
  ladder*)  CMD="node tools/ladder.js $LP ${STEP#ladder} $LQ $LK --resume"; PART=src/ladder_progress.json ;;
  winrates) CMD="node tools/winrates.js $W";                                PART=src/winrates.partial.json ;;
  *) echo "étape inconnue : $STEP" >&2; exit 1 ;;
esac
mkdir -p parts
if [ "$MODE" = part ]; then
  rm -f "$PART"
  SHARD="$I/$N" $CMD
  mv "$PART" "parts/$STEP.$I.json"
elif [ "$MODE" = merge ]; then
  node tools/shards.js "$PART" parts/"$STEP".*.json
  $CMD
else
  echo "mode inconnu : $MODE (part ou merge)" >&2; exit 1
fi
