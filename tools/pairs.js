// Synergies à deux cartes : pour chaque paire parmi les cartes les plus fortes de la tier list, meilleur deck
// qui contient les deux (recherche avec les deux cartes imposées). Élargit la base de decks évalués et sert
// aux « duos » de l'appli. Calcul en parallèle. Écrit src/pairs.json.
// usage: node tools/pairs.js [cartes = 40] [qualité = fast]
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const { createPool } = require('./pool.js');
const { readSrc, gauntletFrom, SHARD, mine } = require('./common.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));

(async () => {
  const nCards = +(process.argv[2] || 40);
  const quality = process.argv[3] || 'fast';
  const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, '../src', f), 'utf8'));
  const meta = rd('meta.json'), tiers = rd('tiers.json');
  const byId = {}; E.DB.cards.forEach(d => { byId[d.id] = d; });
  // adversaires : les 30 decks les plus joués de la population (à défaut, la méta)
  const G = gauntletFrom(readSrc('population.json'), meta, byId, 30, -1);
  const owned = E.DB.cards.map(d => ({ idx: d.idx, unlocked: 3 }));
  // cartes candidates : les meilleures de la tier list
  const top = Object.entries(tiers.cards).filter(([id]) => byId[id]).sort((a, b) => b[1].wr - a[1].wr).slice(0, nCards).map(([id]) => byId[id]);
  const pairs = [];
  for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) pairs.push([top[i], top[j]]);
  const pool = createPool();
  console.log(`${top.length} cartes → ${pairs.length} paires, qualité ${quality}, adversaires : ${G.source} (${G.decks.length}), ${pool.size} workers`);
  const t0 = Date.now();
  let done = 0;
  // sauvegarde au fil de l'eau (reprise sans tout refaire) : même version, mêmes cartes, même qualité, mêmes adversaires
  const PART = path.join(__dirname, '../src/pairs.partial.json');
  const sig = [E.DB.version, quality, top.map(d => d.num).join('-'), (readSrc('population.json') || {}).generated].join('/');
  const prev = fs.existsSync(PART) ? JSON.parse(fs.readFileSync(PART, 'utf8')) : null;
  const saved = prev && prev.sig === sig ? prev.done : {};
  if (Object.keys(saved).length) console.log(`reprise : ${Object.keys(saved).length} paires déjà calculées`);
  const out = await Promise.all(pairs.map(async ([a, b], k) => {
    if (saved[k]) { done++; return saved[k]; }
    if (!mine(k)) return null;
    const res = await pool.run('optimize', { owned, gauntlet: G.decks, weights: G.weights, quality, must: [a.idx, b.idx], seed: 50000 + k });
    const best = res.results[0];
    if (++done % 25 === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${done} / ${pairs.length} paires`);
    saved[k] = { a: a.id, b: b.id, wr: +best.wr.toFixed(3), cards: best.cards.map(i => E.DB.cards[i].id), talents: best.talents };
    if (done % 25 === 0) fs.writeFileSync(PART, JSON.stringify({ sig, done: saved }));
    return saved[k];
  }));
  if (SHARD) { fs.writeFileSync(PART, JSON.stringify({ sig, done: saved })); await pool.close(); console.log(`part ${SHARD.i}/${SHARD.n} : ${Object.keys(saved).length} paires`); return; }
  if (fs.existsSync(PART)) fs.unlinkSync(PART);
  await pool.close();
  out.sort((x, y) => y.wr - x.wr);
  fs.writeFileSync(path.join(__dirname, '../src/pairs.json'), JSON.stringify({ version: E.DB.version, generated: new Date().toISOString(), cards: top.map(d => d.id), pairs: out }));
  console.log(`src/pairs.json écrit en ${((Date.now() - t0) / 1000).toFixed(0)} s. Meilleures paires :`);
  out.slice(0, 12).forEach(p => console.log(`${(p.wr * 100).toFixed(1)}%  ${byId[p.a].name} + ${byId[p.b].name}  →  ${p.cards.map(id => byId[id].name).join(' + ')}`));
})().catch(e => { console.error(e); process.exit(1); });
