// Joueurs « à thème » du ladder (modèle 2, voir tools/ladder.js) : ils ne cherchent pas le meilleur deck de leur
// collection, ils montent un deck autour d'un élément avec les cartes qui leur plaisent, et le gardent.
// Attrait d'une carte, deux modes (CASUAL.appeal) :
//  - 'tier' (par défaut) : la force connue de la carte (tier list), b propre au joueur ; calé sur les replays du joueur
//    (force et thème des decks adverses) ;
//  - 'real' : ce que font vraiment les joueurs, sa popularité en face dans de vraies parties (src/barometre.json,
//    « Baromètre SPAM, stats de la communauté (non officiel) », Peto_SPAM) divisée par la part des joueurs simulés qui
//    la possèdent (une commune est jouée plus souvent qu'une légendaire même à attrait égal) ; cartes sans données :
//    attrait médian. Popularité des cartes juste (corrélation 0,96 avec le Baromètre) mais decks trop faibles (6 % contre
//    le ladder optimisé, 19 % pour les vrais adversaires) : il manque les associations de cartes (duos).
// Nombre de cartes du thème : 4 (p4), 3 (p3), 2 (p2), sinon 1, le reste parmi toute la collection.
const CASUAL = {
  share: process.env.CASUAL_SHARE != null ? +process.env.CASUAL_SHARE : 0.95, beta: 2.5,
  // attrait des cartes : 'tier' (force connue, calé sur les replays) ou 'real' (popularité du Baromètre ; donne la bonne
  // popularité des cartes mais des decks trop faibles tant que les associations de cartes ne sont pas modélisées)
  appeal: process.env.CASUAL_APPEAL || 'tier',
  betaReal: process.env.CASUAL_BETA_REAL != null ? +process.env.CASUAL_BETA_REAL : 0, // préférence pour les cartes fortes, en plus de la popularité réelle
  p4: process.env.CASUAL_P4 != null ? +process.env.CASUAL_P4 : 0.19, p3: process.env.CASUAL_P3 != null ? +process.env.CASUAL_P3 : 0.24, p2: 0.27
};

// attrait de chaque carte (index = idx de la carte) ; mode 'real' (Baromètre) ou 'tier' (z-score de la force connue)
function appealTable(cards, cols, baro, tiers) {
  const tw = cards.map(d => (tiers && tiers.cards[d.id] ? tiers.cards[d.id].wr : null));
  const ok = tw.filter(x => x != null), m = ok.reduce((s, x) => s + x, 0) / (ok.length || 1);
  const sd = Math.sqrt(ok.reduce((s, x) => s + (x - m) ** 2, 0) / (ok.length || 1)) || 1;
  const z = tw.map(x => (x == null ? -1 : (x - m) / sd));
  if (baro && baro.cards && CASUAL.appeal === 'real') {
    const own = new Array(cards.length).fill(0);
    for (const c of cols) for (const o of c.owned) own[o.idx]++;
    const a = cards.map((d, i) => { const b = baro.cards[d.id]; return b && b.pop > 0 ? b.pop / Math.max(own[i] / cols.length, 0.01) : null; });
    const known = a.filter(x => x != null).sort((x, y) => x - y), med = known.length ? known[Math.floor(known.length / 2)] : 1;
    return { mode: 'real', a: a.map(x => (x == null ? med : x)), z };
  }
  return { mode: 'tier', z };
}

// deck à thème du joueur p (rng : générateur propre au joueur) ; renvoie les cartes (objets du moteur) et leurs talents débloqués
function casualDeck(col, rng, table, cards) {
  const u = rng(); // goût du joueur pour les cartes fortes (0 … 1), tiré dans les deux modes
  const app = idx => (table.mode === 'real' ? table.a[idx] * Math.exp(CASUAL.betaReal * u * table.z[idx]) : Math.exp(CASUAL.beta * u * table.z[idx]));
  const own = col.owned.map(o => ({ d: cards[o.idx], u: o.unlocked, a: app(o.idx) }));
  const byEl = {}; own.forEach(o => { (byEl[o.d.element] || (byEl[o.d.element] = [])).push(o); });
  const els = Object.keys(byEl), sumA = l => l.reduce((s, o) => s + o.a, 0);
  const pick = (list, n, out) => {
    const pool = list.filter(o => !out.includes(o));
    while (n-- > 0 && pool.length) { let r = rng() * sumA(pool), i = 0; for (; i < pool.length - 1; i++) { r -= pool[i].a; if (r <= 0) break; } out.push(pool.splice(i, 1)[0]); }
  };
  let r = rng() * els.reduce((t, e) => t + sumA(byEl[e]), 0), el = els[0];
  for (const e of els) { r -= sumA(byEl[e]); if (r <= 0) { el = e; break; } }
  const x = rng(), k = x < CASUAL.p4 ? 4 : x < CASUAL.p4 + CASUAL.p3 ? 3 : x < CASUAL.p4 + CASUAL.p3 + CASUAL.p2 ? 2 : 1;
  const out = [];
  pick(byEl[el], k, out);
  pick(own, 4 - out.length, out);
  return { defs: out.map(o => o.d), unlocked: out.map(o => o.u) };
}

module.exports = { CASUAL, appealTable, casualDeck };
