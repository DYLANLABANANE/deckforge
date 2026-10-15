// Tier list : pour chaque carte, les meilleurs decks (pool complet) qui la contiennent et leur score contre la méta.
// Calcul en parallèle (tools/pool.js). Écrit src/tiers.json. usage: node tools/tiers.js [quality=normal] [decks par carte=3]
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const { createPool } = require('./pool.js');
const { readSrc, gauntletFrom, SHARD, mine } = require('./common.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));

(async () => {
  const quality = process.argv[2] || 'normal';
  const keep = +(process.argv[3] || 3);
  const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '../src/meta.json'), 'utf8'));
  const byId = {}; E.DB.cards.forEach(d => { byId[d.id] = d; });
  // adversaires : les 30 decks les plus joués de la population (à défaut, la méta)
  const G = gauntletFrom(readSrc('population.json'), meta, byId, 30, -1);
  const owned = E.DB.cards.map(d => ({ idx: d.idx, unlocked: 3 }));
  const pool = createPool();
  console.log(`${E.DB.cards.length} cartes, qualité ${quality}, adversaires : ${G.source} (${G.decks.length}), ${pool.size} workers`);
  const out = {};
  const t0 = Date.now();
  let done = 0;
  // sauvegarde au fil de l'eau (reprise sans tout refaire) : même version, même qualité, mêmes adversaires
  const PART = path.join(__dirname, '../src/tiers.partial.json');
  const sig = [E.DB.version, quality, keep, JSON.stringify(G.weights).length, (readSrc('population.json') || {}).generated].join('/');
  const prev = fs.existsSync(PART) ? JSON.parse(fs.readFileSync(PART, 'utf8')) : null;
  if (prev && prev.sig === sig) Object.assign(out, prev.out);
  if (Object.keys(out).length) console.log(`reprise : ${Object.keys(out).length} cartes déjà calculées`);
  await Promise.all(E.DB.cards.map(async d => {
    if (out[d.id]) { done++; return; }
    if (!mine(d.idx)) return;
    const res = await pool.run('optimize', { owned, gauntlet: G.decks, weights: G.weights, quality, must: [d.idx], seed: 9000 + d.idx });
    // meilleurs decks distincts (ensembles de cartes différents)
    const seen = new Set(), decks = [];
    for (const r of res.results) {
      const k = r.cards.slice().sort((a, b) => a - b).join();
      if (seen.has(k)) continue;
      seen.add(k);
      decks.push({ wr: +r.wr.toFixed(3), cards: r.cards.map(i => E.DB.cards[i].id), talents: r.talents });
      if (decks.length >= keep) break;
    }
    out[d.id] = Object.assign({}, decks[0], { alts: decks.slice(1) });
    if (done % 5 === 4) fs.writeFileSync(PART, JSON.stringify({ sig, out }));
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${++done}/${E.DB.cards.length} ${d.name.padEnd(34)} ${(decks[0].wr * 100).toFixed(1)}%  ${decks[0].cards.map(id => byId[id].name).join(' + ')}`);
  }));
  await pool.close();
  if (SHARD) { fs.writeFileSync(PART, JSON.stringify({ sig, out })); console.log(`part ${SHARD.i}/${SHARD.n} : ${Object.keys(out).length} cartes`); return; }
  // paliers par quantiles
  const vals = Object.values(out).map(x => x.wr).sort((a, b) => b - a);
  const q = f => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))];
  const cut = { S: q(0.1), A: q(0.3), B: q(0.55), C: q(0.8) };
  for (const id in out) {
    const w = out[id].wr;
    out[id].tier = w >= cut.S ? 'S' : w >= cut.A ? 'A' : w >= cut.B ? 'B' : w >= cut.C ? 'C' : 'D';
  }
  if (fs.existsSync(PART)) fs.unlinkSync(PART);
  fs.writeFileSync(path.join(__dirname, '../src/tiers.json'), JSON.stringify({ version: E.DB.version, generated: new Date().toISOString(), quality, cut, cards: out }));
  console.log(`src/tiers.json écrit en ${((Date.now() - t0) / 1000).toFixed(0)} s`, cut);
})().catch(e => { console.error(e); process.exit(1); });
