// Adversaires réels, rang par rang, d'après le Spamomètre (src/barometre.json : « Spamomètre, stats de la communauté
// (non officiel) », Peto_SPAM). La « popularité en face » d'un deck est la part des adversaires croisés qui le jouaient.
// Les decks listés couvrent 10 à 50 % des adversaires selon le rang ; le reste (decks croisés une ou deux fois) est
// représenté par des decks listés aux cartes semblables : leurs poids sont ajustés (ajustement proportionnel itératif)
// pour que la part de chaque carte chez les adversaires soit celle relevée pour le rang.
// Céleste et Légende sont réunis : la Légende a trop peu de parties pour être à part.
const POOLS = [
  { name: 'Tous les rangs', short: 'Tous', ranks: null },
  { name: 'Bronze', short: 'Bronze', ranks: ['Bronze'] },
  { name: 'Argent', short: 'Argent', ranks: ['Argent'] },
  { name: 'Or', short: 'Or', ranks: ['Or'] },
  { name: 'Cristal', short: 'Cristal', ranks: ['Cristal'] },
  { name: 'Céleste et Légende', short: 'Céleste+', ranks: ['Céleste', 'Légende'] }
];
const key = ids => ids.slice().sort().join();

// ok(id) : la carte existe dans le SpamDex utilisé. Renvoie { pools: [{ name, short, games, cover, fit }],
// decks: [{ cards, w: [poids dans chaque pool] }] } (decks triés par poids décroissant dans « Tous les rangs »).
function realPools(B, ok, opts) {
  if (!B || !B.decks || !B.ranks) return null;
  opts = Object.assign({ iters: 200, minW: 2e-4 }, opts);
  // support : tous les decks listés, tous rangs confondus et rang par rang
  const idx = new Map(), decks = [];
  const add = d => {
    if (!d.cards || d.cards.length !== 4 || !d.cards.every(ok)) return;
    const k = key(d.cards);
    if (!idx.has(k)) { idx.set(k, decks.length); decks.push({ cards: d.cards.slice() }); }
  };
  B.decks.forEach(add);
  Object.values(B.ranks).forEach(R => R.decks.forEach(add));
  const cardsIn = {};
  decks.forEach((d, j) => d.cards.forEach(id => (cardsIn[id] = cardsIn[id] || []).push(j)));
  // poids de départ de la queue : popularité tous rangs, plus un peu pour chaque deck listé
  const prior = decks.map(() => 5e-4);
  B.decks.forEach(d => { const j = idx.get(key(d.cards)); if (j != null) prior[j] += d.pop || 0; });

  const pools = [], W = [];
  for (const P of POOLS) {
    const src = P.ranks ? P.ranks.filter(r => B.ranks[r] && B.ranks[r].games).map(r => ({ R: B.ranks[r], g: B.ranks[r].games })) : [{ R: B, g: B.games || 1 }];
    if (!src.length) continue;
    const G = src.reduce((s, x) => s + x.g, 0);
    // tête : decks listés pour ce rang, avec leur part des adversaires ; m : part de chaque carte chez les adversaires
    const head = decks.map(() => 0), m = {};
    for (const { R, g } of src) {
      R.decks.forEach(d => { const j = idx.get(key(d.cards)); if (j != null) head[j] += (d.pop || 0) * g / G; });
      for (const [id, c] of Object.entries(R.cards)) if (ok(id)) m[id] = (m[id] || 0) + (c.pop || 0) * g / G;
    }
    const cover = Math.min(0.95, head.reduce((s, x) => s + x, 0));
    // reste à représenter : part de chaque carte que les decks listés n'expliquent pas
    const r = Object.assign({}, m);
    decks.forEach((d, j) => { if (head[j]) d.cards.forEach(id => { r[id] = (r[id] || 0) - head[j]; }); });
    for (const id in r) r[id] = Math.max(0, r[id]);
    const tail = 1 - cover;
    let t = decks.map((d, j) => (d.cards.every(id => r[id] > 0) ? prior[j] : 0));
    const norm = () => { const s = t.reduce((a, b) => a + b, 0) || 1; t = t.map(x => x * tail / s); };
    norm();
    for (let it = 0; it < opts.iters; it++) {
      for (const id in cardsIn) {
        const cur = cardsIn[id].reduce((s, j) => s + t[j], 0);
        if (cur > 0) { const f = (r[id] || 0) / cur; cardsIn[id].forEach(j => { t[j] *= f; }); }
      }
      norm();
    }
    // qualité de l'ajustement : écart sur la part des cartes chez les adversaires (0 = parfait)
    const w = decks.map((d, j) => head[j] + t[j]);
    const sw = w.reduce((a, b) => a + b, 0) || 1;
    const got = {};
    decks.forEach((d, j) => d.cards.forEach(id => { got[id] = (got[id] || 0) + w[j] / sw; }));
    let err = 0, tot = 0;
    for (const id in m) { err += Math.abs((got[id] || 0) - m[id]); tot += m[id]; }
    pools.push({ name: P.name, short: P.short, games: G, cover: +cover.toFixed(3), fit: +(1 - err / (tot || 1)).toFixed(3) });
    W.push(w.map(x => x / sw));
  }
  // decks gardés : poids suffisant dans au moins un pool ; poids renormalisés
  const keep = decks.map((d, j) => j).filter(j => W.some(w => w[j] >= opts.minW));
  const sums = W.map(w => keep.reduce((s, j) => s + w[j], 0) || 1);
  const out = keep.map(j => ({ cards: decks[j].cards, w: W.map((w, p) => +(w[j] / sums[p]).toFixed(5)) }));
  out.sort((a, b) => b.w[0] - a.w[0]);
  return { pools, decks: out };
}

module.exports = { realPools, POOLS };
