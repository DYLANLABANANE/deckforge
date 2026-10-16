// Compare le ladder simulé (src/population.json, src/winrates.json) aux vraies parties du Baromètre SPAM
// (src/barometre.json : « Baromètre SPAM, stats de la communauté (non officiel) », Peto_SPAM), carte par carte :
//   popularité = part des decks joués qui contiennent la carte (Baromètre : « popularité en face ») ;
//   victoires  = winrate moyen des decks joués qui contiennent la carte (Baromètre : victoires quand elle est jouée).
// usage: node tools/barometre.js
const fs = require('fs');
const path = require('path');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const pop = rd('src/population.json'), W = rd('src/winrates.json'), B = rd('src/barometre.json');
const key = ids => ids.slice().sort().join();
const wrOf = new Map(W.decks.map(d => [key(d.cards), d.wr]));
const tot = pop.decks.reduce((s, d) => s + d.n, 0);
const sp = {}, sw = {}, sn = {};
for (const d of pop.decks) {
  const w = wrOf.get(key(d.cards));
  for (const id of d.cards) {
    sp[id] = (sp[id] || 0) + d.n / tot;
    if (w != null) { sw[id] = (sw[id] || 0) + d.n * w; sn[id] = (sn[id] || 0) + d.n; }
  }
}
const rows = Object.entries(B.cards).map(([id, b]) => ({ name: b.name, rp: b.pop, sp: sp[id] || 0, rw: b.win, sw: sn[id] ? sw[id] / sn[id] : null, games: b.games }));
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const pct = x => (x == null ? '  —  ' : (x * 100).toFixed(1).padStart(5) + ' %');
const V = rows.filter(r => r.rw != null && r.sw != null && r.games >= 40);
console.log(`Baromètre ${B.version} (${B.games} parties, ${B.date}) | ladder : modèle ${pop.model || 1}${pop.casual ? `, attrait ${pop.casual.appeal || 'tier'}` : ''}`);
console.log(`popularité des cartes : corrélation ${corr(rows.map(r => r.rp), rows.map(r => r.sp)).toFixed(2)}`);
console.log(`victoires des cartes (${V.length} cartes, ≥ 40 parties) : corrélation ${corr(V.map(r => r.rw), V.map(r => r.sw)).toFixed(2)}`);
const show = (t, l) => { console.log(t); l.forEach(r => console.log(`  ${r.name.padEnd(34)} jouée réel ${pct(r.rp)} / simulé ${pct(r.sp)}   victoires réel ${pct(r.rw)} / simulé ${pct(r.sw)}`)); };
show('plus faibles en vrai que dans la simulation :', V.slice().sort((a, b) => (a.rw - a.sw) - (b.rw - b.sw)).slice(0, 10));
show('plus fortes en vrai que dans la simulation :', V.slice().sort((a, b) => (b.rw - b.sw) - (a.rw - a.sw)).slice(0, 10));
