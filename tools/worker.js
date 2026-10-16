// Worker de calcul (voir tools/pool.js) : moteur + optimiseur + données chargés une fois par worker.
const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const O = require('../src/optimizer.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));
O.setYield(false);
// talents de départ des recherches : les plus retenus au dernier recalcul (src/winrates.json)
{ const f = path.join(__dirname, '../src/winrates.json'); if (fs.existsSync(f)) O.setTalentPrefs(O.talentPrefsFrom(JSON.parse(fs.readFileSync(f, 'utf8')))); }

const toDeck = d => d.map(x => ({ card: E.DB.cards[x.card], talent: x.talent || 0 }));

const TASKS = {
  // recherche du meilleur deck (mêmes entrées que SpamOptimizer.optimize) ; on ne renvoie que l'essentiel
  async optimize(input) {
    const res = await O.optimize(input);
    return { results: res.results.map(r => ({ cards: r.cards, talents: r.talents, wr: r.wr, rating: r.rating })) };
  },
  // winrate d'un deck contre une population pondérée : parties au prorata de la fréquence (minimum minGames)
  deckWinrate(input) {
    E.seed(input.seed);
    const me = toDeck(input.deck), opp = input.opp.map(toDeck), W = input.oppW, GW = input.gW || W;
    let w = 0, turns = 0, n = 0, wins = 0;
    const per = [];
    const tox = {}, cs = me.map(() => [0, 0, 0, 0]);
    for (let j = 0; j < opp.length; j++) {
      let s = 0;
      const nj = Math.max(input.minGames || 6, Math.round(input.games * GW[j]));
      for (let k = 0; k < nj; k++) {
        const r = E.playGame(me, opp[j], {});
        const v = r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
        s += v; wins += v; turns += r.turns; n++;
        r.cardStats[0].forEach((x, q) => { if (cs[q]) for (let z = 0; z < 4; z++) cs[q][z] += x[z]; });
        for (const key of new Set(r.bought[0])) { const t = tox[key] || (tox[key] = { n: 0, w: 0 }); t.n++; t.w += v; }
      }
      w += W[j] * s / nj;
      per.push(s / nj);
    }
    const base = wins / n;
    const toxKey = Object.entries(tox).map(([k, v]) => ({ k, f: v.n / n, d: v.w / v.n - base }))
      .filter(x => x.f >= 0.08).sort((a, b) => b.d * Math.sqrt(b.f) - a.d * Math.sqrt(a.f)).slice(0, 3)
      .map(x => [x.k, +x.f.toFixed(2), +x.d.toFixed(3)]);
    const ro = O.rolesOf(cs, me.map(x => x.card));
    return { wr: w, turns: turns / n, games: n, per, tox: toxKey, roles: ro.roles, shares: ro.shares };
  },
  // duel A contre B (matrice des matchups)
  duel(input) {
    E.seed(input.seed);
    const A = toDeck(input.a), B = toDeck(input.b);
    let s = 0;
    for (let k = 0; k < input.games; k++) { const r = E.playGame(A, B, {}); s += r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0; }
    return s / input.games;
  }
};

parentPort.on('message', async m => {
  try { parentPort.postMessage({ id: m.id, res: await TASKS[m.fn](m.input) }); }
  catch (e) { parentPort.postMessage({ id: m.id, error: String((e && e.stack) || e) }); }
});
