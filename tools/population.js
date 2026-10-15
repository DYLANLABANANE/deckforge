// Population de joueurs simulés : chacun a une collection tirée selon une progression réaliste
// (les communes tombent plus souvent, les doublons débloquent les talents) et joue le meilleur deck
// de SA collection. Sert de référence au « Winrate » réaliste. Calcul en parallèle (tools/pool.js).
// Écrit src/population.json. usage: node tools/population.js [joueurs = 1000] [qualité = fast]
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const { createPool } = require('./pool.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));

(async () => {
  const players = +(process.argv[2] || 1000);
  const quality = process.argv[3] || 'fast';
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/meta.json'), 'utf8'));
  const tiersPath = path.join(__dirname, '../src/tiers.json');
  const tiers = fs.existsSync(tiersPath) ? JSON.parse(fs.readFileSync(tiersPath, 'utf8')) : { cards: {} };
  const byId = {}; E.DB.cards.forEach(d => { byId[d.id] = d; });
  const conv = d => d.cards.map((id, i) => ({ card: byId[id].idx, talent: d.talents[i] || 0 }));
  const metaG = meta.decks.filter(d => d.cards.every(id => byId[id])).map(conv);
  // decks connus (méta, meilleurs decks de chaque carte, meilleures paires) : testés d'office s'ils sont constructibles
  const pairsPath = path.join(__dirname, '../src/pairs.json');
  const pairs = fs.existsSync(pairsPath) ? JSON.parse(fs.readFileSync(pairsPath, 'utf8')).pairs : [];
  const known = [];
  for (const t of Object.values(tiers.cards)) { known.push(t); (t.alts || []).forEach(a => known.push(a)); }
  pairs.forEach(p => known.push(p));
  const seeds = metaG.concat(known.filter(t => t.cards.every(id => byId[id])).sort((a, b) => b.wr - a.wr).map(conv));

  // poids de tirage par rareté (une orbe donne surtout des communes)
  const W = { common: 1, rare: 0.5, epic: 0.25, legendary: 0.1, divine: 0.03 };
  const cards = E.DB.cards;
  const totalW = cards.reduce((s, d) => s + W[d.rar], 0);
  const starters = cards.filter(d => d.num >= 1 && d.num <= 6);
  E.seed(777);
  const drawCard = () => {
    let r = E.rng() * totalW;
    for (const d of cards) { r -= W[d.rar]; if (r <= 0) return d; }
    return cards[cards.length - 1];
  };
  // collections tirées d'abord (reproductibles), recherches ensuite en parallèle
  const cols = [];
  for (let p = 0; p < players; p++) {
    // nombre de cartes obtenues : log-uniforme entre 20 (débutant) et 800 (joueur très avancé)
    const draws = Math.round(Math.exp(Math.log(20) + E.rng() * (Math.log(800) - Math.log(20))));
    const copies = new Map(starters.map(d => [d.idx, 1]));
    for (let k = 0; k < draws; k++) { const d = drawCard(); copies.set(d.idx, (copies.get(d.idx) || 0) + 1); }
    cols.push({ draws, owned: [...copies].map(([idx, n]) => ({ idx, unlocked: Math.min(3, n - 1, cards[idx].talents.length) })) });
  }
  const pool = createPool();
  console.log(`${players} joueurs, qualité ${quality}, ${seeds.length} decks connus, ${pool.size} workers`);
  const t0 = Date.now();
  let done = 0;
  const out = await Promise.all(cols.map(async (c, p) => {
    const res = await pool.run('optimize', { owned: c.owned, gauntlet: metaG, seeds, quality, seed: 3000 + p });
    const best = res.results[0];
    if (++done % 50 === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${done} / ${players} joueurs`);
    return { draws: c.draws, owned: c.owned.length, cards: best.cards.map(i => cards[i].id), talents: best.talents, wrMeta: +best.wr.toFixed(3) };
  }));
  await pool.close();
  // niveaux de joueurs (taille de la collection) : débutants, intermédiaires, confirmés (≈ un tiers chacun)
  const LEVELS = [{ name: 'Débutants', maxDraws: 70 }, { name: 'Intermédiaires', maxDraws: 235 }, { name: 'Confirmés', maxDraws: Infinity }];
  const lvlOf = draws => LEVELS.findIndex(l => draws < l.maxDraws);
  // regroupement par cartes ; talents = combinaison la plus fréquente dans le groupe ; nb = joueurs par niveau
  const groups = new Map();
  for (const pl of out) {
    const order = pl.cards.map((id, i) => [id, pl.talents[i]]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const key = order.map(x => x[0]).join();
    const g = groups.get(key) || { cards: order.map(x => x[0]), n: 0, nb: LEVELS.map(() => 0), tal: {} };
    g.n++; g.nb[lvlOf(pl.draws)]++;
    const tk = order.map(x => x[1]).join('.');
    g.tal[tk] = (g.tal[tk] || 0) + 1;
    groups.set(key, g);
  }
  for (const g of groups.values()) {
    const best = Object.entries(g.tal).sort((x, y) => y[1] - x[1])[0][0];
    g.talents = best.split('.').map(Number);
    delete g.tal;
  }
  const decks = [...groups.values()].sort((a, b) => b.n - a.n);
  fs.writeFileSync(path.join(__dirname, '../src/population.json'), JSON.stringify({ version: E.DB.version, generated: new Date().toISOString(), players, levels: LEVELS.map((l, i) => ({ name: l.name, maxDraws: isFinite(l.maxDraws) ? l.maxDraws : null, players: out.filter(p => lvlOf(p.draws) === i).length })), decks, players_detail: out.map(p => ({ draws: p.draws, owned: p.owned, lvl: lvlOf(p.draws) })) }));
  console.log(`\n${decks.length} decks différents pour ${players} joueurs. Les plus joués :`);
  decks.slice(0, 12).forEach(d => console.log(`${(d.n / players * 100).toFixed(1)}%  ${d.cards.map(id => byId[id].name).join(' + ')}`));
  console.log(`Terminé en ${((Date.now() - t0) / 1000).toFixed(0)} s`);
})().catch(e => { console.error(e); process.exit(1); });
