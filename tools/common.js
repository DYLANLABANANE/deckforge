// Outils partagés des scripts de calcul : niveaux de joueurs, adversaires réalistes tirés de la population.
const fs = require('fs');
const path = require('path');

// niveaux de joueurs selon le nombre de cartes obtenues (≈ un tiers chacun avec des collections log-uniformes 20–800)
const LEVELS = [{ name: 'Débutants', maxDraws: 70 }, { name: 'Intermédiaires', maxDraws: 235 }, { name: 'Confirmés', maxDraws: Infinity }];
const lvlOf = draws => LEVELS.findIndex(l => draws < l.maxDraws);

// calcul réparti sur plusieurs machines (tools/cloud.sh, GitHub Actions) : avec SHARD=i/N, un script ne calcule que
// les éléments k tels que k % N === i, sauvegarde son fichier de reprise et s'arrête sans écrire le résultat final.
// tools/shards.js réunit ensuite les fichiers de reprise des machines ; relancé sans SHARD, le script trouve tout
// déjà calculé et écrit le résultat final.
const SHARD = (m => (m ? { i: +m[1], n: +m[2] } : null))(/^(\d+)\/(\d+)$/.exec(process.env.SHARD || ''));
const mine = k => !SHARD || k % SHARD.n === SHARD.i;

const readSrc = f => { const p = path.join(__dirname, '../src', f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };

// adversaires réalistes de la population (d'un niveau, ou de tous si level < 0) : les decks optimisés les plus joués
// et un échantillon régulier des decks « à thème », pondérés par le nombre de joueurs (optimizer popGauntlet) ;
// à défaut, les decks de la méta à poids égaux
function gauntletFrom(pop, meta, byId, k, level) {
  const conv = d => d.cards.map((id, i) => ({ card: byId[id].idx, talent: (d.talents && d.talents[i]) || 0 }));
  const ok = d => d.cards.every(id => byId[id]);
  if (pop && pop.decks && pop.decks.length >= 10) {
    // niveau demandé mais population sans niveaux (ancien format) ou trop peu de decks : tous les joueurs
    if (level >= 0 && pop.decks.filter(d => d.nb && d.nb[level] > 0).length < 5) level = -1;
    const list = pop.decks.filter(ok).map(d => ({
      cards: d.cards, talents: d.talents,
      n: level >= 0 ? (d.nb ? d.nb[level] : 0) : d.n,
      nc: level >= 0 ? (d.ncb ? d.ncb[level] : 0) : (d.nc || 0)
    })).filter(d => d.n > 0);
    const g = require('../src/optimizer.js').popGauntlet(list, k || 30);
    return { decks: g.decks.map(conv), weights: g.weights, source: 'population' };
  }
  const list = meta.decks.filter(ok);
  return { decks: list.map(conv), weights: list.map(() => 1 / list.length), source: 'méta' };
}

module.exports = { LEVELS, lvlOf, readSrc, gauntletFrom, SHARD, mine };
