// Calcule la « méta » (decks forts du pool complet) par itérations successives et l'écrit dans src/meta.json.
// usage: node tools/meta.js [quality=normal] [rounds=4]
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const O = require('../src/optimizer.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));
O.setYield(false);

(async () => {
  const quality = process.argv[2] || 'normal';
  const rounds = +(process.argv[3] || 4);
  const t0 = Date.now();
  let last = '';
  // départ : méta + ladder existants (s'ils existent) pour ne pas perdre les synergies déjà trouvées
  let start = null;
  const metaPath = path.join(__dirname, '../src/meta.json');
  if (fs.existsSync(metaPath)) {
    const old = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    const byId = {}; E.DB.cards.forEach(d => { byId[d.id] = d; });
    start = old.decks.concat(old.ladder || []).filter(d => d.cards.every(id => byId[id]))
      .map(d => d.cards.map((id, i) => ({ card: byId[id].idx, talent: d.talents[i] || 0 })));
    // + les meilleurs decks de la tier list (souvent des synergies que la recherche globale rate)
    const tp = path.join(__dirname, '../src/tiers.json');
    if (fs.existsSync(tp)) {
      const tiers = JSON.parse(fs.readFileSync(tp, 'utf8'));
      const seen = new Set();
      const top = Object.values(tiers.cards).sort((a, b) => b.wr - a.wr).filter(t => {
        const k = t.cards.slice().sort().join(); if (seen.has(k)) return false; seen.add(k); return t.cards.every(id => byId[id]);
      }).slice(0, 10);
      start = top.map(t => t.cards.map((id, i) => ({ card: byId[id].idx, talent: t.talents[i] || 0 }))).concat(start);
    }
  }
  const res = await O.computeMeta({ quality, rounds, start }, (f, m) => {
    const k = m.split(':')[0];
    if (k !== last) { last = k; console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${m}`); }
  });
  // classement final de la méta par round-robin
  const decks = res.decks;
  const G = decks.map(d => d.map(x => ({ card: E.DB.cards[x.card], talent: x.talent })));
  const scores = [];
  for (let i = 0; i < G.length; i++) {
    const r = await O.evalVs(G[i], G.filter((_, j) => j !== i), 30, {}, false);
    scores.push({ i, wr: r.wr });
  }
  scores.sort((a, b) => b.wr - a.wr);
  const out = {
    version: E.DB.version, generated: new Date().toISOString(), quality, rounds,
    decks: scores.map(s => ({ wr: +s.wr.toFixed(3), cards: decks[s.i].map(x => E.DB.cards[x.card].id), talents: decks[s.i].map(x => x.talent) }))
  };
  fs.writeFileSync(path.join(__dirname, '../src/meta.json'), JSON.stringify(out, null, 1));
  console.log(`\nMéta (${((Date.now() - t0) / 1000).toFixed(0)} s) :`);
  for (const s of scores) console.log(`${(s.wr * 100).toFixed(1)}%  ` + decks[s.i].map(x => E.DB.cards[x.card].name + (x.talent ? ` [${E.DB.cards[x.card].talents[x.talent - 1].name}]` : '')).join(' + '));
})();
