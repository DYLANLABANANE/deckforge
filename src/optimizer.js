/*
 * Deckforge — recherche du meilleur deck SPAM.
 *
 * Étape 1 : pré-sélection rapide (score « solo » : dégâts × robustesse contre des mannequins), puis recherche
 *           des synergies avec un score interactif (mini-parties contre les adversaires les plus joués) :
 *           valeur de chaque carte, statistiques par paires, recherche locale par échanges de cartes.
 * Étape 2 : les meilleurs candidats affrontent la méta (Monte-Carlo, parties complètes).
 * Étape 3 : réglage des talents par simulation puis évaluation finale précise.
 *
 * Toutes les fonctions longues sont asynchrones et cèdent la main régulièrement :
 * elles tournent aussi bien dans un Web Worker que sur le fil principal.
 */
(function (root) {
  'use strict';
  const E = (typeof module !== 'undefined' && module.exports) ? require('./engine.js') : root.SpamEngine;

  // exhaustive / prune / starts : pré-sélection solo ; refK × refG : mini-parties du score interactif ;
  // pExh : en dessous de ce nombre de combinaisons, toutes passent au score interactif ; s1 / s2 : échantillons
  // aléatoires (collection entière / cartes candidates) ; pCards : cartes candidates ; ls* : recherche locale
  const QUALITY = {
    fast:    { exhaustive: 8000,  prune: 22, starts: 6,  k1: 45,  g2: 4,  k3: 4,  gT: 32, gF: 160, refK: 4, refG: 1, pExh: 2500,  s1: 600,  pCards: 18, soloTop: 120, s2: 500,  lsStarts: 8,  lsSteps: 4, tPass: 1 },
    normal:  { exhaustive: 20000, prune: 26, starts: 10, k1: 100, g2: 6,  k3: 6,  gT: 56, gF: 320, refK: 6, refG: 1, pExh: 6000,  s1: 1400, pCards: 24, soloTop: 250, s2: 1200, lsStarts: 16, lsSteps: 5, tPass: 2 },
    precise: { exhaustive: 40000, prune: 30, starts: 16, k1: 200, g2: 10, k3: 10, gT: 96, gF: 640, refK: 6, refG: 2, pExh: 12000, s1: 2500, pCards: 30, soloTop: 500, s2: 2500, lsStarts: 28, lsSteps: 6, tPass: 2 }
  };

  // générateur aléatoire propre à la recherche (le score interactif réinitialise celui du moteur)
  function mkRng(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Score interactif rapide : refG partie(s) contre chacun des refK adversaires les plus joués, avec les mêmes
  // tirages pour tous les decks (comparaisons appariées) ; victoire + marge de PV. Contrairement au score solo,
  // il voit les dégâts subis, le Gel, les provocations, les morts, les ripostes… (corrélation de rang ≈ 0,8 avec
  // le winrate final, contre ≈ 0,25 pour le score solo, mesuré sur le SpamDex 1.20).
  function makeProxy(gauntlet, weights, Q, opt, seedBase) {
    const idx = gauntlet.map((_, i) => i);
    if (weights && weights.length === gauntlet.length) idx.sort((a, b) => weights[b] - weights[a]);
    const ref = idx.slice(0, Q.refK).map(i => gauntlet[i]);
    const popt = Object.assign({}, opt, { log: false, trace: false });
    return deck => {
      let s = 0;
      for (let k = 0; k < ref.length; k++) {
        for (let g = 0; g < Q.refG; g++) {
          E.seed(seedBase + 7919 * k + 104729 * g);
          const r = E.playGame(deck, ref[k], popt);
          const win = r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
          s += 0.6 * win + 0.4 * (0.5 + (r.hp[0] - r.hp[1]) / 2);
        }
      }
      return s / (ref.length * Q.refG);
    };
  }

  // ------------------------------------------------------ coopération (yield)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let yieldOn = true, lastYield = now(), cancelled = false;
  async function tick() {
    if (cancelled) throw new Error('Calcul annulé');
    if (!yieldOn) return;
    if (now() - lastYield > 30) { await new Promise(r => setTimeout(r, 0)); lastYield = now(); }
  }
  function setYield(v) { yieldOn = v; }
  function cancel() { cancelled = true; }
  function resetCancel() { cancelled = false; }

  // ------------------------------------------------ valeur heuristique des talents
  const TAL = {
    'Cavalerie': 60, 'Baleine bleue': 25, 'Imprudent': 38, 'Blindage F/E': 18, 'Blindage N/T': 18, 'Blindage O/L': 18,
    'Durcissement': 30, 'Resilience': 24, 'Blindage Partagé': 48, 'Depart multi elements': 36, 'Critique': 14,
    'Frappe': 10, 'Vitalite des Ames': 42, 'Armure des Ames': 22, 'OneManArmy': 18, 'Reset ultime': 26, 'Longueur': 14,
    'Transition': 55, 'TToxChanceux': 10, 'Piece magique': 8, 'TPetitPrix': 12, 'A la caisse': 14, 'Heritage': 12,
    'Revalorisation': 22, 'Fortune': 20, '13eme mois': 12, 'Racket': 10, 'Dette': 4, 'Focus': 12, 'Anticipation': 30,
    'Life-8': 30, 'Souffle-8': 18, 'Bombe-8': 26, 'Immunite-8': 12, 'Evolution': 6, 'TRoulette': 12, 'Incisif': 30,
    'BouleDeCrit': 18, 'Affaiblissement': 30, 'Corrosion': 14, 'Erreur Croissante': 14, 'Imprecision': 14,
    'Heure funeste': 18, 'Dernier souffle': 14, 'Virage360': 6, 'Nouvelle vie': 28, 'Nouveau riche': 10, 'TBrut': 24,
    'TAoe_C': 18, 'TAoe_R': 32, 'TAoe_E': 55, 'TChanceVitale': 15, 'TCoeurAcier': 30, 'TInsensibleDisparition': 4,
    'TInsensibleEternite': 5, 'TInversement': -30, 'TMimetisme': 20, 'TPunchingBag': 14, 'TAttackMulticolor': 26,
    'TCoeurMystere': 18, 'Paradoxe': -10, 'Contre': 18, 'TCoeurCorrompu': 22, 'TErosion': 14, 'Reducteur': 10,
    'TRevitalisation': 14, 'SursautVital': 16, 'TPlumePhoenix': 4
  };
  const TERRAIN_EL = { 'Terrain aquatique': 1, 'Terrain enflamée': 0, 'Terrain terrestre': 2, 'Terrain naturel': 3, 'Terrain lumineux': 4, 'Terrain sombre': 5 };
  const COEUR_EL = { 'TCoeurFeu_C': 0, 'TCoeurEau_C': 1, 'TCoeurTerre_C': 2, 'TCoeurNature_C': 3, 'TCoeurLumiere_C': 4, 'TCoeurOmbre_C': 5 };

  let _avgPow = null;
  function avgPowerOf(rar) {
    if (!_avgPow) {
      _avgPow = {};
      for (const r in E.DB.byRar) { const a = E.DB.byRar[r]; _avgPow[r] = a.reduce((s, d) => s + d.power, 0) / a.length; }
    }
    return _avgPow[rar] || 30;
  }
  function talentValue(def, t, prof) {
    let v = TAL[t.id] != null ? TAL[t.id] : 5;
    if (TERRAIN_EL[t.id] != null) v = 7 * 0.1 * prof[TERRAIN_EL[t.id]] * 8 * 0.9;
    else if (COEUR_EL[t.id] != null) v = 0.1 * prof[COEUR_EL[t.id]] * 28 * 0.9;
    else if (t.id === 'Critique') v = 6 + def.pDmg * 0.12;
    else if (t.id === 'Frappe') v = def.abilities.reduce((s, a) => s + a.pDmg * Math.min(1, a.cc / 100), 0) * 1.2;
    else if (t.id === 'TRoulette') v = (def.pDmg + def.pBonus * 6) * 0.12;
    else if (t.id === 'BouleDeCrit') v = 4 + def.pDmg * 0.2;
    else if (/^TAoe/.test(t.id)) v = v * Math.min(2, def.pDmg / 20);
    else if (t.id === 'TBrut') v = 8 + def.pDmg * 0.18;
    else if (t.id === 'Anticipation') v = def.pDmg * 1.8;
    else if (t.id === 'Contre') v = 6 + def.pDmg * 1.2;           // 1.20 : riposte unique sur l'attaquant
    else if (t.id === 'Evolution') v = 4 + def.skills.length * 10; // monte la rareté des passifs d'origine
    else if (t.id === 'Life-8') v = def.hp / 25;
    else if (t.id === 'Paradoxe') v = -def.res.reduce((s, x) => s + x, 0) / 2;
    else if (t.id === 'TInversement') v = def.pHeal > def.pDmg ? def.pHeal * 0.8 - def.pDmg : -30;
    else if (t.id === 'Imprudent') v = 30 + (avgPowerOf(def.rar) - def.power) * 0.5;
    return v;
  }

  function guessTalents(cards, unlockedArr) {
    const prof = [0, 0, 0, 0, 0, 0];
    for (const d of cards) for (let i = 0; i < 6; i++) prof[i] += d.elDmg[i];
    return cards.map((d, i) => {
      const u = Math.min(unlockedArr[i] || 0, d.talents.length);
      let best = 0, bv = 0;
      for (let s = 1; s <= u; s++) {
        const v = talentValue(d, d.talents[s - 1], prof);
        if (v > bv) { bv = v; best = s; }
      }
      return best;
    });
  }

  function mkDeck(cards, talents) { return cards.map((d, i) => ({ card: d, talent: talents[i] || 0 })); }
  function toGauntlet(list) { return list.map(d => d.map(x => ({ card: E.DB.cards[x.card], talent: x.talent || 0 }))); }

  // ------------------------------------------------------------ évaluation
  // weights : poids de chaque adversaire (somme = 1). rating = victoires + petit bonus de marge (PV restants),
  // utilisé pour départager des decks qui perdent (ou gagnent) tous leurs matchs.
  async function evalVs(deck, gauntlet, games, opt, detail, weights) {
    const W = weights && weights.length === gauntlet.length ? weights : gauntlet.map(() => 1 / gauntlet.length);
    let wr = 0, rating = 0, n = 0, turns = 0;
    const per = [];
    const tox = detail ? {} : null;
    const cardDmg = detail ? [0, 0, 0, 0] : null;
    let firstW = 0, firstN = 0, secondW = 0, secondN = 0;
    for (let g = 0; g < gauntlet.length; g++) {
      let wg = 0, rg = 0;
      for (let i = 0; i < games; i++) {
        const r = E.playGame(deck, gauntlet[g], opt);
        const s = r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
        wg += s; rg += s + 0.12 * (r.hp[0] - r.hp[1]); turns += r.turns;
        if (detail) {
          if (r.first === 0) { firstW += s; firstN++; } else { secondW += s; secondN++; }
          for (const k of r.bought[0]) { const t = tox[k] || (tox[k] = { n: 0, w: 0 }); t.n++; t.w += s; }
          r.cardDmg[0].forEach((d, j) => { cardDmg[j] += d; });
        }
        if ((i & 3) === 3) await tick();
      }
      n += games;
      wr += W[g] * wg / games;
      rating += W[g] * rg / games;
      per.push(wg / games);
    }
    const out = { wr, rating, per, turns: turns / n };
    if (detail) {
      out.tox = tox; out.games = n;
      const tot = cardDmg.reduce((a, b) => a + b, 0) || 1;
      out.dmgShare = cardDmg.map(d => d / tot);
      out.firstWr = firstN ? firstW / firstN : null;
      out.secondWr = secondN ? secondW / secondN : null;
    }
    return out;
  }

  // ------------------------------------------------------------- combinaisons
  function* combos(n, k) {
    const idx = [];
    for (let i = 0; i < k; i++) idx.push(i);
    while (true) {
      yield idx.slice();
      let i = k - 1;
      while (i >= 0 && idx[i] === n - k + i) i--;
      if (i < 0) return;
      idx[i]++;
      for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
    }
  }
  function nCk(n, k) { if (k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return Math.round(r); }

  function soloEval(cards, unl, opt) {
    const t = guessTalents(cards, unl);
    const a = E.soloScore(mkDeck(cards, t), opt, 8);
    const b = E.soloScore(mkDeck(cards, t), opt, 8);
    return { score: (a.score + b.score) / 2, talents: t };
  }
  function avg(m) { return m && m.n ? m.s / m.n : 0; }
  function randomSubset(pool, k) {
    const res = [], used = new Set();
    while (res.length < k) { const i = Math.floor(E.rng() * pool.length); if (!used.has(i)) { used.add(i); res.push(pool[i]); } }
    return res;
  }

  // ------------------------------------------------------------- optimisation
  /**
   * input = { owned: [{idx, unlocked}], gauntlet: [[{card, talent}]], opt, quality, must: [idx], seed, keepStage2 }
   */
  async function optimize(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const Q = QUALITY[input.quality || 'normal'];
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    E.seed(input.seed || 12345);
    const pool = input.owned.map(o => ({ def: E.DB.cards[o.idx], unl: o.unlocked || 0 })).filter(p => p.def);
    const must = (input.must || []).filter(i => pool.some(p => p.def.idx === i)).slice(0, 4);
    const gauntlet = toGauntlet(input.gauntlet);
    const W = input.weights;
    if (pool.length < 4) throw new Error('Sélectionne au moins 4 cartes dans ta collection.');

    progress(0.01, 'Pré-sélection des combinaisons…');
    let cand = pool;
    const total = nCk(pool.length, 4);
    const scored = new Map();
    const keyOf = arr => arr.map(p => p.def.idx).sort((a, b) => a - b).join('-');
    const consider = (arr) => {
      const key = keyOf(arr);
      const got = scored.get(key);
      if (got) return got.score;
      if (must.length && !must.every(m => arr.some(p => p.def.idx === m))) { scored.set(key, { arr, score: -1 }); return -1; }
      const r = soloEval(arr.map(p => p.def), arr.map(p => p.unl), opt);
      scored.set(key, { arr, score: r.score, talents: r.talents });
      return r.score;
    };

    if (total > Q.exhaustive) {
      progress(0.02, 'Grande collection : estimation de la valeur de chaque carte…');
      const marg = new Map(pool.map(p => [p.def.idx, { s: 0, n: 0 }]));
      const samples = Math.max(50, Math.min(140, Math.round(11000 / pool.length)));
      const rounds = Math.round(samples * pool.length / 4);
      for (let r = 0; r < rounds; r++) {
        let arr = randomSubset(pool, 4);
        if (must.length) { // force les cartes imposées
          const forced = must.map(m => pool.find(p => p.def.idx === m));
          arr = forced.concat(arr.filter(p => !forced.includes(p))).slice(0, 4);
          if (new Set(arr).size < 4) continue;
        }
        const sc = consider(arr);
        for (const p of arr) { const m = marg.get(p.def.idx); m.s += sc; m.n++; }
        if (r % 100 === 0) { progress(0.02 + 0.06 * r / rounds, 'Estimation de la valeur des cartes…'); await tick(); }
      }
      const ranked = pool.slice().sort((a, b) => avg(marg.get(b.def.idx)) - avg(marg.get(a.def.idx)));
      cand = ranked.slice(0, Q.prune);
      for (const m of must) if (!cand.some(p => p.def.idx === m)) cand.push(pool.find(p => p.def.idx === m));
      for (let s = 0; s < Q.starts; s++) {
        let cur = randomSubset(pool, 4), cs = consider(cur);
        let improved = true, guard = 0;
        while (improved && guard++ < 10) {
          improved = false;
          for (let i = 0; i < 4; i++) {
            for (const p of pool) {
              if (cur.includes(p)) continue;
              const nx = cur.slice(); nx[i] = p;
              const ns = consider(nx);
              if (ns > cs) { cur = nx; cs = ns; improved = true; }
            }
            await tick();
          }
        }
        progress(0.08 + 0.04 * s / Q.starts, 'Pré-sélection : recherche locale…');
      }
    }
    const n1 = nCk(cand.length, 4);
    let done = 0;
    for (const c of combos(cand.length, 4)) {
      consider(c.map(i => cand[i]));
      if (++done % 200 === 0) {
        progress(0.12 + 0.05 * done / n1, `Pré-sélection : ${done.toLocaleString('fr-FR')} / ${n1.toLocaleString('fr-FR')} decks`);
        await tick();
      }
    }
    const solo1 = Array.from(scored.values()).filter(x => x.score >= 0).sort((a, b) => b.score - a.score);

    // ---- étape 1 bis : synergies au score interactif (mini-parties)
    const proxy = makeProxy(gauntlet, W, Q, opt, (input.seed || 12345) + 55);
    const rng = mkRng((input.seed || 12345) * 31 + 17);
    const mustP = must.map(m => pool.find(p => p.def.idx === m));
    const pScored = new Map();
    let nP = 0;
    const evalP = async arr => {
      const key = keyOf(arr);
      const got = pScored.get(key);
      if (got) return got.p;
      if (new Set(arr).size < 4 || !mustP.every(m => arr.includes(m))) return -1;
      const so = scored.get(key);
      const talents = so && so.talents ? so.talents : guessTalents(arr.map(p => p.def), arr.map(p => p.unl));
      const v = proxy(mkDeck(arr.map(p => p.def), talents));
      pScored.set(key, { arr: arr.slice(), talents, p: v, solo: so ? so.score : 0 });
      if ((++nP & 15) === 0) await tick();
      return v;
    };
    const sample = src => { // 4 cartes au hasard dans src, cartes imposées comprises
      const arr = mustP.slice();
      for (let guard = 0; arr.length < 4 && guard < 400; guard++) { const p = src[Math.floor(rng() * src.length)]; if (!arr.includes(p)) arr.push(p); }
      return arr;
    };
    const P0 = 0.17, P1 = 0.5;
    // avec des cartes imposées, seules les combinaisons qui les contiennent comptent
    const rest = pool.filter(p => !mustP.includes(p));
    const eff = mustP.length ? nCk(rest.length, 4 - mustP.length) : total;
    if (eff <= Q.pExh) {
      // petit espace : toutes les combinaisons passent en mini-parties
      let k = 0;
      for (const c of combos(rest.length, 4 - mustP.length)) {
        await evalP(mustP.concat(c.map(i => rest[i])));
        if (++k % 100 === 0) progress(P0 + (P1 - P0) * k / eff, `Synergies : ${k.toLocaleString('fr-FR')} / ${eff.toLocaleString('fr-FR')} decks en mini-parties`);
      }
    } else {
      // a) valeur de chaque carte en interaction (decks tirés au hasard dans toute la collection)
      const margP = new Map(pool.map(p => [p, { s: 0, n: 0 }]));
      for (let i = 0; i < Q.s1; i++) {
        const arr = sample(pool);
        const v = await evalP(arr);
        if (v >= 0) for (const p of arr) { const m = margP.get(p); m.s += v; m.n++; }
        if (i % 50 === 0) progress(P0 + 0.07 * i / Q.s1, 'Synergies : valeur de chaque carte en mini-parties…');
      }
      // b) cartes candidates : les meilleures en interaction, celles des meilleurs decks solo et des decks connus
      const candSet = new Set(mustP);
      pool.slice().sort((a, b) => avg(margP.get(b)) - avg(margP.get(a))).slice(0, Q.pCards).forEach(p => candSet.add(p));
      for (const so of solo1.slice(0, 10)) so.arr.forEach(p => candSet.add(p));
      const inPool0 = new Map(pool.map(p => [p.def.idx, p]));
      let known = 0;
      for (const d of input.gauntlet.concat(input.seeds || [])) {
        if (known >= 8) break;
        if (!d.every(x => inPool0.has(x.card))) continue;
        d.forEach(x => candSet.add(inPool0.get(x.card))); known++;
      }
      const candArr = Array.from(candSet);
      // c) paires de cartes : decks tirés au hasard parmi les candidates
      for (let i = 0; i < Q.s2; i++) {
        await evalP(sample(candArr));
        if (i % 50 === 0) progress(P0 + 0.07 + 0.07 * i / Q.s2, 'Synergies : test des paires de cartes…');
      }
      const pair = new Map();
      const pk = (a, b) => (a.def.idx < b.def.idx ? a.def.idx + '-' + b.def.idx : b.def.idx + '-' + a.def.idx);
      let mean = 0, nm = 0;
      for (const r of pScored.values()) {
        if (r.p < 0) continue;
        mean += r.p; nm++;
        for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
          const k = pk(r.arr[i], r.arr[j]); const m = pair.get(k) || { s: 0, n: 0 }; m.s += r.p; m.n++; pair.set(k, m);
        }
      }
      mean = nm ? mean / nm : 0.5;
      const pm = (a, b) => { const m = pair.get(pk(a, b)); return m ? (m.s + 2 * mean) / (m.n + 2) : mean; }; // moyenne lissée
      // d) points de départ : meilleures paires complétées par leurs meilleurs partenaires + meilleurs decks solo
      const byIdx = new Map(candArr.map(p => [p.def.idx, p]));
      const topPairs = Array.from(pair.keys()).map(k => k.split('-').map(Number)).filter(([a, b]) => byIdx.has(a) && byIdx.has(b))
        .map(([a, b]) => [byIdx.get(a), byIdx.get(b)]).sort((x, y) => pm(y[0], y[1]) - pm(x[0], x[1])).slice(0, Q.lsStarts * 2);
      for (const [a, b] of topPairs) {
        const arr = mustP.slice();
        for (const p of [a, b]) if (!arr.includes(p) && arr.length < 4) arr.push(p);
        while (arr.length < 4) {
          let bp = null, bs = -Infinity;
          for (const c of candArr) { if (arr.includes(c)) continue; const sc = arr.reduce((t, x) => t + pm(c, x), 0); if (sc > bs) { bs = sc; bp = c; } }
          if (!bp) break;
          arr.push(bp);
        }
        await evalP(arr);
      }
      for (const so of solo1.slice(0, Q.soloTop)) await evalP(so.arr);
      progress(P0 + 0.16, 'Synergies : recherche locale…');
      // e) recherche locale : à chaque pas, le meilleur échange d'une carte (hors cartes imposées) parmi les candidates
      const ranked0 = Array.from(pScored.values()).filter(x => x.p >= 0).sort((a, b) => b.p - a.p);
      const starts = [];
      for (const r of ranked0) {
        if (starts.every(st => st.filter(p => r.arr.includes(p)).length <= 2)) starts.push(r.arr);
        if (starts.length >= Q.lsStarts) break;
      }
      for (let st = 0; st < starts.length; st++) {
        let cur = starts[st], cv = await evalP(cur);
        for (let step = 0; step < Q.lsSteps; step++) {
          let best = null, bv = cv;
          for (let i = 0; i < 4; i++) {
            if (mustP.includes(cur[i])) continue;
            for (const p of candArr) {
              if (cur.includes(p)) continue;
              const nx = cur.slice(); nx[i] = p;
              const v = await evalP(nx);
              if (v > bv + 1e-9) { bv = v; best = nx; }
            }
          }
          if (!best) break;
          cur = best; cv = bv;
        }
        progress(P0 + 0.16 + (P1 - P0 - 0.16) * (st + 1) / starts.length, `Synergies : recherche locale ${st + 1} / ${starts.length}`);
      }
    }
    const stage1 = Array.from(pScored.values()).filter(x => x.p >= 0).sort((a, b) => b.p - a.p);
    if (!stage1.length) throw new Error('Aucun deck possible avec ces contraintes.');

    // ---- étape 2 (+ les decks adverses constructibles avec la collection : ils sont testés d'office)
    let k1 = Math.min(Q.k1, stage1.length);
    const inPool = new Map(pool.map(p => [p.def.idx, p]));
    const topKeys = new Set(stage1.slice(0, k1).map(s => keyOf(s.arr)));
    const extra = [];
    // decks adverses + decks connus (input.seeds) constructibles avec la collection
    for (const d of input.gauntlet.concat(input.seeds || [])) {
      if (extra.length >= 40) break;
      if (!d.every(x => inPool.has(x.card))) continue;
      const arr = d.map(x => inPool.get(x.card));
      const key = keyOf(arr);
      if (topKeys.has(key) || new Set(arr).size < 4) continue;
      if (must.length && !must.every(m => arr.some(p => p.def.idx === m))) continue;
      topKeys.add(key);
      extra.push({ arr, solo: 0, talents: guessTalents(arr.map(p => p.def), arr.map(p => p.unl)) });
    }
    const cands2 = stage1.slice(0, k1).concat(extra);
    k1 = cands2.length;
    const stage2 = [];
    for (let i = 0; i < k1; i++) {
      const s = cands2[i];
      const deck = mkDeck(s.arr.map(p => p.def), s.talents);
      E.seed((input.seed || 12345) + 101);   // tirages identiques pour tous les candidats
      const r = await evalVs(deck, gauntlet, Q.g2, opt, false, W);
      stage2.push({ arr: s.arr, talents: s.talents, wr: r.wr, rating: r.rating, solo: s.solo });
      progress(0.5 + 0.25 * (i + 1) / k1, `Simulations contre la méta : ${i + 1} / ${k1} decks`);
    }
    stage2.sort((a, b) => b.rating - a.rating);

    // ---- étape 3
    const k3 = Math.min(Q.k3, stage2.length);
    const finals = [];
    const gT = Math.max(2, Math.round(Q.gT / gauntlet.length));
    for (let i = 0; i < k3; i++) {
      const s = stage2[i];
      const defs = s.arr.map(p => p.def);
      let tal = s.talents.slice();
      // comparaisons appariées : mêmes tirages aléatoires pour chaque variante de talent
      const tuneSeed = (input.seed || 12345) + 7919 * (i + 1);
      const evalT = async tt => { E.seed(tuneSeed); return (await evalVs(mkDeck(defs, tt), gauntlet, gT, opt, false, W)).rating; };
      let bestWr = await evalT(tal);
      const prof = [0, 0, 0, 0, 0, 0];
      for (const d of defs) for (let e = 0; e < 6; e++) prof[e] += d.elDmg[e];
      // réglage carte par carte ; une 2e passe capte les synergies entre talents (le meilleur talent d'une carte
      // peut changer quand celui d'une autre change : deux Cavalerie, Terrains du même élément…)
      for (let pass = 0; pass < (Q.tPass || 1); pass++) {
        let changed = false;
        for (let c = 0; c < 4; c++) {
          const u = Math.min(s.arr[c].unl, defs[c].talents.length);
          if (u < 1) continue;
          for (let t = 0; t <= u; t++) {
            if (t === tal[c]) continue;
            // « sans talent » n'est testé que si le talent courant semble nuisible
            if (t === 0 && tal[c] && talentValue(defs[c], defs[c].talents[tal[c] - 1], prof) > 0) continue;
            const tt = tal.slice(); tt[c] = t;
            const wr = await evalT(tt);
            if (wr > bestWr + 0.015) { bestWr = wr; tal = tt; changed = true; }
          }
          progress(0.75 + 0.22 * (i + (pass * 4 + c + 1) / (4 * (Q.tPass || 1) + 1)) / k3, `Réglage des talents : deck ${i + 1} / ${k3}`);
        }
        if (!changed) break;
      }
      const deck = mkDeck(defs, tal);
      E.seed((input.seed || 12345) + 202);
      const fin = await evalVs(deck, gauntlet, Math.max(4, Math.round(Q.gF / gauntlet.length)), opt, true, W);
      finals.push(resultOf(defs, tal, s.arr.map(p => p.unl), fin, s.solo, opt));
      progress(0.75 + 0.22 * (i + 1) / k3, `Évaluation finale : deck ${i + 1} / ${k3}`);
    }
    finals.sort((a, b) => b.rating - a.rating);
    progress(1, 'Terminé');
    const out = { results: finals, evaluated: scored.size, miniGames: pScored.size, simulated: k1, pool: pool.length };
    if (input.keepStage2) out.stage2 = stage2.slice(k3, k3 + input.keepStage2).map(s => ({ cards: s.arr.map(p => p.def.idx), talents: s.talents, wr: s.wr, rating: s.rating }));
    return out;
  }

  function resultOf(defs, tal, unl, fin, solo, opt) {
    const deck = mkDeck(defs, tal);
    return {
      cards: defs.map(d => d.idx), talents: tal, unlocked: unl, wr: fin.wr, rating: fin.rating, per: fin.per, turns: fin.turns, solo,
      tox: fin.tox, games: fin.games, dmgShare: fin.dmgShare, firstWr: fin.firstWr, secondWr: fin.secondWr,
      stats: deckStats(deck, opt)
    };
  }

  function deckStats(deck, opt) {
    let off = 0, ehp = 0, bonus = 0;
    const n = 6;
    for (let i = 0; i < n; i++) { const r = E.soloScore(deck, opt, 8); off += r.off; ehp += r.ehp; bonus += r.bonus; }
    const prof = [0, 0, 0, 0, 0, 0];
    let gen = 0, hp = 0;
    for (const d of deck) { for (let i = 0; i < 6; i++) prof[i] += d.card.elDmg[i]; gen += d.card.gen; hp += d.card.hp; }
    return { dpt: off / n, ehp: ehp / n, bonusPerTurn: bonus / n / 8, prof, gen, hp };
  }

  // ------------------------------------------------ évaluation détaillée d'un deck
  async function evaluateDeck(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    E.seed(input.seed || 777);
    const defs = input.deck.map(x => E.DB.cards[x.card]);
    const tal = input.deck.map(x => x.talent || 0);
    const gauntlet = toGauntlet(input.gauntlet);
    progress(0.1, 'Simulation contre la méta…');
    const fin = await evalVs(mkDeck(defs, tal), gauntlet, Math.max(6, Math.round((input.games || 320) / gauntlet.length)), opt, true, input.weights);
    progress(1, 'Terminé');
    return resultOf(defs, tal, input.deck.map(x => x.unlocked || 0), fin, 0, opt);
  }

  // ------------------------------------------------ duel entre deux decks
  async function duel(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    E.seed(input.seed || 4242);
    const A = toGauntlet([input.a])[0], B = toGauntlet([input.b])[0];
    const games = input.games || 400;
    let w = 0, turns = 0, dmgA = 0, dmgB = 0, fw = 0, fn = 0;
    let sample = null;
    const hist = new Array(31).fill(0);
    for (let i = 0; i < games; i++) {
      const r = E.playGame(A, B, opt);
      const s = r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
      w += s; turns += r.turns; dmgA += r.dmg[0]; dmgB += r.dmg[1];
      if (r.first === 0) { fw += s; fn++; }
      hist[Math.min(30, r.turns)]++;
      if (i % 16 === 15) { progress(i / games, `Duel : ${i + 1} / ${games} parties`); await tick(); }
    }
    // une partie commentée représentative
    for (let tries = 0; tries < 30 && !sample; tries++) {
      const r = E.playGame(A, B, Object.assign({}, opt, { log: true }));
      const s = r.winner === 0 ? 1 : 0;
      if (tries > 20 || (w / games >= 0.5 ? s === 1 : s === 0)) sample = r;
    }
    progress(1, 'Terminé');
    return {
      wr: w / games, games, turns: turns / games, dmgA: dmgA / games, dmgB: dmgB / games,
      firstWr: fn ? fw / fn : null, secondWr: games - fn ? (w - fw) / (games - fn) : null, hist,
      log: sample ? sample.log : [], sampleWinner: sample ? sample.winner : null, terrain: sample ? sample.terrain : -1
    };
  }

  // ------------------------------------------------ cartes manquantes / boutique
  // Pour un deck de référence : gain de taux de victoire en ajoutant chaque carte candidate.
  async function upgrades(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    E.seed((input.seed || 12345) + 7);
    const gauntlet = toGauntlet(input.gauntlet);
    const best = input.best;
    const defs = best.cards.map(i => E.DB.cards[i]);
    const g = Math.max(3, Math.round((input.games || 64) / gauntlet.length));
    const upSeed = (input.seed || 12345) + 303;
    E.seed(upSeed);
    const baseR = await evalVs(mkDeck(defs, best.talents), gauntlet, g, opt, false, input.weights);
    const base = baseR.rating;
    const ownedMap = new Map(input.owned.map(o => [o.idx, o.unlocked || 0]));
    const candidates = (input.candidates || E.DB.cards.filter(d => !ownedMap.has(d.idx)).map(d => d.idx)).map(i => E.DB.cards[i]);
    const pre = [];
    let k = 0;
    for (const d of candidates) {
      const inDeck = defs.findIndex(x => x.idx === d.idx);
      if (inDeck >= 0) {
        // carte déjà dans le deck : un exemplaire de plus débloque le talent suivant
        const unl = best.unlocked.slice(); unl[inDeck] = Math.min(3, unl[inDeck] + 1);
        pre.push({ d, slot: inDeck, score: Infinity, talents: guessTalents(defs, unl), dup: true });
      } else {
        const unlBase = ownedMap.has(d.idx) ? Math.min(3, ownedMap.get(d.idx) + 1) : 1;
        for (let slot = 0; slot < 4; slot++) {
          const cards = defs.slice(); cards[slot] = d;
          const unl = best.unlocked.slice(); unl[slot] = unlBase;
          const s = soloEval(cards, unl, opt);
          pre.push({ d, slot, score: s.score, talents: s.talents });
        }
      }
      if (++k % 4 === 0) { progress(0.35 * k / candidates.length, 'Pré-sélection des cartes…'); await tick(); }
    }
    pre.sort((a, b) => b.score - a.score);
    const byCard = new Map();
    for (const p of pre) { const l = byCard.get(p.d.idx) || []; if (l.length < 2) l.push(p); byCard.set(p.d.idx, l); }
    const limit = input.limit || 16;
    const shortlist = Array.from(byCard.values()).slice(0, limit);
    const out = [];
    let j = 0;
    for (const opts of shortlist) {
      let bestO = null;
      for (const p of opts) {
        const cards = defs.slice(); cards[p.slot] = p.d;
        E.seed(upSeed);
        const ev = await evalVs(mkDeck(cards, p.talents), gauntlet, g, opt, false, input.weights);
        if (!bestO || ev.rating > bestO.rating) bestO = { card: p.d.idx, replaces: p.dup ? null : defs[p.slot].idx, slot: p.slot, wr: ev.wr, rating: ev.rating, gain: ev.rating - base, dup: !!p.dup, talents: p.talents };
      }
      out.push(bestO);
      j++;
      progress(0.35 + 0.65 * j / shortlist.length, `Test des cartes : ${j} / ${shortlist.length}`);
    }
    out.sort((a, b) => b.rating - a.rating);
    progress(1, 'Terminé');
    return { base: baseR.wr, baseRating: base, list: out };
  }

  // ------------------------------------------------ recalcul de la méta
  async function computeMeta(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const rounds = input.rounds || 3;
    E.seed(input.seed || 99);
    const N = E.DB.cards.length;
    const randDeck = () => {
      const s = new Set();
      while (s.size < 4) s.add(Math.floor(E.rng() * N));
      return [...s].map(i => ({ card: i, talent: 1 + Math.floor(E.rng() * 3) }));
    };
    const owned = E.DB.cards.map(d => ({ idx: d.idx, unlocked: 3 }));
    let gauntlet = input.start && input.start.length ? input.start : Array.from({ length: 14 }, randDeck);
    const history = [];
    for (let round = 0; round < rounds; round++) {
      const res = await optimize({ owned, gauntlet, quality: input.quality || 'fast', seed: 1000 + round, keepStage2: 40, opt: input.opt },
        (f, m) => progress((round + f) / rounds, `Méta, itération ${round + 1} / ${rounds} : ${m}`));
      const all = res.results.concat(res.stage2 || []);
      const seen = new Set(), top = [];
      for (const r of all) {
        const k = r.cards.slice().sort((a, b) => a - b).join('-');
        if (seen.has(k)) continue;
        seen.add(k);
        if (top.every(o => o.cards.filter(c => r.cards.includes(c)).length <= 2)) top.push(r);
        if (top.length >= 12) break;
      }
      history.push(...top.slice(0, 4));
      const next = top.map(r => r.cards.map((c, i) => ({ card: c, talent: r.talents[i] || 0 })));
      for (const h of history.slice(0, 4)) {
        const d = h.cards.map((c, i) => ({ card: c, talent: h.talents[i] || 0 }));
        if (!next.some(n => n.map(x => x.card).join() === d.map(x => x.card).join())) next.push(d);
      }
      // garde aussi les decks de départ qui résistent encore (évite d'oublier une synergie)
      if (round === 0 && input.start && input.start.length) {
        for (const d of input.start) {
          if (next.length >= 16) break;
          if (!next.some(n => n.map(x => x.card).sort().join() === d.map(x => x.card).sort().join())) next.push(d);
        }
      }
      gauntlet = next.slice(0, 16);
    }
    progress(1, 'Terminé');
    return { decks: gauntlet };
  }

  // ------------------------------------------------ rôles des cartes d'un deck
  // stats[i] = [dégâts infligés, bonus générés, soins, dégâts encaissés] cumulés sur les parties.
  // Renvoie une clé de rôle par carte : carry, carry2, support, healer, tank, utility.
  function rolesOf(stats, defs) {
    const tot = [0, 1, 2, 3].map(k => stats.reduce((s, x) => s + (x ? x[k] : 0), 0) || 1);
    const sh = stats.map(x => [0, 1, 2, 3].map(k => (x ? x[k] : 0) / tot[k]));
    const roles = new Array(stats.length).fill(null);
    // un carry doit avoir une compétence d'attaque (un tank qui renvoie des dégâts n'est pas un carry)
    const attacker = i => !defs || !defs[i] || defs[i].abilities.some(a => a.hasDmg);
    // un soigneur doit pouvoir soigner ses alliés (un « se soigne » ne compte pas ; évite aussi les métamorphoses)
    const healerKit = i => !defs || !defs[i] || defs[i].abilities.some(a => !a.selfHeal && (a.choice ? [].concat(...a.options) : a.acts).some(x => x.t === 'healTarget'));
    let c = -1;
    sh.forEach((v, i) => { if (attacker(i) && v[0] > 0.05 && (c < 0 || v[0] > sh[c][0])) c = i; });
    if (c >= 0) roles[c] = 'carry';
    const taunt = d => d && (d.abilities.some(a => a.taunt) || d.skills.some(p => p.k === 'provocation'));
    // un tank doit être fait pour encaisser : une provocation ou beaucoup de PV (750 et plus)
    const tankKit = i => !defs || !defs[i] || taunt(defs[i]) || defs[i].hp >= 750;
    sh.forEach((v, i) => {
      if (roles[i]) return;
      const opts = [
        ['support', v[1] * 1.1],
        ['healer', healerKit(i) ? v[2] * (v[2] > 0.25 ? 1 : 0.4) : 0],
        ['tank', tankKit(i) ? v[3] * 0.9 + (taunt(defs && defs[i]) ? 0.15 : 0) : 0],
        ['carry2', v[0] >= 0.15 && attacker(i) ? v[0] * 1.15 : 0]
      ].sort((a, b) => b[1] - a[1]);
      roles[i] = opts[0][1] >= 0.08 ? opts[0][0] : 'utility';
    });
    return { roles, shares: sh.map(v => v.map(x => +x.toFixed(3))) };
  }

  // ------------------------------------------------ Winrate d'un deck (estimation rapide)
  // Chaque partie tire un adversaire de la population au prorata de sa fréquence :
  // estimation sans biais du Winrate pondéré, avec les Tox achetés qui font gagner.
  // input = { deck: [{card, talent}], opp: [[{card, talent}]], oppW: [poids], games }
  async function quickWinrate(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    E.seed(input.seed || 4242);
    const me = toGauntlet([input.deck])[0];
    const OPP = toGauntlet(input.opp);
    const cum = [];
    let acc = 0;
    for (const w of input.oppW) { acc += w; cum.push(acc); }
    const games = input.games || 480;
    let wins = 0, turns = 0;
    const tox = {}, per = OPP.map(() => ({ n: 0, w: 0 }));
    const cs = me.map(() => [0, 0, 0, 0]);
    for (let k = 0; k < games; k++) {
      const r0 = E.rng() * acc;
      let j = 0;
      while (j < cum.length - 1 && cum[j] < r0) j++;
      const r = E.playGame(me, OPP[j], opt);
      const v = r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
      wins += v; turns += r.turns; per[j].n++; per[j].w += v;
      r.cardStats[0].forEach((x, i) => { if (cs[i]) for (let q = 0; q < 4; q++) cs[i][q] += x[q]; });
      for (const key of new Set(r.bought[0])) { const q = tox[key] || (tox[key] = { n: 0, w: 0 }); q.n++; q.w += v; }
      if ((k & 15) === 15) { progress(k / games, 'Calcul du winrate…'); await tick(); }
    }
    const base = wins / games;
    progress(1, 'Terminé');
    return {
      wr: base, games, turns: turns / games, per: per.map(p => (p.n ? p.w / p.n : null)), perN: per.map(p => p.n),
      roles: rolesOf(cs, me.map(x => x.card)),
      tox: Object.entries(tox).map(([k, v]) => ({ k, f: v.n / games, d: v.w / v.n - base })).filter(x => x.f >= 0.08)
        .sort((a, b) => b.d * Math.sqrt(b.f) - a.d * Math.sqrt(a.f)).slice(0, 3).map(x => [x.k, +x.f.toFixed(2), +x.d.toFixed(3)])
    };
  }

  // ------------------------------------------------ améliorer un deck
  // 1) meilleurs talents (une passe carte par carte), 2) meilleur échange d'une carte contre une carte de la collection.
  // Tirages appariés (même graine) pour comparer les variantes à armes égales.
  // input = { deck: [{card, talent, unlocked}], owned: [{idx, unlocked}], opp, oppW, games }
  async function improveDeck(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    const G = input.games || 300, seedBase = input.seed || 777;
    const OPP = toGauntlet(input.opp);
    const cum = []; let acc = 0;
    for (const w of input.oppW) { acc += w; cum.push(acc); }
    const evalDeck = async (deck, n) => {
      E.seed(seedBase);
      let w = 0;
      for (let k = 0; k < n; k++) {
        const r0 = E.rng() * acc;
        let j = 0;
        while (j < cum.length - 1 && cum[j] < r0) j++;
        const r = E.playGame(deck, OPP[j], opt);
        w += r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
        if ((k & 31) === 31) await tick();
      }
      return w / n;
    };
    const defs = input.deck.map(x => E.DB.cards[x.card]);
    const unl = input.deck.map((x, i) => Math.min(x.unlocked == null ? 3 : x.unlocked, defs[i].talents.length));
    let tal = input.deck.map(x => x.talent || 0);
    const mk = (ds, ts) => ds.map((d, i) => ({ card: d, talent: ts[i] || 0 }));
    progress(0.02, 'Test des talents…');
    const base = await evalDeck(mk(defs, tal), G);
    let best = base;
    const total = 4 + 1;
    for (let i = 0; i < 4 && !input.swapsOnly; i++) {          // swapsOnly : cartes à obtenir, pas de réglage des talents
      for (let t = unl[i] > 0 ? 1 : 0; t <= unl[i]; t++) {   // on ne propose jamais de retirer un talent débloqué
        if (t === tal[i]) continue;
        const tt = tal.slice(); tt[i] = t;
        const w = await evalDeck(mk(defs, tt), G);
        if (w > best + 0.02) { best = w; tal = tt; }
      }
      progress(0.02 + 0.28 * (i + 1) / 4, 'Test des talents…');
    }
    // échanges
    const inDeck = new Set(defs.map(d => d.idx));
    const pool = (input.owned || []).filter(o => !inDeck.has(o.idx));
    const cands = [];
    const fastN = Math.max(80, Math.round(G * 0.4));
    const lockedSlots = input.locked || [];          // cartes gardées : jamais échangées (talents seulement)
    const freeSlots = [0, 1, 2, 3].filter(i => !lockedSlots[i]).length;
    let step = 0;
    for (let i = 0; i < 4; i++) {
      if (lockedSlots[i]) continue;
      for (const o of pool) {
        const ds = defs.slice(); ds[i] = E.DB.cards[o.idx];
        const u = defs.map((d, k) => (k === i ? Math.min(o.unlocked || 0, ds[i].talents.length) : unl[k]));
        const ts = tal.slice(); ts[i] = guessTalents(ds, u)[i];
        const w = await evalDeck(mk(ds, ts), fastN);
        cands.push({ slot: i, card: o.idx, talent: ts[i], w });
        step++;
        if (step % 4 === 0) progress(0.3 + 0.5 * step / Math.max(1, pool.length * freeSlots), `Test des échanges : ${step} / ${pool.length * freeSlots}`);
      }
    }
    // la base est réévaluée au même nombre de parties pour comparer
    const baseFast = await evalDeck(mk(defs, tal), fastN);
    cands.sort((a, b) => b.w - a.w);
    const top = cands.filter(c => c.w > baseFast).slice(0, 6);
    const out = [];
    const bestV = await evalDeck(mk(defs, tal), G * 2);   // référence au même nombre de parties que la vérification
    for (let k = 0; k < top.length; k++) {
      const c = top[k];
      const ds = defs.slice(); ds[c.slot] = E.DB.cards[c.card];
      const ts = tal.slice(); ts[c.slot] = c.talent;
      const w = await evalDeck(mk(ds, ts), G * 2);
      if (w > bestV + 0.01) out.push({ slot: c.slot, card: c.card, talent: c.talent, wr: w, gain: w - bestV });
      progress(0.8 + 0.2 * (k + 1) / top.length, 'Vérification des meilleurs échanges…');
    }
    out.sort((a, b) => b.wr - a.wr);
    progress(1, 'Terminé');
    return { base, talents: tal, wrTalents: best, swaps: out.slice(0, 4) };
  }

  // ------------------------------------------------ Winrate réaliste
  // Chaque deck affronte les decks de la population de joueurs simulés, pondérés par leur fréquence.
  // input = { decks: [[{card, talent}]], opp: [[{card, talent}]], oppW: [poids], games, gamesMatrix }
  async function winrateTable(input, progress) {
    progress = progress || function () {};
    resetCancel();
    const opt = Object.assign({ shopEvery: 3, maxTurns: 30 }, input.opt || {});
    E.seed(input.seed || 20260926);
    const D = toGauntlet(input.decks), OPP = toGauntlet(input.opp);
    const W = input.oppW, G = input.games || 400, GM = input.gamesMatrix || 40;
    const wr = [], turns = [], tox = [], roles = [];
    const total = D.length * OPP.length;
    let step = 0;
    for (let i = 0; i < D.length; i++) {
      let w = 0, t = 0, n = 0, wins = 0;
      const tx = {}, cs = D[i].map(() => [0, 0, 0, 0]);
      for (let j = 0; j < OPP.length; j++) {
        let s = 0;
        const nj = Math.max(3, Math.round(G * W[j]));   // parties au prorata de la fréquence de l'adversaire
        for (let k = 0; k < nj; k++) {
          const r = E.playGame(D[i], OPP[j], opt);
          const v = r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0;
          s += v; wins += v; t += r.turns; n++;
          r.cardStats[0].forEach((x, q) => { if (cs[q]) for (let z = 0; z < 4; z++) cs[q][z] += x[z]; });
          for (const key of new Set(r.bought[0])) { const q = tx[key] || (tx[key] = { n: 0, w: 0 }); q.n++; q.w += v; }
        }
        w += W[j] * s / nj;
        if (++step % 6 === 0) { progress(0.9 * step / total, `Winrate : deck ${i + 1} / ${D.length}`); await tick(); }
      }
      const base = wins / n;
      wr.push(w); turns.push(t / n); roles.push(rolesOf(cs, D[i].map(x => x.card)));
      tox.push(Object.entries(tx).map(([k, v]) => ({ k, f: v.n / n, d: v.w / v.n - base })).filter(x => x.f >= 0.08)
        .sort((a, b) => b.d * Math.sqrt(b.f) - a.d * Math.sqrt(a.f)).slice(0, 3).map(x => [x.k, +x.f.toFixed(2), +x.d.toFixed(3)]));
    }
    // matrice des 20 meilleurs
    const top = wr.map((v, i) => [v, i]).sort((a, b) => b[0] - a[0]).slice(0, 20).map(x => x[1]);
    const mx = top.map(() => new Array(top.length).fill(null));
    for (let a = 0; a < top.length; a++) {
      for (let b = a + 1; b < top.length; b++) {
        let s = 0;
        for (let k = 0; k < GM; k++) { const r = E.playGame(D[top[a]], D[top[b]], opt); s += r.winner === 0 ? 1 : r.winner === 0.5 ? 0.5 : 0; }
        mx[a][b] = s / GM; mx[b][a] = 1 - s / GM;
      }
      progress(0.9 + 0.1 * (a + 1) / top.length, 'Matrice des matchups…');
      await tick();
    }
    progress(1, 'Terminé');
    return { wr, turns, tox, roles, matrix: { idx: top, wr: mx }, games: G, gamesMatrix: GM };
  }

  const api = { optimize, upgrades, evaluateDeck, duel, computeMeta, winrateTable, quickWinrate, improveDeck, rolesOf, evalVs, guessTalents, talentValue, QUALITY, mkDeck, deckStats, setYield, cancel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpamOptimizer = api;
})(typeof self !== 'undefined' ? self : this);
