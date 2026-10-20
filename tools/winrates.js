// Winrate réaliste de tous les decks : taux de victoire moyen contre la population de joueurs simulés
// (src/population.json), pondéré par la fréquence de chaque deck adverse, et contre les decks vraiment joués en classé,
// rang par rang, d'après le Spamomètre (src/barometre.json, tools/realpool.js). Boutique de Tox simulée dans
// chaque partie ; on relève aussi les Tox qui font le plus gagner chaque deck. Écrit src/winrates.json.
// Base évaluée : méta + meilleurs decks de chaque carte (tier list) + meilleur deck de chaque paire de cartes
// fortes (pairs.json) + decks réels (replays, Spamomètre) + tous les decks de la population. Calcul en parallèle (tools/pool.js).
// usage: node tools/winrates.js [parties par deck = 6000] [parties par duel de la matrice = 200] [parties contre les vrais decks = 8000]
// Les parties sont réparties au prorata de la fréquence de chaque deck adverse (minimum 4), ce qui réduit fortement le bruit.
// Calage « en classé » : les vrais winrates (Spamomètre) sont bien plus serrés qu'en simulation (matchmaking, niveau des
// joueurs) ; on ajuste vrai ≈ a + b × simulé sur les decks qui ont un vrai winrate, pondérés par leur nombre de parties.
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const O = require('../src/optimizer.js');
const { createPool } = require('./pool.js');
const { SHARD, mine } = require('./common.js');
const { realPools } = require('./realpool.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));

const G = +(process.argv[2] || 6000), GM = +(process.argv[3] || 200), GR = +(process.argv[4] || 8000);
const src = f => path.join(__dirname, '../src', f);
const rd = f => JSON.parse(fs.readFileSync(src(f), 'utf8'));
// talents des decks réels (inconnus) : les plus retenus au dernier recalcul
if (fs.existsSync(src('winrates.json'))) O.setTalentPrefs(O.talentPrefsFrom(rd('winrates.json')));
const meta = rd('meta.json');
const tiers = fs.existsSync(src('tiers.json')) ? rd('tiers.json') : { cards: {} };
const pairs = fs.existsSync(src('pairs.json')) ? rd('pairs.json').pairs : [];
// decks réellement croisés en partie (tools : replays du joueur) ; talents inconnus -> choisis par l'optimiseur
const real = fs.existsSync(src('real_decks.json')) ? rd('real_decks.json').decks : [];
// vraies parties de la communauté (Spamomètre, stats de la communauté, non officiel)
const baro = fs.existsSync(src('barometre.json')) ? rd('barometre.json') : null;
const pop = rd('population.json');
const byId = {}; E.DB.cards.forEach(d => { byId[d.id] = d; });
const ok = d => d.cards.every(id => byId[id]);
const conv = d => d.cards.map((id, i) => ({ card: byId[id].idx, talent: d.talents[i] || 0 }));
const guess = ids => O.guessTalents(ids.map(id => byId[id]), [3, 3, 3, 3]);

// adversaires : les decks de la population, pondérés par leur fréquence
const opp = pop.decks.filter(ok);
const nPlayers = opp.reduce((s, d) => s + d.n, 0);
const oppW = opp.map(d => d.n / nPlayers);
// niveaux d'adversaires (population.json récent) : poids de chaque deck adverse dans chaque niveau
const levels = (pop.levels || []).map((l, b) => {
  const tot = opp.reduce((t, d) => t + ((d.nb && d.nb[b]) || 0), 0);
  return Object.assign({}, l, { W: opp.map(d => (tot ? ((d.nb && d.nb[b]) || 0) / tot : 0)) });
}).filter(l => l.W.some(x => x > 0));
// vrais adversaires, rang par rang (à la suite de la population dans la liste des adversaires)
const RP = realPools(baro, id => !!byId[id]);
const realOpp = RP ? RP.decks.map(d => ({ cards: d.cards, talents: guess(d.cards) })) : [];
const nPop = opp.length;
const pools = RP ? RP.pools.map((p, q) => new Array(nPop).fill(0).concat(RP.decks.map(d => d.w[q]))) : [];
const oppG = opp.map(conv).concat(realOpp.map(conv));
const oppWAll = oppW.concat(realOpp.map(() => 0));
// répartition des parties : assez de parties contre les adversaires importants dans au moins un niveau (G parties) ou
// dans au moins un rang (GR parties)
const gW = opp.map((d, j) => Math.max(oppW[j], ...levels.map(l => l.W[j]))).concat(RP ? RP.decks.map(d => Math.max(...d.w) * GR / G) : []);

// decks évalués
const decks = [];
const seen = new Map();
const add = (d, group) => {
  if (!ok(d)) return;
  const key = d.cards.slice().sort().join();
  if (seen.has(key)) return;
  const e = { key, cards: d.cards, talents: d.talents.map(t => t || 0), group };
  seen.set(key, e);
  decks.push(e);
};
meta.decks.forEach(d => add(d, 'meta'));
Object.values(tiers.cards).forEach(t => { add(t, 'tier'); (t.alts || []).forEach(a => add(a, 'tier')); });
pairs.forEach(p => add(p, 'pair'));
real.filter(ok).forEach(d => add({ cards: d.cards, talents: guess(d.cards) }, 'real'));
// decks vraiment joués d'après le Spamomètre (tous rangs confondus et rang par rang)
if (baro) [baro.decks].concat(Object.values(baro.ranks || {}).map(R => R.decks)).forEach(L => (L || []).forEach(d => {
  if (d.cards && d.cards.length === 4 && ok(d)) add({ cards: d.cards, talents: guess(d.cards) }, 'real');
}));
// decks de la population joués en moyenne par au moins 0,6 joueur (méta moyenne du ladder : n fractionnaire)
opp.filter(d => d.n >= 0.6).forEach(d => add(d, 'pop'));
// part de la population qui joue chaque deck (mêmes cartes, talents quelconques)
const popShare = {}, popShareB = levels.map(() => ({}));
opp.forEach((d, j) => {
  const k = d.cards.slice().sort().join();
  popShare[k] = (popShare[k] || 0) + oppW[j];
  levels.forEach((l, b) => { popShareB[b][k] = (popShareB[b][k] || 0) + l.W[j]; });
});

// vrai winrate ≈ a + b × winrate simulé, sur les decks du Spamomètre qui ont un vrai winrate (≥ 15 parties)
function calib(out, sim) {
  if (!baro) return null;
  const by = new Map(out.map(d => [d.cards.slice().sort().join(), d]));
  const pts = [];
  baro.decks.forEach(d => {
    const e = by.get(d.cards.slice().sort().join()), x = e ? sim(e) : null;
    if (d.win != null && typeof x === 'number') pts.push([x, d.win, d.games]);
  });
  if (pts.length < 10) return null;
  const sw = pts.reduce((s, p) => s + p[2], 0);
  const mx = pts.reduce((s, p) => s + p[2] * p[0], 0) / sw, my = pts.reduce((s, p) => s + p[2] * p[1], 0) / sw;
  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach(([x, y, g]) => { sxx += g * (x - mx) ** 2; sxy += g * (x - mx) * (y - my); syy += g * (y - my) ** 2; });
  const b = sxy / sxx, a = my - b * mx;
  if (!(b > 0.05)) return null;
  return { a: +a.toFixed(4), b: +b.toFixed(4), n: pts.length, r: +(sxy / Math.sqrt(sxx * syy)).toFixed(2) };
}

(async () => {
  const pool = createPool();
  console.log(`${decks.length} decks à évaluer, ${opp.length} decks adverses (${nPlayers} joueurs)${RP ? ` + ${realOpp.length} vrais decks (${RP.pools.map(p => p.short).join(', ')})` : ''}, ${G} parties par deck${RP ? ` + ${GR} contre les vrais decks` : ''}, ${pool.size} workers`);
  const t0 = Date.now();
  let done = 0;
  // reprise : résultats déjà calculés pour la même version, la même base et le même nombre de parties
  const PART = src('winrates.partial.json');
  const sig = [E.DB.version, G, opp.length, nPlayers, decks.length, decks.map(d => d.key).join('|').length, RP ? `${realOpp.length}:${GR}:${baro.games}:${baro.date}` : 0].join('/');
  const partial = fs.existsSync(PART) ? JSON.parse(fs.readFileSync(PART, 'utf8')) : null;
  const saved = partial && partial.sig === sig ? partial.done : {};
  if (Object.keys(saved).length) console.log(`reprise : ${Object.keys(saved).length} decks déjà évalués`);
  const savePartial = () => fs.writeFileSync(PART, JSON.stringify({ sig, done: saved }));
  const out = await Promise.all(decks.map(async (d, i) => {
    if (saved[i]) { done++; return saved[i]; }
    if (!mine(i)) return null;
    const r = await pool.run('deckWinrate', { deck: conv(d), opp: oppG, oppW: oppWAll, gW, games: G, minGames: oppG.length > 1000 ? 1 : 4, seed: 20260926 + i });
    if (++done % 50 === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${done} / ${decks.length}`);
    const res = { cards: d.cards, talents: d.talents, group: d.group, wr: +r.wr.toFixed(3), turns: +r.turns.toFixed(1), share: +(popShare[d.key] || 0).toFixed(3), tox: r.tox, roles: r.roles, shares: r.shares };
    if (levels.length) {
      res.wrb = levels.map(l => +l.W.reduce((t, x, j) => t + x * r.per[j], 0).toFixed(3));
      res.shareb = levels.map((l, b) => +(popShareB[b][d.key] || 0).toFixed(3));
    }
    if (pools.length) res.wrr = pools.map(w => +w.reduce((t, x, j) => t + x * r.per[j], 0).toFixed(3));
    saved[i] = res;
    if (done % 50 === 0) savePartial();
    return res;
  }));
  if (SHARD) { savePartial(); await pool.close(); console.log(`part ${SHARD.i}/${SHARD.n} : ${Object.keys(saved).length} decks`); return; }

  // matrice des 20 meilleurs decks, chacun contre chacun
  const top = out.map((d, i) => ({ d, i })).sort((a, b) => b.d.wr - a.d.wr).slice(0, 20);
  const mx = top.map(() => new Array(top.length).fill(null));
  const jobs = [];
  for (let a = 0; a < top.length; a++) for (let b = a + 1; b < top.length; b++) {
    jobs.push(pool.run('duel', { a: conv(top[a].d), b: conv(top[b].d), games: GM, seed: 777 + a * 100 + b }).then(v => { mx[a][b] = +v.toFixed(3); mx[b][a] = +(1 - v).toFixed(3); }));
  }
  await Promise.all(jobs);
  await pool.close();

  // calage « en classé », contre les vrais decks (tous les rangs) et contre les joueurs simulés
  const cal = baro ? { version: baro.version, real: RP ? calib(out, e => (e.wrr ? e.wrr[0] : null)) : null, sim: calib(out, e => e.wr) } : null;
  if (fs.existsSync(PART)) fs.unlinkSync(PART);
  fs.writeFileSync(src('winrates.json'), JSON.stringify({
    format: 3, version: E.DB.version, generated: new Date().toISOString(), games: G, gamesMatrix: GM, gamesReal: RP ? GR : 0, popModel: pop.model || 1,
    players: nPlayers, oppCount: opp.length, levels: levels.map(l => ({ name: l.name, players: l.players })), decks: out, matrix: { idx: top.map(t => t.i), wr: mx },
    real: RP ? { source: baro.source, version: baro.version, date: baro.date, games: baro.games, pools: RP.pools, decks: RP.decks.map((d, j) => ({ cards: d.cards, talents: realOpp[j].talents, w: d.w })) } : null,
    calib: cal,
    talentPrefs: O.talentPrefsFrom({ decks: out }) // talents les plus retenus par carte : départ des prochaines recherches
  }));
  const by = g => out.filter(d => d.group === g).length;
  console.log(`${out.length} decks (méta ${by('meta')}, tier list ${by('tier')}, paires ${by('pair')}, réels ${by('real')}, population ${by('pop')}) évalués en ${((Date.now() - t0) / 1000).toFixed(0)} s. Top 12 :`);
  out.slice().sort((a, b) => b.wr - a.wr).slice(0, 12).forEach(d => console.log(`${(d.wr * 100).toFixed(1)}%  (${(d.share * 100).toFixed(1)}% des joueurs)  ${d.cards.map((id, i) => byId[id].name + ' [' + d.roles[i] + ']').join(' + ')}  · Tox : ${d.tox.map(t => t[0]).join(', ')}`));
  if (RP) RP.pools.forEach((p, q) => {
    const best = out.filter(d => d.wrr).sort((a, b) => b.wrr[q] - a.wrr[q]).slice(0, 3);
    console.log(`contre les vrais decks (${p.name}) : ${best.map(d => `${(d.wrr[q] * 100).toFixed(1)}% ${d.cards.map(id => byId[id].name.split(/[ ,]/)[0]).join('+')}`).join(' | ')}`);
  });
  if (cal) for (const k of ['real', 'sim']) if (cal[k]) console.log(`calage en classé (${k === 'real' ? 'vrais decks' : 'joueurs simulés'}) : vrai ≈ ${cal[k].a} + ${cal[k].b} × simulé (${cal[k].n} decks, corrélation ${cal[k].r})`);
})().catch(e => { console.error(e); process.exit(1); });
