// Compare le ladder simulé (src/population.json, src/winrates.json) aux vraies parties du Spamomètre (ex-Baromètre SPAM)
// (src/barometre.json : « Spamomètre, stats de la communauté (non officiel) », Peto_SPAM), carte par carte :
//   popularité = part des decks joués qui contiennent la carte (Spamomètre : « popularité en face ») ;
//   victoires  = winrate moyen des decks joués qui contiennent la carte (Spamomètre : victoires quand elle est jouée).
// Puis rang par rang (Bronze → Légende) contre chaque niveau simulé (débutants, intermédiaires, confirmés).
// usage: node tools/barometre.js
const fs = require('fs');
const path = require('path');
const rd = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
const pop = rd('src/population.json'), W = rd('src/winrates.json'), B = rd('src/barometre.json');
const key = ids => ids.slice().sort().join();
const wrOf = new Map(W.decks.map(d => [key(d.cards), d]));
// popularité et victoires simulées des cartes, pour un poids de deck donné (n : tous niveaux, nb[l] : niveau l)
function simCards(weight, wr) {
  const tot = pop.decks.reduce((s, d) => s + weight(d), 0);
  const sp = {}, sw = {}, sn = {};
  for (const d of pop.decks) {
    const n = weight(d), e = wrOf.get(key(d.cards)), w = e && wr(e);
    for (const id of d.cards) {
      sp[id] = (sp[id] || 0) + n / tot;
      if (w != null) { sw[id] = (sw[id] || 0) + n * w; sn[id] = (sn[id] || 0) + n; }
    }
  }
  return { pop: id => sp[id] || 0, win: id => (sn[id] ? sw[id] / sn[id] : null) };
}
const corr = (x, y) => { const n = x.length, mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n; let a = 0, b = 0, c = 0; for (let i = 0; i < n; i++) { a += (x[i] - mx) * (y[i] - my); b += (x[i] - mx) ** 2; c += (y[i] - my) ** 2; } return a / Math.sqrt(b * c); };
const pct = x => (x == null ? '  —  ' : (x * 100).toFixed(1).padStart(5) + ' %');
const f2 = x => (isNaN(x) ? '  — ' : x.toFixed(2).padStart(5));
// corrélations popularité / victoires entre des cartes réelles et une simulation
function compare(cards, S, minGames) {
  const rows = Object.entries(cards).map(([id, b]) => ({ name: b.name, rp: b.pop, sp: S.pop(id), rw: b.win, sw: S.win(id), games: b.games }));
  const V = rows.filter(r => r.rw != null && r.sw != null && r.games >= minGames);
  return { rows, V, cp: corr(rows.map(r => r.rp), rows.map(r => r.sp)), cw: V.length > 4 ? corr(V.map(r => r.rw), V.map(r => r.sw)) : NaN };
}
const all = compare(B.cards, simCards(d => d.n, e => e.wr), 40);
console.log(`Spamomètre ${B.version} (${B.games} parties, ${B.date}) | ladder : modèle ${pop.model || 1}${pop.casual ? `, attrait ${pop.casual.appeal || 'tier'}` : ''}`);
console.log(`popularité des cartes : corrélation ${all.cp.toFixed(2)}`);
console.log(`victoires des cartes (${all.V.length} cartes, ≥ 40 parties) : corrélation ${all.cw.toFixed(2)}`);
const show = (t, l) => { console.log(t); l.forEach(r => console.log(`  ${r.name.padEnd(34)} jouée réel ${pct(r.rp)} / simulé ${pct(r.sp)}   victoires réel ${pct(r.rw)} / simulé ${pct(r.sw)}`)); };
show('plus faibles en vrai que dans la simulation :', all.V.slice().sort((a, b) => (a.rw - a.sw) - (b.rw - b.sw)).slice(0, 10));
show('plus fortes en vrai que dans la simulation :', all.V.slice().sort((a, b) => (b.rw - b.sw) - (a.rw - a.sw)).slice(0, 10));
if (B.ranks) {
  const lv = (pop.levels || []).map((l, i) => ({ name: l.name, S: simCards(d => (d.nb ? d.nb[i] : 0), e => (e.wrb ? e.wrb[i] : null)) }));
  console.log(`\npar rang (corrélation popularité / victoires des cartes ≥ 20 parties ; colonnes = niveau simulé) :`);
  console.log(`  ${'rang'.padEnd(9)} ${'parties'.padStart(7)}   ${['tous'].concat(lv.map(l => l.name)).map(s => s.slice(0, 13).padEnd(13)).join(' ')}`);
  for (const [r, R] of Object.entries(B.ranks)) {
    const cells = [all].concat(lv).map((l, i) => compare(R.cards, i ? l.S : simCards(d => d.n, e => e.wr), 20)).map(c => `${f2(c.cp)} / ${f2(c.cw)}`.padEnd(13));
    console.log(`  ${r.padEnd(9)} ${String(R.games).padStart(7)}   ${cells.join(' ')}`);
  }
}
