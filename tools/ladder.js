// Ladder simulé : N joueurs aux collections réalistes (fixes d'un tour à l'autre) choisissent leur deck contre les
// decks réellement joués par les joueurs de LEUR niveau. On itère en « jeu fictif » : à chaque tour, chacun s'adapte
// à la méta MOYENNE des tours précédents, et la population publiée est la moyenne de tous les tours. Ça évite les
// oscillations (tout le monde contre Aleera, puis tout le monde contre ses contres…) et approche l'équilibre du ladder.
// Deux sortes de joueurs, calées sur les vrais adversaires du joueur (replays, 21 decks) :
//  - les joueurs « à thème » (CASUAL.share) ne cherchent pas le meilleur deck de leur collection : ils montent un deck
//    autour d'un élément, avec plutôt les cartes réputées fortes (tier list), plus ou moins bien selon le joueur, et le
//    gardent. Calage : comme les vrais adversaires, force 19 % contre le ladder optimisé, 62 % de decks avec 3 cartes ou
//    plus du même élément, 29 % d'un seul élément (les decks optimisés : 50 %, 33 %, 11 %) ;
//  - les autres optimisent et s'adaptent à la méta ; pas parfaits : 60 % jouent leur meilleur deck, 25 % le 2e, 15 % le 3e.
// Calcul en parallèle (tools/pool.js). Écrit src/population.json et src/ladder_rounds.json après chaque tour.
// usage: node tools/ladder.js [joueurs = 3000] [tours = 3] [qualité = normal] [adversaires par niveau = 30] [--resume]
// (variable CASUAL_SHARE pour changer la part de joueurs à thème, 0 = tous optimisent comme avant)
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const O = require('../src/optimizer.js');
const { createPool } = require('./pool.js');
const { LEVELS, lvlOf, readSrc, gauntletFrom, SHARD, mine } = require('./common.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));
{ const w = readSrc('winrates.json'); if (w) O.setTalentPrefs(O.talentPrefsFrom(w)); } // talents des decks à thème

const players = +(process.argv[2] || 3000), rounds = +(process.argv[3] || 3), quality = process.argv[4] || 'normal', K = +(process.argv[5] || 30);
const resume = process.argv.includes('--resume');
const PICK = [0.6, 0.25, 0.15];
const CASUAL = { share: process.env.CASUAL_SHARE != null ? +process.env.CASUAL_SHARE : 0.95, beta: 2.5, p4: 0.19, p3: 0.24, p2: 0.27 };
const cards = E.DB.cards;
const byId = {}; cards.forEach(d => { byId[d.id] = d; });
const conv = d => d.cards.map((id, i) => ({ card: byId[id].idx, talent: (d.talents && d.talents[i]) || 0 }));
const mul = a => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

// collections : tirées une fois pour toutes (mêmes joueurs à chaque tour)
const W = { common: 1, rare: 0.5, epic: 0.25, legendary: 0.1, divine: 0.03 };
const totalW = cards.reduce((s, d) => s + W[d.rar], 0);
const starters = cards.filter(d => d.num >= 1 && d.num <= 6);
E.seed(777);
const drawCard = () => { let r = E.rng() * totalW; for (const d of cards) { r -= W[d.rar]; if (r <= 0) return d; } return cards[cards.length - 1]; };
const cols = [];
for (let p = 0; p < players; p++) {
  const draws = Math.round(Math.exp(Math.log(20) + E.rng() * (Math.log(800) - Math.log(20))));
  const copies = new Map(starters.map(d => [d.idx, 1]));
  for (let k = 0; k < draws; k++) { const d = drawCard(); copies.set(d.idx, (copies.get(d.idx) || 0) + 1); }
  cols.push({ draws, lvl: lvlOf(draws), owned: [...copies].map(([idx, n]) => ({ idx, unlocked: Math.min(3, n - 1, cards[idx].talents.length) })) });
}

// joueurs à thème : tirés une fois pour toutes, deck monté une fois pour toutes (voir casualDeck)
const isCasual = cols.map((c, p) => mul(p * 7907 + 3)() < CASUAL.share);
// deck à thème : élément choisi selon l'attrait des cartes possédées, k cartes de cet élément (4 : p4, 3 : p3, 2 : p2,
// sinon 1), le reste parmi toute la collection ; une carte attire selon exp(b · force connue normalisée), b propre au joueur
function casualDeck(col, p, zt) {
  const rng = mul(p * 104729 + 99991);
  const b = CASUAL.beta * rng();
  const own = col.owned.map(o => ({ d: cards[o.idx], u: o.unlocked, a: Math.exp(b * zt[o.idx]) }));
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
  const defs = out.map(o => o.d);
  return { cards: defs.map(d => d.id), talents: O.guessTalents(defs, out.map(o => o.u)) };
}

function group(out) {
  const groups = new Map();
  for (const pl of out) {
    const order = pl.cards.map((id, i) => [id, pl.talents[i]]).sort((x, y) => (x[0] < y[0] ? -1 : 1));
    const key = order.map(x => x[0]).join();
    const g = groups.get(key) || { cards: order.map(x => x[0]), n: 0, nb: LEVELS.map(() => 0), nc: 0, ncb: LEVELS.map(() => 0), tal: {} };
    g.n++; g.nb[pl.lvl]++;
    if (pl.casual) { g.nc++; g.ncb[pl.lvl]++; }
    const tk = order.map(x => x[1]).join('.');
    g.tal[tk] = (g.tal[tk] || 0) + 1;
    groups.set(key, g);
  }
  for (const g of groups.values()) { g.talents = Object.entries(g.tal).sort((x, y) => y[1] - x[1])[0][0].split('.').map(Number); delete g.tal; }
  return [...groups.values()].sort((a, b) => b.n - a.n);
}

// méta moyenne de plusieurs tours : chaque deck pèse la moyenne de ses joueurs sur ces tours (n et nb fractionnaires)
function mixture(rs) {
  const m = new Map();
  for (const r of rs) for (const d of r) {
    const k = d.cards.join();
    const e = m.get(k) || { cards: d.cards, talents: d.talents, n: 0, nb: LEVELS.map(() => 0), nc: 0, ncb: LEVELS.map(() => 0) };
    e.n += d.n / rs.length; d.nb.forEach((x, b) => { e.nb[b] += x / rs.length; }); e.talents = d.talents;
    e.nc += (d.nc || 0) / rs.length; (d.ncb || []).forEach((x, b) => { e.ncb[b] += x / rs.length; });
    m.set(k, e);
  }
  return [...m.values()].map(e => Object.assign(e, { n: +e.n.toFixed(3), nb: e.nb.map(x => +x.toFixed(3)), nc: +e.nc.toFixed(3), ncb: e.ncb.map(x => +x.toFixed(3)) })).sort((a, b) => b.n - a.n);
}

(async () => {
  const meta = readSrc('meta.json'), tiers = readSrc('tiers.json') || { cards: {} }, pairs = (readSrc('pairs.json') || { pairs: [] }).pairs;
  // tours déjà calculés (reprise) : src/ladder_rounds.json, sinon la population actuelle si elle vient d'un tour du ladder
  const RPATH = process.env.ROUNDS_OUT || path.join(__dirname, '../src/ladder_rounds.json');
  const hist = [];
  if (resume) {
    const saved = fs.existsSync(RPATH) ? JSON.parse(fs.readFileSync(RPATH, 'utf8')) : null;
    if (saved && saved.players === players && saved.version === E.DB.version) saved.rounds.forEach(r => hist.push(r));
    else { const p0 = readSrc('population.json'); if (p0 && p0.round && p0.players === players && p0.version === E.DB.version && !p0.mixedRounds) hist.push(p0.decks); }
  }
  let belief = hist.length ? { decks: mixture(hist) } : readSrc('population.json');
  // decks à thème : la force connue d'une carte = son meilleur deck dans la tier list de cette version
  const tw = cards.map(d => (tiers.cards[d.id] ? tiers.cards[d.id].wr : null));
  const twOk = tw.filter(x => x != null), twM = twOk.reduce((a, b) => a + b, 0) / (twOk.length || 1);
  const twS = Math.sqrt(twOk.reduce((a, b) => a + (b - twM) ** 2, 0) / (twOk.length || 1)) || 1;
  const zt = tw.map(x => (x == null ? -1 : (x - twM) / twS));
  const casualDecks = cols.map((c, p) => (isCasual[p] ? casualDeck(c, p, zt) : null));
  if (!hist.length && CASUAL.share > 0) {
    // premier tour : les optimiseurs s'adaptent déjà aux decks à thème (connus d'avance) et aux decks optimisés précédents
    const cas = group(cols.map((c, p) => (isCasual[p] ? { lvl: c.lvl, cards: casualDecks[p].cards, talents: casualDecks[p].talents, casual: true } : null)).filter(Boolean));
    const old = (belief && belief.decks ? belief.decks : []).filter(d => d.n - (d.nc || 0) > 0);
    const f = (1 - CASUAL.share) * players / (old.reduce((s, d) => s + d.n - (d.nc || 0), 0) || 1);
    belief = { decks: cas.concat(old.map(d => Object.assign({}, d, { n: (d.n - (d.nc || 0)) * f, nb: (d.nb || LEVELS.map(() => 0)).map((x, b) => (x - ((d.ncb || [])[b] || 0)) * f), nc: 0, ncb: LEVELS.map(() => 0) }))) };
  }
  const known = [];
  for (const t of Object.values(tiers.cards)) { known.push(t); (t.alts || []).forEach(a => known.push(a)); }
  pairs.forEach(p => known.push(p));
  ((readSrc('real_decks.json') || {}).decks || []).forEach(d => known.push(Object.assign({ wr: 1 }, d))); // decks réels croisés en partie : testés en priorité
  const pool = createPool();
  console.log(`${players} joueurs (${LEVELS.map((l, b) => `${l.name} ${cols.filter(c => c.lvl === b).length}`).join(', ')}), dont ${isCasual.filter(Boolean).length} à thème, tours ${hist.length + 1} à ${rounds}${hist.length ? ` (reprise après ${hist.length} tour${hist.length > 1 ? 's' : ''})` : ''}, qualité ${quality}, ${pool.size} workers`);
  let prevDeck = null;
  for (let it = hist.length + 1; it <= rounds; it++) {
    const t0 = Date.now();
    // jeu fictif : chacun s'adapte à la méta MOYENNE des tours précédents (amortit les oscillations pierre-feuille-ciseaux)
    const G = LEVELS.map((l, b) => gauntletFrom(belief, meta, byId, K, b));
    // decks connus testés d'office s'ils sont constructibles : méta, decks joués, tier list, paires
    const seeds = meta.decks.filter(d => d.cards.every(id => byId[id])).map(conv)
      .concat((belief && belief.decks ? belief.decks.slice(0, 150) : []).filter(d => d.cards.every(id => byId[id])).map(conv))
      .concat(known.filter(t => t.cards.every(id => byId[id])).sort((a, b) => b.wr - a.wr).map(conv));
    console.log(`\n=== Tour ${it}/${rounds} : adversaires ${G.map(g => g.source + ' (' + g.decks.length + ')').join(' / ')}, ${seeds.length} decks connus`);
    let done = 0;
    // sauvegarde en cours de tour (reprise au joueur près) : valable pour la même version, le même tour et les mêmes tours précédents
    const PROG = path.join(__dirname, '../src/ladder_progress.json');
    const sig = [E.DB.version, players, it, hist.length, quality, K, 'c' + CASUAL.share].join('/');
    const prog = fs.existsSync(PROG) ? JSON.parse(fs.readFileSync(PROG, 'utf8')) : null;
    const saved = prog && prog.sig === sig ? prog.done : {};
    if (Object.keys(saved).length) console.log(`reprise du tour ${it} : ${Object.keys(saved).length} joueurs déjà calculés`);
    let since = 0;
    const out = await Promise.all(cols.map(async (c, p) => {
      if (saved[p]) { done++; return saved[p]; }
      if (!mine(p)) return null;
      if (isCasual[p]) { // deck à thème : le même à chaque tour
        done++;
        const cd = casualDecks[p];
        return (saved[p] = { draws: c.draws, lvl: c.lvl, owned: c.owned.length, cards: cd.cards, talents: cd.talents, rank: -1, casual: true });
      }
      const g = G[c.lvl];
      const res = await pool.run('optimize', { owned: c.owned, gauntlet: g.decks, weights: g.weights, seeds, quality, seed: 3000 + p + 100000 * it });
      // choix du joueur parmi ses meilleurs decks distincts
      const seen = new Set(), opts = [];
      for (const r of res.results) { const k = r.cards.slice().sort((a, b) => a - b).join(); if (!seen.has(k)) { seen.add(k); opts.push(r); } }
      const rng = mul(p * 7919 + it * 104729);
      let x = rng(), rank = 0;
      while (rank < opts.length - 1 && rank < PICK.length - 1 && x >= PICK[rank]) { x -= PICK[rank]; rank++; }
      const best = opts[Math.min(rank, opts.length - 1)];
      if (++done % 100 === 0) console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${done} / ${players} joueurs`);
      const r = { draws: c.draws, lvl: c.lvl, owned: c.owned.length, cards: best.cards.map(i => cards[i].id), talents: best.talents, rank };
      saved[p] = r;
      if (++since >= 25) { since = 0; fs.writeFileSync(PROG, JSON.stringify({ sig, done: saved })); }
      return r;
    }));
    if (SHARD) { fs.writeFileSync(PROG, JSON.stringify({ sig, done: saved })); console.log(`part ${SHARD.i}/${SHARD.n} : ${Object.keys(saved).length} joueurs du tour ${it}`); break; }
    if (fs.existsSync(PROG)) fs.unlinkSync(PROG);
    const roundDecks = group(out);
    hist.push(roundDecks);
    fs.writeFileSync(RPATH, JSON.stringify({ version: E.DB.version, players, rounds: hist }));
    const changed = prevDeck ? out.filter((pl, i) => pl.cards.slice().sort().join() !== prevDeck[i]).length / players : null;
    prevDeck = out.map(pl => pl.cards.slice().sort().join());
    // population publiée : moyenne de tous les tours calculés
    const decks = mixture(hist);
    const pop = {
      version: E.DB.version, generated: new Date().toISOString(), players, round: it, rounds, mixedRounds: hist.length, quality,
      model: CASUAL.share > 0 ? 2 : 1, casual: CASUAL, // modèle 2 : joueurs à thème (calés sur des parties réelles) + joueurs qui optimisent
      levels: LEVELS.map((l, b) => ({ name: l.name, maxDraws: isFinite(l.maxDraws) ? l.maxDraws : null, players: cols.filter(c => c.lvl === b).length })),
      decks, players_detail: out.map(pl => ({ draws: pl.draws, owned: pl.owned, lvl: pl.lvl, rank: pl.rank, casual: !!pl.casual }))
    };
    fs.writeFileSync(process.env.POP_OUT || path.join(__dirname, '../src/population.json'), JSON.stringify(pop));
    belief = pop;
    console.log(`Tour ${it} terminé en ${((Date.now() - t0) / 60000).toFixed(1)} min : ${roundDecks.length} decks joués ce tour, ${decks.length} dans la méta moyenne${changed != null ? `, ${(changed * 100).toFixed(0)} % des joueurs ont changé de deck` : ''}.`);
    LEVELS.forEach((l, b) => {
      const tot = pop.levels[b].players || 1;
      const top = decks.filter(d => d.nb[b] > 0).sort((x, y) => y.nb[b] - x.nb[b]).slice(0, 4);
      console.log(`  ${l.name} (moyenne) : ` + top.map(d => `${(d.nb[b] / tot * 100).toFixed(1)}% ${d.cards.map(id => byId[id].name.split(/[ ,]/)[0]).join('+')}`).join(' | '));
    });
  }
  await pool.close();
})().catch(e => { console.error(e); process.exit(1); });
