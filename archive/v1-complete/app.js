/* Deckforge — interface */
(function () {
  'use strict';
  const E = window.SpamEngine, O = window.SpamOptimizer;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = (x, d) => (x * 100).toFixed(d || 0).replace('.', ',') + ' %';
  const fmt = n => Math.round(n).toLocaleString('fr-FR');

  const ASSETS = JSON.parse($('#assets').textContent);
  let RAW = JSON.parse($('#cards-data').textContent);
  const DEFAULT_META = JSON.parse($('#meta-data').textContent);
  const TIERS = JSON.parse($('#tiers-data').textContent);
  // statistiques par carte, tirées du tableau des winrates (tous les decks simulés qui la contiennent)
  let CSTATS = null;
  function cardStats() {
    if (CSTATS) return CSTATS;
    const m = {};
    wrRows().forEach(r => r.d.cards.forEach(id => {
      const st = m[id] || (m[id] = { n: 0, sumG: 0, sumM: 0, rows: [], best: null });
      st.n++; st.sumG += r.global || 0; st.sumM += r.vm || 0; st.rows.push(r);
      if (r.vm != null && (!st.best || r.vm > st.best.vm)) st.best = r;
    }));
    const vals = Object.values(m).filter(st => st.best).map(st => st.best.vm).sort((a, b) => b - a);
    const q = f => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))];
    const cut = { S: q(0.1), A: q(0.3), B: q(0.55), C: q(0.8) };
    for (const id in m) {
      const st = m[id];
      st.avgG = st.sumG / st.n; st.avgM = st.sumM / st.n;
      const w = st.best ? st.best.vm : 0;
      st.tier = w >= cut.S ? 'S' : w >= cut.A ? 'A' : w >= cut.B ? 'B' : w >= cut.C ? 'C' : 'D';
    }
    // part des joueurs simulés dont le deck contient la carte
    const pd = DEFAULT_POP.decks || [];
    const pl = pd.reduce((x, d) => x + d.n, 0) || 1;
    pd.forEach(d => d.cards.forEach(id => { if (m[id]) m[id].pick = (m[id].pick || 0) + d.n / pl; else m[id] = { n: 0, rows: [], pick: d.n / pl }; }));
    CSTATS = m;
    return m;
  }
  function tierOf(def) {
    const st = vals0(def);
    if (st) return st;
    return (TIERS.cards && TIERS.cards[def.id]) || null;
  }
  function vals0(def) {
    const st = cardStats()[def.id];
    if (!st || !st.best) return null;
    return { tier: st.tier, wr: st.best.vm, cards: st.best.d.cards, talents: st.best.d.talents, avgG: st.avgG, n: st.n, rows: st.rows, best: st.best, pick: st.pick || 0 };
  }
  const DEFAULT_WR = JSON.parse($('#winrates-data').textContent);
  const DEFAULT_POP = JSON.parse($('#pop-data').textContent);
  const ENGINE_SRC = $('#src-engine').textContent + '\n;\n' + $('#src-optimizer').textContent;
  const DATA_BASE = 'https://www.spamgame.com/data/';

  const EL_ORDER = ['fire', 'light', 'earth', 'nature', 'shadow', 'water', 'divine'];
  const ELI = ['fire', 'water', 'earth', 'nature', 'light', 'shadow'];
  const EL_NAME = { fire: 'Feu', water: 'Eau', earth: 'Terre', nature: 'Nature', light: 'Lumière', shadow: 'Ombre', divine: 'Éther' };
  const RAR_ORDER = ['common', 'rare', 'epic', 'legendary', 'divine'];
  const RAR_NAME = { common: 'Commune', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire', divine: 'Divine' };
  const RAR_COLOR = { common: '#9692A0', rare: '#4FE6FF', epic: '#C06AFF', legendary: '#FFC756', divine: '#ff8fd8' };
  const TIER_NAME = ['commune', 'rare', 'épique', 'légendaire'];
  const QUALITY_LABEL = { fast: ['Rapide', '≈ 10 s'], normal: ['Normal', '≈ 30 s'], precise: ['Précis', '≈ 1 à 2 min'] };

  // ------------------------------------------------------------------ stockage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('deckforge.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('deckforge.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  // ------------------------------------------------------------------ données
  let byId = {}, rawById = {}, byNum = {};
  function loadData(raw) {
    RAW = raw;
    E.load(raw);
    byId = {}; rawById = {}; byNum = {};
    E.DB.cards.forEach(d => { byId[d.id] = d; byNum[d.num] = d; });
    raw.cards.forEach(c => { rawById[c.id] = c; });
    if (typeof CSTATS !== 'undefined') CSTATS = null;
  }
  loadData(RAW);
  const cardOf = idx => E.DB.cards[idx];
  // nom court lisible : premier mot, + le mot suivant si ce premier mot est partagé par plusieurs cartes
  let _first = null;
  function shortName(d) {
    if (!_first) { _first = {}; E.DB.cards.forEach(c => { const w = c.name.replace(/^(Le |La |Les |L['’])/, '').split(/[ ,]+/)[0]; _first[w] = (_first[w] || 0) + 1; }); }
    const words = d.name.replace(/^(Le |La |Les |L['’])/, '').split(/[ ,]+/).filter(Boolean);
    if (words.length > 1 && _first[words[0]] > 1) {
      const next = words.slice(1).find(w => !/^(de|des|du|la|le|les|l['’].*|d['’].*)$/i.test(w)) || words[1];
      return words[0] + ' ' + next;
    }
    return words[0] ? words[0][0].toUpperCase() + words[0].slice(1) : d.name;
  }
  const rawOf = def => rawById[def.id];
  const elColor = el => `var(--${el || 'divine'})`;
  const elIcon = el => ASSETS.el[el] || '';
  function imgOf(def) { return ASSETS.img[def.slug] || (def.tiny ? DATA_BASE + def.tiny : ''); }
  function bigImgOf(def) { return def.art ? DATA_BASE + def.art : imgOf(def); }
  function artistOf(def) { const r = rawOf(def); return r && r.artwork && r.artwork.artist ? r.artwork.artist : null; }

  // ------------------------------------------------------------------ état
  const STARTERS = E.DB.cards.filter(d => d.num >= 1 && d.num <= 6).map(d => d.id);
  const S = {
    tab: store.get('tab', 'collection'),
    coll: store.get('coll', null),
    filt: { q: '', els: new Set(), rars: new Set(), show: 'all', sort: 'el' },
    quality: store.get('quality', 'normal'),
    objective: (o => (o === 'climb' || !o ? 'real' : o))(store.get('objective', 'real')),
    shopEvery: store.get('shopEvery', 3),
    maxTurns: store.get('maxTurns', 30),
    terrain: store.get('terrain', false),
    must: [],
    res: null, sel: 0,
    upgrades: null, shopPick: ['', '', '', ''], shopRes: null,
    meta: store.get('meta', null),
    duel: store.get('duel', null),
    duelRes: null,
    saved: store.get('saved', []),
    foes: store.get('foes', []),
    wr: store.get('winrates', null),
    wv: { filter: 'all', sort: 'w', dir: -1, card: '', all: false },
    foeDraft: ['', '', '', ''], foeDeck: 'best',
    running: null,
    online: false
  };
  if (!S.coll) { S.coll = {}; STARTERS.forEach(id => { S.coll[id] = 0; }); }
  function saveColl() { store.set('coll', S.coll); }
  const ownedIds = () => Object.keys(S.coll).filter(id => byId[id]);
  const ownedInput = () => ownedIds().map(id => ({ idx: byId[id].idx, unlocked: S.coll[id] || 0 }));

  const VS_LABEL = { real: 'joueurs simulés', top: 'méta', foes: 'mes adversaires', counter: 'deck B' };
  // decks de la population les plus joués (échantillon utilisé par l'optimiseur), avec leur fréquence
  function popSample(n) {
    return (DEFAULT_POP.decks || []).filter(d => d.cards.every(id => byId[id])).slice(0, n || 24);
  }
  function metaDecks() {
    const m = S.meta || DEFAULT_META;
    const conv = (d, group) => ({ wr: d.wr, n: d.n || 1, group, deck: d.cards.map((id, i) => ({ card: byId[id] ? byId[id].idx : -1, talent: d.talents[i] || 0 })) });
    return m.decks.map(d => conv(d, 'meta')).concat(popSample(24).map(d => conv(d, 'pop')))
      .filter(d => d.deck.every(x => x.card >= 0));
  }
  // poids des adversaires : fréquence dans chaque groupe, puis part de chaque groupe selon l'objectif
  function weightsFor(list, objective) {
    const share = objective === 'foes' ? { foe: 0.7, pop: 0.3 } : { pop: 1, meta: 1, foe: 1, duel: 1, ladder: 1 };
    const tot = {};
    list.forEach(d => { tot[d.group] = (tot[d.group] || 0) + (d.n || 1); });
    const groups = Object.keys(tot);
    const norm = groups.reduce((x, g) => x + (share[g] != null ? share[g] : 1), 0);
    return list.map(d => ((share[d.group] != null ? share[d.group] : 1) / norm) * (d.n || 1) / tot[d.group]);
  }
  // adversaires utilisés pour noter les decks, selon l'objectif choisi
  function oppSet() {
    const all = metaDecks();
    let list;
    if (S.objective === 'foes' && foeList().length) list = foeList().concat(all.filter(d => d.group === 'pop'));
    else if (S.objective === 'top') list = all.filter(d => d.group === 'meta');
    else list = all.filter(d => d.group === 'pop');
    if (!list.length) list = all;
    return { list, decks: list.map(d => d.deck), weights: weightsFor(list, S.objective) };
  }
  const oppIds = list => list.map(d => ({ group: d.group, n: d.n || 1, cards: d.deck.map(x => cardOf(x.card).id), talents: d.deck.map(x => x.talent) }));

  // ---- codes de deck : DECK:5-12.1-203.2-127 (numéro de carte, point, talent)
  function deckCode(ids, talents) {
    return 'DECK:' + ids.map((id, i) => byId[id].num + (talents && talents[i] ? '.' + talents[i] : '')).join('-');
  }
  function parseDeckCode(txt) {
    const m = String(txt || '').trim().match(/^DECK\s*:\s*([\d.\-\s]+)$/i);
    if (!m) return null;
    const out = m[1].split('-').map(p => p.trim()).filter(Boolean).map(p => {
      const [n, t] = p.split('.');
      const d = byNum[+n];
      return d ? { id: d.id, talent: Math.min(+(t || 0), d.talents.length) } : null;
    });
    return out.length === 4 && out.every(Boolean) && new Set(out.map(x => x.id)).size === 4 ? out : null;
  }
  // lien de partage : …/#deck-102-178.1-2-82 (uniquement sur un vrai site web, pas dans un cadre intégré)
  function canShareLink() { return /^https?:$/.test(location.protocol) && window.self === window.top; }
  function shareLink(ids, talents) { return location.origin + location.pathname + '#deck-' + deckCode(ids, talents).slice(5); }
  async function openSharedDeck() {
    const m = decodeURIComponent(location.hash || '').match(/^#deck-([\d.\-]+)$/i);
    if (!m) return;
    const deck = parseDeckCode('DECK:' + m[1]);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* rien */ }
    if (!deck) { toast('Lien de deck invalide'); return; }
    setTab('optimizer');
    const os = oppSet();
    const res = await runJob('opt', 'evaluateDeck', { deck: deck.map(x => ({ card: byId[x.id].idx, talent: x.talent, unlocked: x.talent })), gauntlet: os.decks, weights: os.weights, opt: simOpt(), games: 320 }, 'opt');
    if (!res) return;
    const prev = S.res && S.res.meta && S.res.meta.objective === S.objective ? S.res.results.filter(x => x.cards.join() !== res.cards.join()) : [];
    S.res = { results: [res].concat(prev), meta: { opp: oppIds(os.list), objective: S.objective, vs: VS_LABEL[S.objective] || 'joueurs simulés', shared: true } };
    S.sel = 0; S.upgrades = null; S.shopRes = null;
    renderOptimizer();
    toast('Deck partagé chargé');
  }
  // image PNG du deck (illustrations HD si le site de SPAM est joignable, sinon miniatures intégrées)
  function loadImg(src, cors) {
    return new Promise(res => {
      const im = new Image();
      if (cors) im.crossOrigin = 'anonymous';
      const t = setTimeout(() => res(null), 5000);
      im.onload = () => { clearTimeout(t); res(im); };
      im.onerror = () => { clearTimeout(t); res(null); };
      im.src = src;
    });
  }
  async function deckImage(r) {
    toast('Création de l\'image…');
    const defs = r.cards.map(cardOf);
    const W = 1200, H = 675;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    try { if (document.fonts && document.fonts.load) await Promise.race([document.fonts.load('40px "Lilita One"'), new Promise(x => setTimeout(x, 1500))]); } catch (e) { /* police de secours */ }
    const css = getComputedStyle(document.documentElement);
    const col = v => css.getPropertyValue(v).trim() || '#fff';
    const grd = g.createLinearGradient(0, 0, W, H);
    grd.addColorStop(0, '#1d1530'); grd.addColorStop(1, '#0f0c18');
    g.fillStyle = grd; g.fillRect(0, 0, W, H);
    const disp = '"Lilita One", "Arial Rounded MT Bold", sans-serif', body = '"Nunito", "Segoe UI", sans-serif';
    g.fillStyle = col('--ink'); g.font = `48px ${disp}`; g.textBaseline = 'alphabetic';
    g.fillText('Deck', 48, 78); const w1 = g.measureText('Deck').width;
    g.fillStyle = col('--gold'); g.fillText('forge', 48 + w1, 78);
    g.fillStyle = col('--mute'); g.font = `700 22px ${body}`;
    g.fillText('Deck SPAM optimisé par simulation', 48, 112);
    // pastille de winrate
    const wrTxt = Math.round(r.wr * 100) + ' %';
    g.font = `64px ${disp}`; const ww = g.measureText(wrTxt).width;
    g.fillStyle = r.wr >= 0.5 ? col('--good') : col('--gold');
    g.fillText(wrTxt, W - 48 - ww, 86);
    g.fillStyle = col('--mute'); g.font = `700 20px ${body}`;
    const lbl = 'de victoires · ' + ((S.res.meta && S.res.meta.vs) || 'méta');
    g.fillText(lbl, W - 48 - g.measureText(lbl).width, 116);
    // cartes
    const cw = 240, ch = Math.round(cw * 128 / 90), gap = (W - 96 - 4 * cw) / 3, top = 150;
    const imgs = await Promise.all(defs.map(async d => (d.art ? await loadImg(bigImgOf(d), true) : null) || await loadImg(imgOf(d), false)));
    defs.forEach((d, i) => {
      const x = 48 + i * (cw + gap), y = top;
      const ec = col('--' + (d.element || 'divine'));
      g.save();
      const rr = 18;
      g.beginPath();
      g.moveTo(x + rr, y); g.arcTo(x + cw, y, x + cw, y + ch, rr); g.arcTo(x + cw, y + ch, x, y + ch, rr); g.arcTo(x, y + ch, x, y, rr); g.arcTo(x, y, x + cw, y, rr); g.closePath();
      g.clip();
      g.fillStyle = '#2a2340'; g.fillRect(x, y, cw, ch);
      if (imgs[i]) {
        const im = imgs[i], s = Math.max(cw / im.width, ch / im.height);
        g.drawImage(im, x + (cw - im.width * s) / 2, y, im.width * s, im.height * s);
      }
      g.restore();
      g.lineWidth = 4; g.strokeStyle = ec;
      g.beginPath();
      g.moveTo(x + rr, y); g.arcTo(x + cw, y, x + cw, y + ch, rr); g.arcTo(x + cw, y + ch, x, y + ch, rr); g.arcTo(x, y + ch, x, y, rr); g.arcTo(x, y, x + cw, y, rr); g.closePath();
      g.stroke();
      g.fillStyle = col('--ink'); g.font = `26px ${disp}`;
      let nm = d.name; while (g.measureText(nm).width > cw && nm.length > 4) nm = nm.slice(0, -2) + '…';
      g.fillText(nm, x, y + ch + 34);
      const t = r.talents[i] ? d.talents[r.talents[i] - 1] : null;
      g.fillStyle = col('--gold2'); g.font = `800 18px ${body}`;
      g.fillText(t ? 'Talent : ' + t.name : ' ', x, y + ch + 60);
    });
    // pied : code du deck + crédits obligatoires
    g.fillStyle = col('--mute'); g.font = `800 20px ${body}`;
    g.fillText(deckCode(r.cards.map(c => cardOf(c).id), r.talents), 48, H - 46);
    const credits = 'Illustrations : ' + defs.map(d => (artistOf(d) || {}).name).filter(Boolean).join(', ') + ' · Projet de fan non officiel, sans lien avec Ticroco';
    g.fillStyle = col('--faint'); g.font = `600 15px ${body}`;
    g.fillText(credits, 48, H - 20);
    let url;
    try { url = cv.toDataURL('image/png'); } catch (e) { toast('Image impossible à générer ici'); return; }
    openModal(`<h2>Image du deck</h2>
      <p class="small mute">À partager sur Discord ou ailleurs. Clic droit sur l'image pour l'enregistrer si les boutons ne marchent pas ici.</p>
      <img src="${url}" alt="Image du deck" style="width:100%;border-radius:12px;border:1px solid var(--line)">
      <div class="row" style="margin-top:12px">${canDownload() ? '<button type="button" class="btn primary" id="img-dl">Télécharger (PNG)</button>' : ''}<button type="button" class="btn" id="img-copy">Copier l'image</button></div>`);
    if ($('#img-dl')) $('#img-dl').addEventListener('click', () => { const a = document.createElement('a'); a.href = url; a.download = 'deck-' + defs.map(d => d.slug).join('-').slice(0, 60) + '.png'; document.body.appendChild(a); a.click(); a.remove(); });
    $('#img-copy').addEventListener('click', () => {
      cv.toBlob(b => {
        try { navigator.clipboard.write([new ClipboardItem({ 'image/png': b })]).then(() => toast('Image copiée'), () => toast('Copie refusée : utilise le clic droit')); }
        catch (e) { toast('Copie non disponible : utilise le clic droit'); }
      });
    });
  }
  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast(okMsg), () => toast('Copie refusée : ' + txt));
    else toast(txt);
  }

  // ---- journal de classé : decks adverses rencontrés
  const saveFoes = () => store.set('foes', S.foes);
  function foeDecks() { // decks complets regroupés, avec fréquence et bilan
    const map = new Map();
    for (const f of S.foes) {
      if (!f.cards || f.cards.length !== 4 || !f.cards.every(id => byId[id])) continue;
      const key = f.cards.slice().sort().join();
      const g = map.get(key) || { cards: f.cards, n: 0, w: 0, l: 0 };
      g.n++; if (f.result === 'W') g.w++; if (f.result === 'L') g.l++;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => b.n - a.n);
  }
  function foeList() { // au format « adversaires » (talents inconnus : estimés avec 1 talent débloqué)
    return foeDecks().map(g => {
      const defs = g.cards.map(id => byId[id]);
      const tal = O.guessTalents(defs, [1, 1, 1, 1]);
      return { group: 'foe', n: g.n, deck: defs.map((d, i) => ({ card: d.idx, talent: tal[i] })) };
    });
  }
  function oppOf(res) {
    const o = res && res.meta && res.meta.opp;
    if (!o) return metaDecks();
    return o.map(d => ({ group: d.group, n: d.n || 1, deck: d.cards.map((id, i) => ({ card: byId[id] ? byId[id].idx : -1, talent: d.talents[i] || 0 })) }));
  }
  const gauntlet = () => oppSet().decks;
  const simOpt = () => ({ shopEvery: +S.shopEvery, maxTurns: +S.maxTurns, terrain: !!S.terrain });

  // résultats persistés (par identifiant de carte, robustes aux mises à jour)
  function saveRes() {
    if (!S.res) return;
    store.set('res', { version: E.DB.version, results: S.res.results.map(r => Object.assign({}, r, { cards: r.cards.map(i => cardOf(i).id) })), meta: S.res.meta });
  }
  function loadRes() {
    const r = store.get('res', null);
    if (!r || !r.results) return null;
    const results = r.results.map(x => Object.assign({}, x, { cards: x.cards.map(id => byId[id] ? byId[id].idx : -1) })).filter(x => x.cards.every(i => i >= 0));
    return results.length ? { results, meta: r.meta } : null;
  }
  S.res = loadRes();

  // ------------------------------------------------------------------ worker
  const WORKER_HANDLER = `
    self.onmessage = async function (ev) {
      const m = ev.data;
      if (m.type === 'init') { try { SpamEngine.load(m.data); SpamOptimizer.setYield(false); self.postMessage({ type: 'ready' }); } catch (e) { self.postMessage({ type: 'initError', error: String(e && e.message || e) }); } return; }
      if (m.type === 'run') {
        let last = 0;
        try {
          const res = await SpamOptimizer[m.cmd](m.input, function (f, msg) {
            const t = Date.now();
            if (t - last > 120 || f >= 1) { last = t; self.postMessage({ type: 'progress', id: m.id, f: f, msg: msg }); }
          });
          self.postMessage({ type: 'done', id: m.id, res: res });
        } catch (e) { self.postMessage({ type: 'error', id: m.id, error: String(e && e.message || e) }); }
      }
    };`;
  const Runner = {
    w: null, ready: null, job: null, seq: 0, mode: 'worker',
    start() {
      this.w = null;
      try {
        const url = URL.createObjectURL(new Blob([ENGINE_SRC + '\n;\n' + WORKER_HANDLER], { type: 'text/javascript' }));
        const w = new Worker(url);
        this.ready = new Promise((res, rej) => {
          this._res = res; this._rej = rej;
          setTimeout(() => rej(new Error('Le calcul en arrière-plan ne démarre pas')), 6000);
        });
        this.ready.catch(() => {});
        w.onmessage = e => this.onMsg(e.data);
        w.onerror = e => { if (this._rej) this._rej(e); this.fallback(); };
        w.postMessage({ type: 'init', data: RAW });
        this.w = w;
        this.mode = 'worker';
      } catch (e) { this.fallback(); }
    },
    fallback() {
      if (this.w) { try { this.w.terminate(); } catch (e) { /* rien */ } }
      this.w = null; this.mode = 'main';
      if (this.job) { const j = this.job; this.job = null; j.retry(); }
    },
    onMsg(m) {
      if (m.type === 'ready') { this._res(); return; }
      if (m.type === 'initError') { this._rej(new Error(m.error)); this.fallback(); return; }
      const j = this.job;
      if (!j || m.id !== j.id) return;
      if (m.type === 'progress') j.onProgress(m.f, m.msg);
      else if (m.type === 'done') { this.job = null; j.resolve(m.res); }
      else if (m.type === 'error') { this.job = null; j.reject(new Error(m.error)); }
    },
    run(cmd, input, onProgress) {
      const self = this;
      return new Promise((resolve, reject) => {
        const go = async () => {
          if (self.w) {
            try { await self.ready; } catch (e) { self.fallback(); }
          }
          if (!self.w) {
            O.setYield(true);
            try { resolve(await O[cmd](input, onProgress)); } catch (e) { reject(e); }
            return;
          }
          const id = ++self.seq;
          self.job = { id, resolve, reject, onProgress, retry: go };
          self.w.postMessage({ type: 'run', id, cmd, input });
        };
        go();
      });
    },
    cancel() {
      if (this.w) {
        this.w.terminate();
        const j = this.job; this.job = null;
        this.start();
        if (j) j.reject(new Error('Calcul annulé'));
      } else O.cancel();
    }
  };

  // tâche en cours : une seule à la fois, avec barre de progression
  async function runJob(kind, cmd, input, where) {
    if (S.running) { toast('Un calcul est déjà en cours'); return null; }
    S.running = { kind, f: 0, msg: 'Démarrage…', where };
    renderProgress();
    updateBusy();
    try {
      const res = await Runner.run(cmd, input, (f, msg) => { if (S.running) { S.running.f = f; S.running.msg = msg; renderProgress(); } });
      return res;
    } catch (e) {
      toast(e.message || String(e));
      return null;
    } finally {
      S.running = null;
      renderProgress();
      updateBusy();
    }
  }
  function renderProgress() {
    $$('[data-progress]').forEach(el => {
      const r = S.running;
      const mine = r && el.dataset.progress === r.where;
      el.hidden = !mine;
      if (mine) {
        $('.bar > i', el).style.width = Math.round(r.f * 100) + '%';
        $('.pmsg', el).textContent = r.msg;
      }
    });
  }
  function updateBusy() { $$('[data-needs-idle]').forEach(b => { b.disabled = !!S.running; }); }

  // ------------------------------------------------------------------ toast
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ------------------------------------------------------------------ onglets
  function setTab(t) {
    S.tab = t; store.set('tab', t);
    $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $$('.view').forEach(v => { v.hidden = v.id !== 'view-' + t; });
    if (t === 'optimizer') renderOptimizer();
    if (t === 'duel') renderDuel();
    if (t === 'meta') renderMeta();
    if (t === 'ranked') renderRanked();
    if (t === 'guide') renderGuide();
    window.scrollTo(0, 0);
  }
  function renderCounts() {
    const n = ownedIds().length;
    $('#count-coll').textContent = n;
    $('#count-ranked').textContent = S.foes.length ? S.foes.length : '';
    $('#data-version').textContent = `SpamDex ${E.DB.version} · ${E.DB.cards.length} cartes`;
    $('#data-dot').classList.toggle('off', !S.online);
    $('#data-dot').title = S.online ? 'Données à jour (spamgame.com)' : 'Données intégrées (hors ligne)';
  }

  // ================================================================== COLLECTION
  function tileHTML(def) {
    const owned = S.coll[def.id] != null;
    const u = S.coll[def.id] || 0;
    const art = artistOf(def);
    const pips = def.talents.map((t, i) =>
      `<button type="button" class="${i < u ? 'on' : ''}" data-pip="${i + 1}" title="Talent ${i + 1} : ${esc(t.name)} — ${esc(t.effect)}" aria-label="Talent ${i + 1} débloqué"></button>`).join('');
    return `<div class="tile${owned ? ' owned' : ''}" data-id="${def.id}" style="--c:${elColor(def.element)};--rc:${RAR_COLOR[def.rar]}">
      <div class="art" role="button" tabindex="0" aria-pressed="${owned}" title="${esc(def.name)}${art ? ' — illustration : ' + esc(art.name) : ''}. Clic : ${owned ? 'retirer de' : 'ajouter à'} ma collection">
        <img class="pic" src="${imgOf(def)}" alt="${esc(def.name)}" loading="lazy">
        <img class="el" src="${elIcon(def.element)}" alt="${EL_NAME[def.element]}">
        ${tierBadge(def)}
        <span class="check" aria-hidden="true">${owned ? '✓' : '+'}</span>
        <div class="stats num"><span>♥ ${def.hp}</span><span class="sp" title="Spamtons générés par tour">◉ ${def.gen}</span></div>
      </div>
      <div class="name"><i class="gem" title="${RAR_NAME[def.rar]}"></i><span>${esc(def.name)}</span></div>
      <div class="foot"><span class="pips"><span class="lbl">TALENTS</span>${pips}</span><button type="button" class="info" data-info="${def.id}">Détails</button></div>
    </div>`;
  }
  function filteredCards() {
    const f = S.filt, q = E.norm(f.q.trim());
    return E.DB.cards.filter(d => {
      if (f.els.size && !f.els.has(d.element)) return false;
      if (f.rars.size && !f.rars.has(d.rar)) return false;
      const owned = S.coll[d.id] != null;
      if (f.show === 'owned' && !owned) return false;
      if (f.show === 'missing' && owned) return false;
      if (q) {
        const r = rawOf(d);
        const hay = E.norm(d.name + ' ' + (r ? r.abilities.map(a => a.name + ' ' + a.effect).join(' ') + ' ' + r.talents.map(t => t.name).join(' ') + ' ' + r.skills.map(s => s.name).join(' ') : ''));
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const byEl = EL_ORDER.indexOf(a.element) - EL_ORDER.indexOf(b.element) || a.num - b.num;
      const ta = tierOf(a), tb = tierOf(b);
      switch (f.sort) {
        case 'tier': return (tb ? tb.wr : 0) - (ta ? ta.wr : 0) || byEl;
        case 'avg': return (tb && tb.avgG != null ? tb.avgG : 0) - (ta && ta.avgG != null ? ta.avgG : 0) || byEl;
        case 'rar': return RAR_ORDER.indexOf(b.rar) - RAR_ORDER.indexOf(a.rar) || byEl;
        case 'hp': return b.hp - a.hp || byEl;
        case 'gen': return b.gen - a.gen || byEl;
        case 'name': return a.name.localeCompare(b.name, 'fr');
        default: return byEl;
      }
    });
  }
  function renderOnboarding() {
    const box = $('#onboard');
    if (!box) return;
    if (store.get('onboarded', false)) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="row" style="align-items:flex-start;gap:16px">
      <div class="stack" style="gap:8px;flex:1">
        <div><div class="eyebrow">Bienvenue</div><h2>Trouve ton meilleur deck en 3 étapes</h2></div>
        <ol class="steps"><li><b>Coche les cartes que tu possèdes</b> ci-dessous (clic sur l'illustration) et règle les talents débloqués (un par doublon). Tu peux aussi importer une liste de noms.</li>
          <li><b>Lance l'optimiseur</b> : il teste toutes tes combinaisons de 4 cartes sur des milliers de parties simulées.</li>
          <li><b>Note tes matchs dans « Classé »</b> pour viser les decks que tu croises vraiment.</li></ol>
      </div>
      <button type="button" class="btn" id="onboard-ok">Compris</button></div>`;
    $('#onboard-ok').addEventListener('click', () => { store.set('onboarded', true); box.hidden = true; });
  }
  function renderCollection() {
    const list = filteredCards();
    $('#grid').innerHTML = list.map(tileHTML).join('') || `<div class="empty" style="grid-column:1/-1"><h3>Aucune carte ne correspond</h3><p>Modifie la recherche ou les filtres.</p></div>`;
    renderCollSummary();
  }
  function renderCollSummary() {
    const ids = ownedIds();
    const tal = ids.reduce((s, id) => s + (S.coll[id] || 0), 0);
    const byRar = {};
    ids.forEach(id => { const r = byId[id].rar; byRar[r] = (byRar[r] || 0) + 1; });
    $('#coll-summary').innerHTML = `
      <div class="big num">${ids.length}<small>/ ${E.DB.cards.length} cartes possédées</small></div>
      <div class="row">${RAR_ORDER.filter(r => byRar[r]).map(r => `<span class="tag" style="color:${RAR_COLOR[r]}">${byRar[r]} ${RAR_NAME[r].toLowerCase()}${byRar[r] > 1 && r !== 'divine' ? 's' : ''}</span>`).join('')}
      <span class="tag">${tal} talent${tal > 1 ? 's' : ''} débloqué${tal > 1 ? 's' : ''}</span></div>`;
    renderCounts();
  }
  function renderFilters() {
    $('#f-els').innerHTML = EL_ORDER.map(e => `<button type="button" class="chip" data-el="${e}" aria-pressed="${S.filt.els.has(e)}" style="--c:${elColor(e)}"><img src="${elIcon(e)}" alt="">${EL_NAME[e]}</button>`).join('');
    $('#f-rars').innerHTML = RAR_ORDER.map(r => `<button type="button" class="chip text" data-rar="${r}" aria-pressed="${S.filt.rars.has(r)}" style="--c:${RAR_COLOR[r]}">${RAR_NAME[r]}</button>`).join('');
    $$('#f-show button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.show === S.filt.show)));
  }
  function toggleOwned(id) {
    if (S.coll[id] != null) delete S.coll[id]; else S.coll[id] = 0;
    saveColl();
    const t = $(`.tile[data-id="${id}"]`);
    if (t) t.outerHTML = tileHTML(byId[id]);
    renderCollSummary();
  }
  function setPip(id, k) {
    if (S.coll[id] == null) return;
    S.coll[id] = S.coll[id] === k ? k - 1 : k;
    saveColl();
    const t = $(`.tile[data-id="${id}"]`);
    if (t) t.outerHTML = tileHTML(byId[id]);
    renderCollSummary();
  }

  function bindCollection() {
    $('#grid').addEventListener('click', e => {
      const pip = e.target.closest('[data-pip]');
      const tile = e.target.closest('.tile');
      if (!tile) return;
      if (pip) { setPip(tile.dataset.id, +pip.dataset.pip); return; }
      if (e.target.closest('[data-info]')) { openCard(tile.dataset.id); return; }
      if (e.target.closest('.art')) toggleOwned(tile.dataset.id);
    });
    $('#grid').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('art')) {
        e.preventDefault();
        const id = e.target.closest('.tile').dataset.id;
        toggleOwned(id);
        const n = $(`.tile[data-id="${id}"] .art`); if (n) n.focus();
      }
    });
    $('#f-q').addEventListener('input', e => { S.filt.q = e.target.value; renderCollection(); });
    $('#f-sort').addEventListener('change', e => { S.filt.sort = e.target.value; renderCollection(); });
    $('#f-els').addEventListener('click', e => { const b = e.target.closest('[data-el]'); if (!b) return; const s = S.filt.els; s.has(b.dataset.el) ? s.delete(b.dataset.el) : s.add(b.dataset.el); renderFilters(); renderCollection(); });
    $('#f-rars').addEventListener('click', e => { const b = e.target.closest('[data-rar]'); if (!b) return; const s = S.filt.rars; s.has(b.dataset.rar) ? s.delete(b.dataset.rar) : s.add(b.dataset.rar); renderFilters(); renderCollection(); });
    $('#f-show').addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (!b) return; S.filt.show = b.dataset.show; renderFilters(); renderCollection(); });
    $('#coll-actions').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      const vis = filteredCards();
      if (act === 'add-visible') { vis.forEach(d => { if (S.coll[d.id] == null) S.coll[d.id] = 0; }); toast(`${vis.length} cartes affichées ajoutées`); }
      if (act === 'remove-visible') { vis.forEach(d => { delete S.coll[d.id]; }); toast('Cartes affichées retirées'); }
      if (act === 'starters') { S.coll = {}; STARTERS.forEach(id => { S.coll[id] = 0; }); toast('Collection réinitialisée aux 6 starters'); }
      if (act.startsWith('tal-')) { const k = +act.slice(4); ownedIds().forEach(id => { S.coll[id] = Math.min(k, byId[id].talents.length); }); toast(`Talents débloqués : ${k} pour toutes tes cartes`); }
      if (act === 'export') { openExport(); return; }
      if (act === 'import') { openImport(); return; }
      saveColl();
      renderCollection();
    });
  }

  // code d'échange de collection (numéros de cartes, stable entre versions)
  function exportCode() {
    const parts = ownedIds().map(id => byId[id].num + (S.coll[id] ? '.' + S.coll[id] : '')).sort((a, b) => parseFloat(a) - parseFloat(b));
    return 'DF1:' + parts.join(',');
  }
  function importCode(txt) {
    const m = String(txt).trim().match(/^DF1:([\d.,\s]*)$/);
    if (!m) throw new Error('Code invalide : il doit commencer par « DF1: »');
    const coll = {};
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
      const [num, u] = p.split('.');
      const d = byNum[+num];
      if (d) coll[d.id] = Math.min(+(u || 0), d.talents.length);
    });
    return coll;
  }
  // sauvegarde complète : collection + journal de classé + decks enregistrés + réglages
  function backupJSON() {
    return JSON.stringify({ app: 'deckforge', v: 1, date: new Date().toISOString(), coll: S.coll, foes: S.foes, saved: S.saved,
      settings: { quality: S.quality, objective: S.objective, shopEvery: S.shopEvery, maxTurns: S.maxTurns, terrain: S.terrain } });
  }
  function restoreBackup(obj) {
    if (!obj || obj.app !== 'deckforge' || !obj.coll) throw new Error('Ce fichier n\'est pas une sauvegarde Deckforge.');
    const coll = {};
    Object.keys(obj.coll).forEach(id => { if (byId[id]) coll[id] = Math.min(+obj.coll[id] || 0, byId[id].talents.length); });
    S.coll = coll; saveColl();
    if (Array.isArray(obj.foes)) { S.foes = obj.foes; saveFoes(); }
    if (Array.isArray(obj.saved)) { S.saved = obj.saved; store.set('saved', S.saved); }
    const st = obj.settings || {};
    ['quality', 'objective', 'shopEvery', 'maxTurns', 'terrain'].forEach(k => { if (st[k] != null) { S[k] = st[k]; store.set(k, st[k]); } });
    return Object.keys(coll).length;
  }
  // liste de noms : « Spectre Canin x2 », « 2x Spectre Canin », « Spectre Canin (2) », une carte par ligne ou séparées par des virgules
  function parseNameList(txt) {
    const coll = {}, unknown = [];
    String(txt).split(/[\n;,]+/).map(l => l.trim()).filter(Boolean).forEach(line => {
      let n = 1, name = line;
      let m;
      if ((m = line.match(/^(\d+)\s*[x×*]?\s+(.+)$/i))) { n = +m[1]; name = m[2]; }
      else if ((m = line.match(/^(.+?)\s*[x×*]\s*(\d+)$/i))) { n = +m[2]; name = m[1]; }
      else if ((m = line.match(/^(.+?)\s*\((\d+)\)$/))) { n = +m[2]; name = m[1]; }
      const d = findCard(name) || E.DB.cards.find(c => E.norm(c.name).includes(E.norm(name.trim())));
      if (!d) { unknown.push(line); return; }
      coll[d.id] = Math.min(d.talents.length, Math.max(coll[d.id] || 0, n - 1));
    });
    return { coll, unknown };
  }
  // les téléchargements ne marchent pas dans un cadre intégré (aperçu en ligne) : boutons masqués
  const canDownload = () => window.self === window.top;
  function downloadText(name, text, type) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
      const a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) { toast('Téléchargement impossible ici : copie le texte à la place'); }
  }
  function openExport() {
    openModal(`<h2>Exporter mes données</h2>
      <div class="stack">
        <div class="stack" style="gap:6px"><div class="eyebrow">Code de collection</div>
          <p class="small mute" style="margin:0">Court, à copier-coller : tes cartes et leurs talents débloqués.</p>
          <textarea class="input" id="exp-code" readonly style="min-height:70px">${esc(exportCode())}</textarea>
          <div class="row"><button type="button" class="btn primary" id="exp-copy">Copier le code</button></div></div>
        <div class="stack" style="gap:6px"><div class="eyebrow">Sauvegarde complète</div>
          <p class="small mute" style="margin:0">Collection, journal de classé (${S.foes.length} matchs), decks enregistrés (${S.saved.length}) et réglages. Utile pour passer du fichier local au site en ligne, ou d'un appareil à l'autre.</p>
          <textarea class="input" id="exp-json" readonly style="min-height:70px">${esc(backupJSON())}</textarea>
          <div class="row"><button type="button" class="btn" id="exp-json-copy">Copier la sauvegarde</button>${canDownload() ? '<button type="button" class="btn" id="exp-json-dl">Télécharger (.json)</button>' : ''}</div></div>
      </div>`);
    $('#exp-copy').addEventListener('click', () => copyText($('#exp-code').value, 'Code copié'));
    $('#exp-json-copy').addEventListener('click', () => copyText($('#exp-json').value, 'Sauvegarde copiée'));
    if ($('#exp-json-dl')) $('#exp-json-dl').addEventListener('click', () => downloadText(`deckforge-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`, backupJSON()));
  }
  function openImport() {
    openModal(`<h2>Importer</h2>
      <p class="mute">Colle au choix : un <b style="color:var(--ink)">code « DF1:… »</b>, une <b style="color:var(--ink)">sauvegarde complète</b> (texte commençant par « { »), ou une <b style="color:var(--ink)">liste de noms de cartes</b>, une par ligne. Pour une liste, « Spectre Canin x3 » veut dire 3 exemplaires, donc 2 talents débloqués.</p>
      <textarea class="input" id="imp-code" placeholder="Esprit Ombre&#10;Spectre Canin x2&#10;Ashtarae Lycaria"></textarea>
      <label class="row small mute" style="gap:8px;font-weight:700"><input type="checkbox" id="imp-merge"> Ajouter à ma collection au lieu de la remplacer (code ou liste)</label>
      <label class="field">ou un fichier de sauvegarde <input type="file" id="imp-file" accept=".json,application/json" class="input"></label>
      <p class="small" id="imp-err" style="color:var(--bad)" hidden></p>
      <div class="row"><button type="button" class="btn primary" id="imp-go">Importer</button></div>`);
    const fail = msg => { const el = $('#imp-err'); el.hidden = false; el.textContent = msg; };
    const done = msg => { closeModal(); renderAll(); renderCounts(); toast(msg); };
    $('#imp-file').addEventListener('change', e => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { try { const n = restoreBackup(JSON.parse(rd.result)); done(`Sauvegarde restaurée : ${n} cartes`); } catch (err) { fail(err.message); } };
      rd.readAsText(f);
    });
    $('#imp-go').addEventListener('click', () => {
      const txt = $('#imp-code').value.trim();
      const merge = $('#imp-merge').checked;
      try {
        if (!txt) throw new Error('Colle un code, une sauvegarde ou une liste de cartes.');
        if (txt[0] === '{') { const n = restoreBackup(JSON.parse(txt)); done(`Sauvegarde restaurée : ${n} cartes`); return; }
        let coll, unknown = [];
        if (/^DF1:/i.test(txt)) coll = importCode(txt);
        else ({ coll, unknown } = parseNameList(txt));
        const n = Object.keys(coll).length;
        if (!n) throw new Error('Aucune carte reconnue.' + (unknown.length ? ' Lignes non reconnues : ' + unknown.slice(0, 5).join(', ') : ''));
        S.coll = merge ? Object.assign({}, S.coll, coll) : coll;
        saveColl();
        done(`${n} cartes importées` + (unknown.length ? ` · non reconnues : ${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? '…' : ''}` : ''));
      } catch (e) { fail(e.message); }
    });
  }

  // ------------------------------------------------------------------ fiche carte
  function openCard(id) {
    const def = byId[id], r = rawOf(def);
    const u = S.coll[id];
    const art = artistOf(def);
    const res = ELI.map((e, i) => `<div><img src="${elIcon(e)}" alt="${EL_NAME[e]}"><span style="color:${def.res[i] < 0 ? 'var(--bad)' : def.res[i] >= 25 ? 'var(--good)' : 'var(--ink)'}">${def.res[i]}%</span></div>`).join('');
    const abil = r.abilities.map(a => `<div class="abil"><div class="t"><b>${esc(a.name)}</b>
        <span class="tag">Recharge ${a.cooldown}</span>${a.precision < 100 ? `<span class="tag">Précision ${a.precision}%</span>` : ''}
        ${a.critChance ? `<span class="tag">Critique ${a.critChance}% ×${a.critMultiplier}</span>` : ''}${a.cooldownResetChance ? `<span class="tag">Écho ${a.cooldownResetChance}%</span>` : ''}</div>
        <div class="fx">${esc(a.effect)}</div></div>`).join('');
    const skills = r.skills.map(s => `<div class="abil"><div class="t"><b>${esc(s.name)}</b><span class="tag" style="color:${RAR_COLOR[s.rarity]}">Tox ${RAR_NAME[s.rarity].toLowerCase()}</span></div><div class="fx">${esc(s.effect)}</div></div>`).join('');
    const tals = r.talents.slice().sort((a, b) => a.slot - b.slot).map(t => {
      const locked = u == null || u < t.slot;
      return `<div class="abil${locked ? ' locked' : ''}"><div class="t"><b>${esc(t.name)}</b><span class="tag">Talent ${t.slot}${locked ? ' · verrouillé' : ' · débloqué'}</span></div><div class="fx">${esc(t.effect)}</div></div>`;
    }).join('');
    openModal(`<div class="detail" style="--c:${elColor(def.element)}">
      <div class="stack">
        <div class="bigart"><img src="${bigImgOf(def)}" alt="${esc(def.name)}" data-fallback="${imgOf(def)}"></div>
        ${art ? `<p class="xs mute">Illustration : ${art.link ? `<a href="${esc(art.link)}" target="_blank" rel="noopener">${esc(art.name)}</a>` : esc(art.name)}</p>` : ''}
        <button type="button" class="btn ${u != null ? '' : 'primary'}" id="card-own">${u != null ? 'Retirer de ma collection' : 'Ajouter à ma collection'}</button>
      </div>
      <div class="stack">
        <div><div class="eyebrow" style="color:${RAR_COLOR[def.rar]}">${RAR_NAME[def.rar]} · ${EL_NAME[def.element]} · n°${def.num}</div><h2 style="font-size:1.9rem">${esc(def.name)}</h2></div>
        ${tierBlock(def)}
        <div class="row"><span class="tag">♥ ${def.hp} PV</span><span class="tag" style="color:var(--gold)">◉ ${def.gen} Spamtons / tour</span>${r.lore && r.lore.species ? `<span class="tag">${esc(r.lore.species)}</span>` : ''}${r.lore && r.lore.region ? `<span class="tag">${esc(r.lore.region)}</span>` : ''}</div>
        <div><div class="eyebrow" style="margin-bottom:6px">Résistances</div><div class="resbars">${res}</div></div>
        <div class="stack" style="gap:8px"><div class="eyebrow">Compétences</div>${abil || '<p class="mute small">Aucune compétence active.</p>'}</div>
        ${skills ? `<div class="stack" style="gap:8px"><div class="eyebrow">Tox de base</div>${skills}</div>` : ''}
        <div class="stack" style="gap:8px"><div class="eyebrow">Talents (un seul actif, chaque doublon débloque le suivant)</div>${tals}</div>
      </div></div>`);
    const img = $('.bigart img');
    img.addEventListener('error', () => { if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback; });
    $('#card-own').addEventListener('click', () => { toggleOwned(id); openCard(id); });
    const td = $('#tier-duel');
    if (td) td.addEventListener('click', () => {
      const t = tierOf(def);
      S.duel = S.duel || defaultDuel();
      S.duel.a = t.cards.map((cid, k) => ({ id: cid, talent: t.talents[k] || 0 }));
      store.set('duel', S.duel); closeModal(); setTab('duel');
    });
  }

  function tierBadge(def) {
    const t = tierOf(def);
    if (!t) return '';
    const avg = t.pick != null ? ` · jouée par ${Math.round(t.pick * 100)} % des joueurs simulés` : '';
    return `<span class="tier t-${t.tier}" title="Tier ${t.tier} : son meilleur deck a un Winrate de ${Math.round(t.wr * 100)} %${avg}">${t.tier}<small>${Math.round(t.wr * 100)}%</small></span>`;
  }
  function tierBlock(def) {
    const t = tierOf(def);
    if (!t || !t.cards.every(id => byId[id])) return '';
    const own = t.cards.filter(id => S.coll[id] != null).length;
    const chips = t.cards.map((id, k) => {
      const c = byId[id];
      const tl = t.talents[k] ? c.talents[t.talents[k] - 1] : null;
      return `<span class="tag el" style="--c:${elColor(c.element)}"><img src="${elIcon(c.element)}" alt="">${esc(c.name)}${tl ? ' · ' + esc(tl.name) : ''}</span>`;
    }).join('');
    const others = (t.rows || []).filter(r => r !== t.best).sort((a, b) => (b.global || 0) - (a.global || 0)).slice(0, 4);
    const otherHTML = others.length ? `<div class="stack" style="gap:4px"><span class="xs mute">Autres decks simulés avec cette carte</span>${others.map(r => `<div class="row small" style="gap:8px"><span class="wdeck"><span class="imgs">${r.d.cards.map(id => `<img src="${imgOf(byId[id])}" alt="${esc(byId[id].name)}" title="${esc(byId[id].name)}" style="--c:${elColor(byId[id].element)}">`).join('')}</span></span><span class="mute xs">${r.d.cards.map(id => esc(shortName(byId[id]))).join(' · ')}</span><span class="spacer"></span><span class="wcell xs" style="${heat(r.w)}" title="Winrate">${pct(r.w)}</span></div>`).join('')}</div>` : '';
    return `<div class="abil" style="gap:10px"><div class="row" style="gap:12px"><span class="tier t-${t.tier}" style="min-width:38px;height:38px;font-size:1.3rem">${t.tier}</span>
        <div class="kpis" style="flex:1;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))">
          <div class="kpi"><div class="k">Winrate du meilleur deck</div><div class="v num">${pct(t.wr)}</div></div>
          ${t.avgG != null && t.n > 1 ? `<div class="kpi" title="Moyenne du Winrate des ${t.n} decks simulés qui contiennent cette carte"><div class="k">Moyenne (${t.n} decks)</div><div class="v num">${pct(t.avgG)}</div></div>` : ''}
          <div class="kpi" title="Part des joueurs simulés dont le deck contient cette carte"><div class="k">Jouée par</div><div class="v num">${Math.round((t.pick || 0) * 100)} %</div></div>
        </div></div>
      <div class="xs mute">Meilleur deck trouvé avec cette carte (tu en possèdes ${own} sur 4) :</div>
      <div class="row" style="gap:6px">${chips}</div>
      <div><button type="button" class="btn sm" id="tier-duel">Charger ce deck dans le duel</button></div>
      ${otherHTML}</div>`;
  }
  function openModal(html) {
    $('#modal-body').innerHTML = html;
    $('#modal').hidden = false;
    $('#modal .close').focus();
  }
  function closeModal() { $('#modal').hidden = true; }

  // ================================================================== ANALYSE
  function bonusSources(def, talent) {
    const out = [0, 0, 0, 0, 0, 0];
    const notes = [];
    for (const a of def.abilities) {
      const acts = a.choice ? a.options[a.options.length - 1] : a.acts;
      for (const x of acts) {
        const avg = (x.min + x.max) / 2;
        if (x.t === 'AddAllPlayerAttack') { const per = avg * (a.acc / 100) / a.cd; if (x.el >= 0) out[x.el] += per; else for (let i = 0; i < 6; i++) out[i] += per; }
        else if (x.t === 'AddAllPlayerAttackCountActivation1') { const e = x.el >= 0 ? x.el : def.el; if (e >= 0) out[e] += 4; }
        else if (x.t === 'AddAllPlayerAttackRandomTeam') { for (let i = 0; i < 6; i++) out[i] += Math.abs(avg) / 6 / a.cd; }
        else if (x.t === 'AddAllPlayerAttackWithCardType' && def.el >= 0) out[def.el] += avg / a.cd;
      }
    }
    for (const p of def.skills) if (p.k === 'coeur') out[p.el] += E.TIERV.coeur[p.tier];
    const t = talent ? def.talents[talent - 1] : null;
    if (t) {
      const m = { TCoeurFeu_C: 0, TCoeurEau_C: 1, TCoeurTerre_C: 2, TCoeurNature_C: 3, TCoeurLumiere_C: 4, TCoeurOmbre_C: 5 };
      if (m[t.id] != null) out[m[t.id]] += 1;
    }
    return { out, notes };
  }
  function roleOf(def) {
    const tauntish = def.abilities.some(a => a.taunt) || def.skills.some(p => p.k === 'provocation');
    const sc = {
      Moteur: def.pBonus * 9,
      Frappeur: def.pDmg,
      Soigneur: def.pHeal * 0.9,
      Tank: Math.max(0, def.hp - 650) / 8 + (tauntish ? 25 : 0)
    };
    let best = 'Frappeur', bs = -1;
    for (const k in sc) if (sc[k] > bs) { bs = sc[k]; best = k; }
    return best;
  }
  function analyze(r) {
    const defs = r.cards.map(cardOf);
    const tips = [];
    const prof = r.stats.prof;
    const tot = prof.reduce((a, b) => a + b, 0) || 1;
    const order = prof.map((v, i) => [v / tot, i]).sort((a, b) => b[0] - a[0]);
    const main = order.filter(x => x[0] >= 0.22).slice(0, 2).map(x => x[1]);
    const src = defs.map((d, i) => bonusSources(d, r.talents[i]));
    const bonusBy = [0, 0, 0, 0, 0, 0];
    src.forEach(s => s.out.forEach((v, i) => { bonusBy[i] += v; }));
    if (main.length) {
      const names = main.map(i => EL_NAME[ELI[i]]).join(' et ');
      const gens = [];
      defs.forEach((d, k) => { const v = main.reduce((s, i) => s + src[k].out[i], 0); if (v >= 0.4) gens.push(`${d.name} (≈ +${v.toFixed(1).replace('.', ',')}/tour)`); });
      tips.push({ ic: '◆', html: `<b>Axe ${names}</b> : ${Math.round(main.reduce((s, i) => s + prof[i], 0) / tot * 100)} % des dégâts de base du deck sont dans ${main.length > 1 ? 'ces éléments' : 'cet élément'}. ${gens.length ? `Les bonus viennent de ${gens.join(', ')} : chaque point ajoute +10 % aux attaques et soins de cet élément, et ils s'additionnent tour après tour.` : `Peu de générateurs de bonus dans ${names} : un Tox « Cœur » acheté en boutique renforce beaucoup ce deck.`}` });
    } else {
      tips.push({ ic: '◆', html: `<b>Deck multi-élément</b> : les dégâts sont répartis sur plusieurs éléments, ce qui limite l'effet des bonus mais rend le deck difficile à contrer par les résistances.` });
    }
    const wasted = bonusBy.map((v, i) => [v, i]).filter(x => x[0] >= 1 && !main.includes(x[1]) && prof[x[1]] / tot < 0.1);
    if (wasted.length) tips.push({ ic: '!', html: `Bonus ${wasted.map(x => EL_NAME[ELI[x[1]]]).join(', ')} générés sans attaque qui en profite : ils ne servent qu'aux cartes adverses via Mimétisme ou restent inutilisés.` });
    // critique
    const critBuff = defs.reduce((s, d) => s + d.abilities.reduce((t, a) => {
      const acts = a.choice ? [].concat(...a.options) : a.acts;
      return t + acts.filter(x => x.t === 'AddAllPlayerCritick' || x.t === 'AddOppCardCriticChance').reduce((u, x) => u + x.min, 0) / a.cd;
    }, 0), 0);
    if (critBuff >= 2) {
      const big = defs.filter(d => d.abilities.some(a => a.cm >= 3 && a.hasDmg)).map(d => d.name);
      tips.push({ ic: '✦', html: `<b>Critiques qui montent</b> : environ +${critBuff.toFixed(1).replace('.', ',')} % de chance de critique par tour pour l'équipe${big.length ? `, rentabilisé par les gros multiplicateurs de ${big.join(', ')}` : ''}.` });
    }
    // défense
    const hp = defs.reduce((s, d, i) => s + d.hp, 0);
    const resAvg = ELI.map((e, i) => defs.reduce((s, d) => s + d.res[i], 0) / 4);
    const weak = resAvg.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0])[0];
    const heal = defs.filter(d => d.pHeal > 5).map(d => d.name);
    const taunt = defs.filter(d => d.abilities.some(a => a.taunt)).map(d => d.name);
    tips.push({ ic: '♥', html: `<b>${fmt(hp)} PV de base</b>${heal.length ? `, soins par ${heal.join(', ')}` : ''}${taunt.length ? `, provocation avec ${taunt.join(', ')}` : ''}. Point faible : l'élément ${EL_NAME[ELI[weak[1]]]} (${Math.round(weak[0])} % de résistance moyenne).` });
    // économie
    const gen = r.stats.gen;
    tips.push({ ic: '◉', html: `<b>${gen} Spamtons par tour</b> ${gen >= 34 ? 'économie forte : tu pourras acheter des Tox rares tôt.' : gen <= 22 ? 'économie faible : vise des Tox communs efficaces (Berserk, Cœur).' : 'économie moyenne.'}` });
    // talents
    const talNotes = defs.map((d, i) => r.talents[i] ? `${d.name} → <b>${esc(d.talents[r.talents[i] - 1].name)}</b>` : null).filter(Boolean);
    if (talNotes.length) tips.push({ ic: '★', html: `Talents retenus après simulation : ${talNotes.join(', ')}.` });
    const lockedGain = defs.map((d, i) => ({ d, i, u: r.unlocked ? r.unlocked[i] : 3 })).filter(x => x.u < x.d.talents.length);
    if (lockedGain.length) tips.push({ ic: '↑', html: `Un doublon de ${lockedGain.map(x => x.d.name).join(', ')} débloquerait un talent de plus : le calcul en tient compte dès que tu mets à jour ta collection.` });
    // matchups
    if (r.per) {
      const md = oppOf(S.res);
      const worst = r.per.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).slice(0, 2).filter(x => x[0] < 0.5 && md[x[1]] && md[x[1]].deck.every(c => c.card >= 0));
      if (worst.length) tips.push({ ic: '⚔', html: `Matchs difficiles : ${worst.map(x => `${md[x[1]].deck.map(c => shortName(cardOf(c.card))).join('·')} (${pct(x[0])})`).join(' et ')}. Utilise l'onglet Duel pour les rejouer et chercher une variante.` });
    }
    if (r.firstWr != null && r.secondWr != null) tips.push({ ic: '⏱', html: `Victoires en commençant : ${pct(r.firstWr)} · en jouant second : ${pct(r.secondWr)}.` });
    return tips;
  }
  function availTurn(cd, first) { return first ? Math.max(1, cd) : Math.max(1, cd - 1); }
  // compétences lancées aux premiers tours (recharges seules, sans Écho ni Éternité)
  function openingSeq(defs, first, turns) {
    const st = [];
    defs.forEach(d => d.abilities.forEach(a => st.push({ d, a, cd: Math.max(0, a.cd - (first ? 1 : 2)), uses: a.uses || 0 })));
    const out = [];
    for (let t = 1; t <= turns; t++) {
      const now = st.filter(x => x.cd === 0 && (!x.a.uses || x.uses > 0)).sort((x, y) => x.a.order - y.a.order);
      now.forEach(x => { x.cd = x.a.cd; if (x.a.uses) x.uses--; });
      out.push(now);
      st.forEach(x => { if (x.cd > 0) x.cd--; });
    }
    return out;
  }
  function openingHTML(defs) {
    const A = openingSeq(defs, true, 5), B = openingSeq(defs, false, 5);
    const cell = list => list.length ? list.map(x => `<span class="ab" style="--c:${elColor(x.d.element)}" title="${esc(x.d.name)}">${esc(x.a.name)}${x.a.special ? ' *' : ''}</span>`).join('') : '<span class="faint">—</span>';
    let rows = '';
    for (let t = 0; t < 5; t++) rows += `<span class="t">T${t + 1}</span><div class="cell">${cell(A[t])}</div><div class="cell">${cell(B[t])}</div>`;
    return `<div class="seq"><span></span><span class="h">Si tu commences</span><span class="h">Si tu es second</span>${rows}</div>
      <p class="xs faint" style="margin:0">Dans l'ordre : bonus d'abord, puis attaques, puis soins. * : à garder pour le bon moment (absorption, résurrection…). La couleur indique la carte.</p>`;
  }

  function toxAdvice(r) {
    if (!r.tox) return [];
    const games = r.games || 1;
    return Object.entries(r.tox).map(([k, v]) => {
      const m = k.match(/^(.*?)(\d)$/);
      return { key: m[1], tier: +m[2], freq: v.n / games, wr: v.w / v.n };
    }).filter(x => x.freq >= 0.05).map(x => Object.assign(x, { delta: x.wr - r.wr }))
      .sort((a, b) => (b.delta * Math.sqrt(b.freq)) - (a.delta * Math.sqrt(a.freq))).slice(0, 6);
  }

  // ================================================================== OPTIMISEUR
  function miniImgs(cards, size) {
    return cards.map(i => { const d = cardOf(i); return `<img src="${imgOf(d)}" alt="${esc(d.name)}" title="${esc(d.name)}" style="--c:${elColor(d.element)}${size ? `;width:${size}px` : ''}">`; }).join('');
  }
  function gaugeSVG(v) {
    const r = 52, c = 2 * Math.PI * r, col = v >= 0.6 ? 'var(--good)' : v >= 0.45 ? 'var(--gold)' : 'var(--bad)';
    return `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" fill="none" style="stroke:var(--bg2)" stroke-width="12"/>
      <circle cx="60" cy="60" r="${r}" fill="none" style="stroke:${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
  }
  function renderOptSide() {
    const n = ownedIds().length;
    const q = S.quality;
    const mustChips = S.must.map(id => `<span class="tag" style="--c:${elColor(byId[id].element)}">${esc(byId[id].name)} <button type="button" class="info" data-unmust="${id}" aria-label="Retirer">✕</button></span>`).join('');
    const saved = S.saved.map((s, i) => `<button type="button" class="alt" data-saved="${i}" style="grid-template-columns:repeat(4,32px) minmax(0,1fr)">${miniImgs(s.cards.map(id => byId[id] ? byId[id].idx : 0), 32)}<span class="names">${esc(s.name)}</span></button>`).join('');
    $('#opt-side').innerHTML = `
      <div class="panel stack">
        <div><div class="eyebrow">Trouver mon deck</div><h2>Optimiseur</h2></div>
        <p class="small mute">Teste toutes les combinaisons de 4 cartes de ta collection (<b class="num" style="color:var(--ink)">${n}</b> cartes), puis fait jouer les meilleures des milliers de parties contre les decks de la méta.</p>
        <div class="field"><span class="small mute" style="font-weight:700">Précision du calcul</span>
          <div class="seg" id="q-seg" role="group" aria-label="Précision">${Object.keys(QUALITY_LABEL).map(k => `<button type="button" data-q="${k}" aria-pressed="${k === q}">${QUALITY_LABEL[k][0]}<small>${QUALITY_LABEL[k][1]}</small></button>`).join('')}</div></div>
        <div class="field"><span class="small mute" style="font-weight:700">Objectif</span>
          <div class="seg" id="obj-seg" role="group" aria-label="Objectif">
            <button type="button" data-obj="real" aria-pressed="${S.objective === 'real'}">Réaliste<small>joueurs simulés</small></button>
            <button type="button" data-obj="top" aria-pressed="${S.objective === 'top'}">Top 1<small>méta seule</small></button>
            <button type="button" data-obj="foes" aria-pressed="${S.objective === 'foes'}" ${foeDecks().length ? '' : 'disabled title="Note d\'abord des decks adverses dans l\'onglet Classé"'}>Mes adversaires<small>${foeDecks().length} deck${foeDecks().length > 1 ? 's' : ''} notés</small></button></div></div>
        <label class="field">Carte(s) imposée(s)
          <input class="input" id="must-in" list="dl-owned" placeholder="Nom d'une carte possédée…"></label>
        ${mustChips ? `<div class="row">${mustChips}</div>` : ''}
        <details><summary class="small mute" style="cursor:pointer;font-weight:800">Réglages de simulation</summary>
          <div class="stack" style="margin-top:10px">
            <label class="field">Boutique Tox tous les N tours <input class="input num" id="set-shop" type="number" min="0" max="10" value="${S.shopEvery}"></label>
            <label class="field">Nombre de tours maximum <input class="input num" id="set-turns" type="number" min="10" max="60" value="${S.maxTurns}"></label>
            <label class="row small" style="gap:8px;font-weight:700;color:var(--mute)"><input type="checkbox" id="set-terrain" ${S.terrain ? 'checked' : ''}> Terrain aléatoire (+5, ancienne règle)</label>
            <p class="xs faint">0 désactive la boutique. Ces réglages s'appliquent aussi aux duels. La méta fournie est calculée sans terrain.</p>
          </div></details>
        <button type="button" class="btn primary big" id="run-opt" data-needs-idle ${n < 4 ? 'disabled' : ''}>Trouver mon meilleur deck</button>
        ${n < 4 ? '<p class="small" style="color:var(--warn)">Ajoute au moins 4 cartes dans l\'onglet Collection.</p>' : ''}
        <div class="progress" data-progress="opt" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>
      </div>
      ${saved ? `<div class="panel stack" style="margin-top:16px"><div class="eyebrow">Mes decks enregistrés</div><div class="alts">${saved}</div></div>` : ''}`;
    renderProgress(); updateBusy();
  }
  function renderOptimizer() {
    renderOptSide();
    const main = $('#opt-main');
    if (!S.res || !S.res.results.length) {
      main.innerHTML = `<div class="panel empty"><h3>Aucun deck calculé pour l'instant</h3><p>Coche tes cartes dans l'onglet Collection, règle leurs talents débloqués, puis lance l'optimiseur.</p></div>`;
      return;
    }
    const rs = S.res.results;
    if (S.sel >= rs.length) S.sel = 0;
    const r = rs[S.sel];
    const defs = r.cards.map(cardOf);
    const md = oppOf(S.res);
    const tips = analyze(r);
    const grpWr = g => { let t = 0, n = 0; (r.per || []).forEach((v, i) => { if (md[i] && md[i].group === g) { t += v; n++; } }); return n ? t / n : null; };
    const tox = toxAdvice(r);
    const dcards = defs.map((d, i) => {
      const t = r.talents[i] ? d.talents[r.talents[i] - 1] : null;
      return `<div class="dcard" style="--c:${elColor(d.element)}"><div class="art" data-open="${d.id}" role="button" tabindex="0" title="Voir la fiche"><img class="pic" src="${imgOf(d)}" alt="${esc(d.name)}"><img class="el" src="${elIcon(d.element)}" alt=""><span class="role">${roleOf(d)}</span></div>
        <div class="nm">${esc(d.name)}</div><div class="tal ${t ? '' : 'none'}">${t ? 'Talent : ' + esc(t.name) : (r.unlocked && r.unlocked[i] ? 'Sans talent' : 'Aucun talent débloqué')}</div></div>`;
    }).join('');
    const mRow = (v, i) => md[i] && md[i].deck.every(x => x.card >= 0) ? `<div class="brow"><span class="lab" title="${esc(md[i].deck.map(x => cardOf(x.card).name).join(' + '))}">${md[i].deck.map(x => esc(shortName(cardOf(x.card)))).join(' · ')}</span>
        <span class="track"><i style="width:${Math.round(v * 100)}%;background:${v >= 0.55 ? 'var(--good)' : v >= 0.45 ? 'var(--gold)' : 'var(--bad)'}"></i></span><span class="pct">${pct(v)}</span></div>` : '';
    const grpRows = g => (r.per || []).map((v, i) => (md[i] && md[i].group === g ? mRow(v, i) : '')).join('');
    const GRP = { foe: 'Mes adversaires en classé', pop: 'Decks les plus joués (joueurs simulés)', meta: 'Méta (decks les plus forts)', ladder: 'Ancien échantillon', duel: 'Deck B du duel' };
    const matchups = ['foe', 'pop', 'meta', 'ladder', 'duel'].map(g => { const rows = grpRows(g); return rows ? `<div class="eyebrow" style="margin-top:4px">${GRP[g]}</div>${rows}` : ''; }).join('');
    const dmg = r.dmgShare ? defs.map((d, i) => `<div class="brow"><span class="lab">${esc(d.name)}</span><span class="track"><i style="width:${Math.round(r.dmgShare[i] * 100)}%;background:${elColor(d.element)}"></i></span><span class="pct">${pct(r.dmgShare[i])}</span></div>`).join('') : '';
    const plan = defs.map((d, i) => `<div class="pc" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="">
        <div class="stack" style="gap:4px"><div><b>${esc(d.name)}</b> <span class="tag">${roleOf(d)}</span></div>
        ${d.abilities.map(a => `<div class="ab"><b>${esc(a.name)}</b><span class="turnpill" title="Premier tour de disponibilité si tu commences / si tu joues second">T${availTurn(a.cd, true)} / T${availTurn(a.cd, false)}</span><span class="faint xs">recharge ${a.cd}</span></div>`).join('') || '<span class="small faint">Passifs uniquement</span>'}</div></div>`).join('');
    const alts = rs.map((x, i) => `<button type="button" class="alt" data-sel="${i}" aria-current="${i === S.sel}"><span class="rank">${i + 1}</span>${miniImgs(x.cards)}<span class="names">${x.cards.map(c => esc(cardOf(c).name)).join(' · ')}</span><span class="wr num" title="Taux de victoire">${pct(x.wr)}</span></button>`).join('');
    const toxHTML = tox.length ? tox.map(t => `<div class="brow"><span class="lab">${esc(E.TOX_NAMES[t.key] || t.key)} <span class="faint xs">${TIER_NAME[t.tier]} · ${Math.round(t.freq * 100)} % des parties</span></span><span class="track"><i style="width:${Math.round(t.wr * 100)}%;background:${t.delta >= 0 ? 'var(--shadow)' : 'var(--faint)'}"></i></span><span class="pct" title="Écart avec le taux de victoire moyen du deck">${t.delta >= 0 ? '+' : '−'}${Math.abs(Math.round(t.delta * 100))}</span></div>`).join('') : '<p class="small mute">Pas assez d\'achats observés.</p>';
    main.innerHTML = `
      <section class="panel stack">
        <div class="row"><div><div class="eyebrow">Deck n°${S.sel + 1} sur ${rs.length}</div><h2>${S.sel === 0 ? 'Ton meilleur deck pour le classé' : 'Alternative'}</h2></div><span class="spacer"></span>
          <button type="button" class="btn sm" id="r-copy">Copier la liste</button><button type="button" class="btn sm" id="r-code" title="Code à coller dans le Duel, le journal Classé ou à partager">Copier le code</button><button type="button" class="btn sm" id="r-save">Enregistrer</button><button type="button" class="btn sm" id="r-duel">Tester en duel</button><button type="button" class="btn sm" id="r-img">Image du deck</button>${canShareLink() ? '<button type="button" class="btn sm" id="r-link">Partager le lien</button>' : ''}</div>
        ${S.res.meta && S.res.meta.shared && S.sel === 0 ? '<p class="small" style="margin:0;color:var(--gold2)">Deck reçu par un lien de partage, évalué contre tes adversaires de référence.</p>' : ''}
        ${r.wr < 0.1 ? `<p class="small" style="color:var(--warn);margin:0">Avec ${ownedIds().length} cartes, aucun deck ne bat encore ces adversaires. Le classement reste utile (il tient compte des PV restants en fin de partie), mais ajoute toutes tes cartes dans l'onglet Collection pour un vrai résultat, ou regarde « Cartes à viser » plus bas.</p>` : ''}
        <div class="hero"><div class="deckrow">${dcards}</div>
          <div class="stack" style="justify-items:center"><div class="gauge">${gaugeSVG(r.wr)}<div class="val"><b class="num">${Math.round(r.wr * 100)}%</b><span>winrate</span><span style="text-transform:none;letter-spacing:0">${esc((S.res.meta && S.res.meta.vs) || 'méta')}</span></div></div>
          <span class="xs faint">${fmt(r.games || 0)} parties simulées</span></div></div>
        <div class="kpis">
          <div class="kpi"><div class="k">Durée moyenne</div><div class="v num">${r.turns.toFixed(1).replace('.', ',')} tours</div></div>
          <div class="kpi"><div class="k">PV de base</div><div class="v num">${fmt(r.stats.hp)}</div></div>
          <div class="kpi"><div class="k">Dégâts / tour (début)</div><div class="v num">${fmt(r.stats.dpt)}</div></div>
          <div class="kpi"><div class="k">Bonus générés / tour</div><div class="v num">${r.stats.bonusPerTurn.toFixed(1).replace('.', ',')}</div></div>
          <div class="kpi"><div class="k">Spamtons / tour</div><div class="v num" style="color:var(--gold)">${r.stats.gen}</div></div>
        </div>
      </section>
      <div class="cols2" style="margin-top:16px">
        <section class="panel stack"><h3>Pourquoi ce deck marche</h3><ul class="why">${tips.map(t => `<li><span class="ic">${t.ic}</span><span class="small">${t.html}</span></li>`).join('')}</ul></section>
        <section class="panel stack"><h3>Plan de jeu</h3>
          <p class="xs mute">Chaque tour, lance d'abord les compétences qui donnent des bonus, puis les attaques. Concentre les attaques à cible unique sur la carte adverse qui génère le plus de bonus ou qui soigne. Pastilles : premier tour de disponibilité si tu commences / si tu joues second.</p>
          <div class="plan">${plan}</div>
          <div class="eyebrow" style="margin-top:6px">Séquence d'ouverture</div>
          ${openingHTML(defs)}</section>
      </div>
      <div class="cols2" style="margin-top:16px">
        <section class="panel stack"><h3>Matchups</h3><div class="bars">${matchups}</div></section>
        <section class="panel stack"><h3>Qui fait les dégâts</h3><div class="bars">${dmg}</div>
          <h3 style="margin-top:8px">Tox à prioriser en boutique</h3><p class="xs mute">Parties où l'IA a acheté ce Tox (boutique simulée) : la barre montre le taux de victoire, le chiffre l'écart en points avec la moyenne du deck.</p><div class="bars">${toxHTML}</div></section>
      </div>
      <section class="panel stack" style="margin-top:16px"><h3>Classement des decks trouvés</h3><div class="alts">${alts}</div></section>
      <div class="cols2" style="margin-top:16px">
        <section class="panel stack" id="up-panel"><h3>Cartes à viser</h3><p class="small mute">Les cartes qui amélioreraient le plus ce deck (y compris un doublon pour débloquer un talent). Idéal pour choisir quoi acheter ou quelle orbe ouvrir.</p>
          <button type="button" class="btn" id="run-up" data-needs-idle>Chercher les meilleures cartes à obtenir</button>
          <div class="progress" data-progress="up" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>
          <div id="up-list">${renderUpgrades()}</div>
          ${renderReach(r)}</section>
        <section class="panel stack" id="shop-panel"><h3>Conseiller boutique du jour</h3><p class="small mute">Saisis les cartes proposées aujourd'hui en boutique : Deckforge te dit laquelle renforce le plus ton deck.</p>
          <div class="stack" style="gap:6px">${S.shopPick.map((v, i) => `<input class="input" list="dl-all" data-shop="${i}" placeholder="Carte proposée ${i + 1}" value="${esc(v)}">`).join('')}</div>
          <button type="button" class="btn" id="run-shop" data-needs-idle>Laquelle prendre ?</button>
          <div class="progress" data-progress="shop" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>
          <div id="shop-list">${renderShop()}</div></section>
      </div>`;
    renderProgress(); updateBusy();
  }
  function upRow(x) {
    const d = cardOf(x.card);
    return `<div class="up" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="" data-open="${d.id}"><div><b>${esc(d.name)}</b><div class="xs mute">${x.dup ? 'Doublon : débloque le talent suivant' : `à la place de ${esc(cardOf(x.replaces).name)}`}${S.coll[d.id] != null && !x.dup ? ' · déjà possédée' : ''}</div></div>
        <span class="gain num ${x.gain >= 0 ? 'pos' : 'neg'}">${x.gain >= 0 ? '+' : '−'}${Math.abs(Math.round(x.gain * 100))} pts</span></div>`;
  }
  function renderUpgrades() {
    const u = S.upgrades;
    if (!u) return '';
    const good = u.list.filter(x => x.gain > 0.005);
    if (!good.length) return `<p class="small mute">Aucune carte testée n'améliore nettement ce deck en l'échangeant contre une de ses cartes. Regarde plutôt les decks à portée de main ci-dessous.</p>`;
    return `<p class="xs mute">Gain en points de score (victoires + marge) par rapport au deck actuel, mesuré sur les mêmes parties simulées.</p><div class="uplist">${good.slice(0, 8).map(upRow).join('')}</div>`;
  }
  // decks forts (tier list + méta) auxquels il ne manque qu'une ou deux cartes
  function renderReach(r) {
    const rows = wrRows();
    if (!rows.length) return '';
    const ref = r && S.res && S.res.meta && S.res.meta.objective === 'real' ? r.wr : null;
    const list = rows.map(x => ({ x, missing: x.d.cards.filter(id => S.coll[id] == null) }))
      .filter(c => c.missing.length >= 1 && c.missing.length <= 2 && (ref == null || c.x.w > ref + 0.03))
      .sort((a, b) => a.missing.length - b.missing.length || b.x.w - a.x.w).slice(0, 5);
    if (!list.length) return '';
    return `<div class="stack" style="gap:8px"><div class="eyebrow">Decks à portée de main</div>
      <p class="xs mute">Decks au meilleur Winrate${ref != null ? ` que le tien (${pct(ref)})` : ''} auxquels il ne manque qu'une ou deux cartes.</p>
      ${list.map(c => `<div class="up" style="grid-template-columns:minmax(0,1fr) auto"><div class="stack" style="gap:6px"><div class="row" style="gap:4px">${c.x.d.cards.map(id => { const d = byId[id]; const miss = S.coll[id] == null; return `<img src="${imgOf(d)}" alt="${esc(d.name)}" title="${esc(d.name)}${miss ? ' (manquante)' : ''}" data-open="${id}" style="--c:${elColor(d.element)};width:34px;${miss ? 'opacity:.45;border-style:dashed' : ''}">`; }).join('')}</div>
        <div class="xs"><span class="mute">Il te manque</span> <b>${c.missing.map(id => esc(byId[id].name)).join(' et ')}</b></div></div>
        <span class="gain num pos" title="Winrate de ce deck">${pct(c.x.w)}</span></div>`).join('')}</div>`;
  }

  function renderShop() {
    const u = S.shopRes;
    if (!u) return '';
    const best = u.list[0];
    return `<p class="small">${best && best.gain > 0.005 ? `Prends <b>${esc(cardOf(best.card).name)}</b>.` : 'Aucune de ces cartes n\'améliore nettement ton deck actuel : choisis selon tes autres decks ou la revente.'}</p>
      <div class="uplist">${u.list.map(x => { const d = cardOf(x.card); return `<div class="up" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="" data-open="${d.id}"><div><b>${esc(d.name)}</b><div class="xs mute">${x.dup ? 'Doublon : talent suivant' : `remplacerait ${esc(cardOf(x.replaces).name)}`}</div></div><span class="gain num ${x.gain >= 0 ? 'pos' : 'neg'}">${x.gain >= 0 ? '+' : '−'}${Math.abs(Math.round(x.gain * 100))} pts</span></div>`; }).join('')}</div>`;
  }

  async function runOptimize(opts) {
    if (S.objective === 'foes' && !foeDecks().length) { S.objective = 'real'; store.set('objective', 'real'); }
    const os = oppSet();
    const input = Object.assign({ owned: ownedInput(), gauntlet: os.decks, weights: os.weights, quality: S.quality, opt: simOpt(), must: S.must.map(id => byId[id].idx), seed: Math.floor(Math.random() * 1e9) }, opts || {});
    const opp = opts && opts.opp ? opts.opp : oppIds(os.list);
    delete input.opp;
    const res = await runJob('opt', 'optimize', input, 'opt');
    if (!res) return;
    S.res = { results: res.results, meta: { evaluated: res.evaluated, simulated: res.simulated, pool: res.pool, vs: input.vsLabel || VS_LABEL[S.objective] || 'joueurs simulés', opp, objective: opts && opts.opp ? 'counter' : S.objective } };
    S.sel = 0; S.upgrades = null; S.shopRes = null;
    saveRes();
    if (S.tab === 'optimizer') renderOptimizer();
    const bw = res.results[0].wr;
    toast(bw < 0.05 ? 'Ta collection ne suffit pas encore à battre ces adversaires : ajoute tes cartes dans Collection' : `${fmt(res.evaluated)} deck${res.evaluated > 1 ? 's' : ''} testé${res.evaluated > 1 ? 's' : ''}, meilleur : ${pct(bw)} de victoires (${S.res.meta.vs})`);
  }

  function bindOptimizer() {
    const side = $('#opt-side'), main = $('#opt-main');
    side.addEventListener('click', e => {
      const q = e.target.closest('[data-q]');
      if (q) { S.quality = q.dataset.q; store.set('quality', S.quality); renderOptSide(); return; }
      const ob = e.target.closest('[data-obj]');
      if (ob) { S.objective = ob.dataset.obj; store.set('objective', S.objective); renderOptSide(); toast({ top: 'Objectif : battre la méta (decks les plus forts)', foes: 'Objectif : battre les decks que tu croises en classé', real: 'Objectif : battre les decks les plus joués (winrate réaliste)' }[S.objective]); return; }
      if (e.target.closest('#run-opt')) { runOptimize(); return; }
      const um = e.target.closest('[data-unmust]');
      if (um) { S.must = S.must.filter(id => id !== um.dataset.unmust); renderOptSide(); return; }
      const sv = e.target.closest('[data-saved]');
      if (sv) { evalSaved(+sv.dataset.saved); return; }
      if (e.target.closest('[data-cancel]')) Runner.cancel();
    });
    side.addEventListener('change', e => {
      if (e.target.id === 'must-in') {
        const d = findCard(e.target.value);
        if (d && S.coll[d.id] != null && !S.must.includes(d.id) && S.must.length < 3) S.must.push(d.id);
        else if (d && S.coll[d.id] == null) toast('Cette carte n\'est pas dans ta collection');
        renderOptSide();
      }
      if (e.target.id === 'set-shop') { S.shopEvery = Math.max(0, Math.min(10, +e.target.value || 0)); store.set('shopEvery', S.shopEvery); }
      if (e.target.id === 'set-turns') { S.maxTurns = Math.max(10, Math.min(60, +e.target.value || 30)); store.set('maxTurns', S.maxTurns); }
      if (e.target.id === 'set-terrain') { S.terrain = e.target.checked; store.set('terrain', S.terrain); }
    });
    main.addEventListener('click', e => {
      const sel = e.target.closest('[data-sel]');
      if (sel) { S.sel = +sel.dataset.sel; S.upgrades = null; S.shopRes = null; renderOptimizer(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const op = e.target.closest('[data-open]');
      if (op) { openCard(op.dataset.open); return; }
      if (e.target.closest('[data-cancel]')) { Runner.cancel(); return; }
      const r = S.res && S.res.results[S.sel];
      if (!r) return;
      if (e.target.closest('#r-copy')) {
        const txt = r.cards.map((c, i) => cardOf(c).name + (r.talents[i] ? ` (talent : ${cardOf(c).talents[r.talents[i] - 1].name})` : '')).join('\n') + `\n${pct(r.wr)} de victoires simulées (Deckforge) · ${deckCode(r.cards.map(c => cardOf(c).id), r.talents)}`;
        if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast('Liste copiée'), () => toast('Copie refusée par le navigateur'));
        else toast('Copie non disponible ici');
      }
      if (e.target.closest('#r-link')) { copyText(shareLink(r.cards.map(c => cardOf(c).id), r.talents), 'Lien du deck copié'); return; }
      if (e.target.closest('#r-img')) { deckImage(r); return; }
      if (e.target.closest('#r-code')) { copyText(deckCode(r.cards.map(c => cardOf(c).id), r.talents), 'Code du deck copié'); return; }
      if (e.target.closest('#r-save')) {
        const name = r.cards.map(c => shortName(cardOf(c))).join(' · ');
        S.saved = [{ name: `${name} (${pct(r.wr)})`, cards: r.cards.map(c => cardOf(c).id), talents: r.talents, unlocked: r.unlocked }].concat(S.saved.filter(s => s.cards.join() !== r.cards.map(c => cardOf(c).id).join())).slice(0, 8);
        store.set('saved', S.saved); renderOptSide(); toast('Deck enregistré');
      }
      if (e.target.closest('#r-duel')) {
        S.duel = S.duel || defaultDuel();
        S.duel.a = r.cards.map((c, i) => ({ id: cardOf(c).id, talent: r.talents[i] || 0 }));
        store.set('duel', S.duel); setTab('duel');
      }
      if (e.target.closest('#run-up')) runUpgrades(r);
      if (e.target.closest('#run-shop')) runShop(r);
    });
    main.addEventListener('change', e => {
      const s = e.target.closest('[data-shop]');
      if (s) S.shopPick[+s.dataset.shop] = s.value;
    });
    main.addEventListener('keydown', e => { if ((e.key === 'Enter') && e.target.closest('[data-open]')) openCard(e.target.closest('[data-open]').dataset.open); });
  }
  async function runUpgrades(r) {
    const os = resOpp();
    const res = await runJob('up', 'upgrades', { owned: ownedInput(), gauntlet: os.decks, weights: os.weights, opt: simOpt(), best: { cards: r.cards, talents: r.talents, unlocked: r.unlocked || [0, 0, 0, 0] }, limit: 20, games: 120, seed: 31 }, 'up');
    if (!res) return;
    S.upgrades = res;
    const el = $('#up-list'); if (el) el.innerHTML = renderUpgrades();
  }
  async function runShop(r) {
    $$('[data-shop]').forEach(i => { S.shopPick[+i.dataset.shop] = i.value; });
    const cands = S.shopPick.map(findCard).filter(Boolean).map(d => d.idx);
    if (!cands.length) { toast('Saisis au moins une carte proposée'); return; }
    const os = resOpp();
    const res = await runJob('shop', 'upgrades', { owned: ownedInput(), gauntlet: os.decks, weights: os.weights, opt: simOpt(), best: { cards: r.cards, talents: r.talents, unlocked: r.unlocked || [0, 0, 0, 0] }, candidates: [...new Set(cands)], limit: 4, games: 96, seed: 32 }, 'shop');
    if (!res) return;
    S.shopRes = res;
    const el = $('#shop-list'); if (el) el.innerHTML = renderShop();
  }
  async function evalSaved(i) {
    const s = S.saved[i];
    if (!s || !s.cards.every(id => byId[id])) { toast('Deck introuvable dans les données actuelles'); return; }
    const os = oppSet();
    const res = await runJob('opt', 'evaluateDeck', { deck: s.cards.map((id, k) => ({ card: byId[id].idx, talent: s.talents[k] || 0, unlocked: (s.unlocked || [])[k] || 0 })), gauntlet: os.decks, weights: os.weights, opt: simOpt(), games: 320 }, 'opt');
    if (!res) return;
    if (!S.res || !S.res.meta || S.res.meta.objective !== S.objective) S.res = { results: [], meta: { opp: oppIds(os.list), objective: S.objective, vs: VS_LABEL[S.objective] || 'joueurs simulés' } };
    S.res.results = [res].concat(S.res.results.filter(x => x.cards.join() !== res.cards.join()));
    S.sel = 0; S.upgrades = null; S.shopRes = null;
    renderOptimizer();
  }
  // adversaires du résultat affiché (pour comparer à armes égales)
  function resOpp() {
    const list = oppOf(S.res).filter(d => d.deck.every(x => x.card >= 0));
    const obj = S.res && S.res.meta ? S.res.meta.objective : S.objective;
    return { decks: list.map(d => d.deck), weights: weightsFor(list, obj) };
  }
  function findCard(name) {
    const n = E.norm(String(name || '').trim());
    if (!n) return null;
    return E.DB.cards.find(d => E.norm(d.name) === n) || E.DB.cards.find(d => E.norm(d.name).startsWith(n)) || null;
  }

  // ================================================================== DUEL
  function defaultDuel() {
    const md = metaDecks();
    const a = STARTERS.slice(0, 4).map(id => ({ id, talent: 0 }));
    const b = md[0] ? md[0].deck.map(x => ({ id: cardOf(x.card).id, talent: x.talent })) : STARTERS.slice(2, 6).map(id => ({ id, talent: 0 }));
    return { a, b, games: 400 };
  }
  function slotHTML(side, i, s) {
    const d = s && byId[s.id];
    const opts = d ? ['<option value="0">Sans talent</option>'].concat(d.talents.map((t, k) => `<option value="${k + 1}" ${s.talent === k + 1 ? 'selected' : ''}>${esc(t.name)}</option>`)).join('') : '<option>—</option>';
    return `<div class="slot" style="--c:${d ? elColor(d.element) : 'var(--line)'}">${d ? `<img src="${imgOf(d)}" alt="" data-open="${d.id}">` : '<span class="ph"></span>'}
      <input class="input" list="dl-all" data-slot="${side}${i}" value="${d ? esc(d.name) : ''}" placeholder="Carte ${i + 1}">
      <select class="input" data-tal="${side}${i}" ${d ? '' : 'disabled'} aria-label="Talent">${opts}</select></div>`;
  }
  function renderDuel() {
    if (!S.duel) S.duel = defaultDuel();
    const D = S.duel;
    const md = metaDecks();
    const metaOpts = md.map((m, i) => `<option value="${i}">${m.group === 'meta' ? 'Méta' : 'Joué'} : ${m.deck.map(x => shortName(cardOf(x.card))).join(' · ')}</option>`).join('');
    $('#duel-top').innerHTML = `
      <div class="duel-layout">
        <section class="panel stack"><div class="row"><div><div class="eyebrow">Deck A</div><h2>Mon deck</h2></div><span class="spacer"></span>
          ${S.res ? '<button type="button" class="btn sm" data-load="a-best">Mon meilleur deck</button>' : ''}</div>
          <input class="input" data-code="a" placeholder="Coller un code de deck (DECK:…)" aria-label="Code du deck A">
          <div class="slots">${[0, 1, 2, 3].map(i => slotHTML('a', i, D.a[i])).join('')}</div></section>
        <section class="panel stack"><div class="row"><div><div class="eyebrow">Deck B</div><h2>Adversaire</h2></div><span class="spacer"></span>
          <select class="input" id="load-meta" aria-label="Charger un deck de référence" style="max-width:100%"><option value="">Charger un deck de référence…</option>${metaOpts}</select></div>
          <input class="input" data-code="b" placeholder="Coller un code de deck (DECK:…)" aria-label="Code du deck B">
          <div class="slots">${[0, 1, 2, 3].map(i => slotHTML('b', i, D.b[i])).join('')}</div>
          <div><button type="button" class="btn sm ghost" id="b-to-foes">Noter ce deck dans mon journal de classé</button></div></section>
      </div>
      <div class="row" style="margin-top:14px">
        <button type="button" class="btn primary big" id="run-duel" data-needs-idle>Lancer ${D.games} parties</button>
        <div class="seg" id="duel-games">${[200, 400, 1000].map(g => `<button type="button" data-g="${g}" aria-pressed="${D.games === g}">${g}</button>`).join('')}</div>
        <button type="button" class="btn" id="swap-duel">Inverser A et B</button>
        <button type="button" class="btn" id="counter" data-needs-idle title="Cherche dans ta collection le deck qui bat le mieux le deck B">Trouver mon meilleur contre B</button>
      </div>
      <div class="progress" data-progress="duel" hidden style="margin-top:10px"><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>`;
    renderDuelRes();
    renderProgress(); updateBusy();
  }
  function renderDuelRes() {
    const R = S.duelRes, box = $('#duel-res');
    if (!R) { box.innerHTML = `<div class="panel empty"><h3>Compose deux decks et lance le duel</h3><p>Tu obtiens le taux de victoire, la durée des parties et le déroulé commenté d'une partie type.</p></div>`; return; }
    const maxH = Math.max(1, ...R.hist);
    const hist = R.hist.slice(1).map((v, i) => `<i style="height:${(v / maxH * 100).toFixed(1)}%" title="${v} parties en ${i + 1} tours"></i>`).join('');
    let logHTML = '';
    for (const l of R.log) {
      if (l.t === 'turn') logHTML += `<div class="lt ${l.side ? 'b' : ''}">${l.side ? 'Adversaire (B)' : 'Toi (A)'} · tour ${l.turn}<span class="bn">bonus : ${l.bonus.map((v, i) => v ? `${E.ELN[i]} ${v}` : '').filter(Boolean).join(', ') || 'aucun'} · ${l.spam} Spamtons</span></div>`;
      else if (l.t === 'cast') logHTML += `<div class="lc"><b>${esc(l.card)}</b> ▸ <span class="ab">${esc(l.ab)}</span> : ${esc(l.text)}</div>`;
      else if (l.t === 'death') logHTML += `<div class="ld">✖ ${esc(l.text)}</div>`;
      else if (l.t === 'shop') logHTML += `<div class="ls">◉ ${esc(l.text)}</div>`;
      else if (l.t === 'end') logHTML += `<div class="le">${l.side === 0 ? 'Victoire de A' : l.side === 1 ? 'Victoire de B' : 'Égalité'} — ${esc(l.text)}</div>`;
    }
    box.innerHTML = `<div class="cols2">
      <section class="panel stack"><h3>Résultat sur ${fmt(R.games)} parties</h3>
        <div class="hero" style="grid-template-columns:180px minmax(0,1fr)"><div class="gauge" style="width:170px">${gaugeSVG(R.wr)}<div class="val"><b class="num">${Math.round(R.wr * 100)}%</b><span>victoires de A</span></div></div>
        <div class="kpis"><div class="kpi"><div class="k">Durée moyenne</div><div class="v num">${R.turns.toFixed(1).replace('.', ',')} tours</div></div>
          <div class="kpi"><div class="k">A en commençant</div><div class="v num">${R.firstWr == null ? '—' : pct(R.firstWr)}</div></div>
          <div class="kpi"><div class="k">A en second</div><div class="v num">${R.secondWr == null ? '—' : pct(R.secondWr)}</div></div>
          <div class="kpi"><div class="k">Dégâts A / B</div><div class="v num">${fmt(R.dmgA)} / ${fmt(R.dmgB)}</div></div></div></div>
        <div><div class="eyebrow">Durée des parties (tours)</div><div class="hist">${hist}</div><div class="histax">${[1, 5, 10, 15, 20, 25, 30].map(t => `<span style="left:${((t - 0.5) / 30 * 100).toFixed(2)}%">${t}</span>`).join('')}</div></div>
      </section>
      <section class="panel stack"><h3>Partie commentée</h3><p class="xs mute">Une partie représentative du résultat${R.terrain >= 0 ? ` (terrain : ${E.ELN[R.terrain]})` : ''}.</p><div class="log">${logHTML}</div></section>
    </div>`;
  }
  function duelDecks() {
    const D = S.duel;
    const ok = s => s && byId[s.id];
    if (D.a.length < 4 || D.b.length < 4 || !D.a.every(ok) || !D.b.every(ok)) return null;
    const conv = arr => arr.map(s => ({ card: byId[s.id].idx, talent: s.talent || 0 }));
    return { a: conv(D.a), b: conv(D.b) };
  }
  function bindDuel() {
    const top = $('#duel-top');
    top.addEventListener('change', e => {
      const D = S.duel;
      const sl = e.target.closest('[data-slot]');
      if (sl) {
        const side = sl.dataset.slot[0], i = +sl.dataset.slot[1];
        const d = findCard(sl.value);
        if (d) { D[side][i] = { id: d.id, talent: 0 }; store.set('duel', D); renderDuel(); }
        return;
      }
      const cd = e.target.closest('[data-code]');
      if (cd) {
        const deck = parseDeckCode(cd.value);
        if (!deck) { toast('Code invalide : format attendu DECK:12-34.1-56-78'); return; }
        D[cd.dataset.code] = deck; store.set('duel', D); S.duelRes = null; renderDuel(); toast('Deck chargé');
        return;
      }
      const tl = e.target.closest('[data-tal]');
      if (tl) { const side = tl.dataset.tal[0], i = +tl.dataset.tal[1]; if (D[side][i]) D[side][i].talent = +tl.value; store.set('duel', D); return; }
      if (e.target.id === 'load-meta' && e.target.value !== '') {
        const m = metaDecks()[+e.target.value];
        D.b = m.deck.map(x => ({ id: cardOf(x.card).id, talent: x.talent }));
        store.set('duel', D); renderDuel();
      }
    });
    top.addEventListener('click', async e => {
      const D = S.duel;
      const g = e.target.closest('[data-g]');
      if (g) { D.games = +g.dataset.g; store.set('duel', D); renderDuel(); return; }
      if (e.target.closest('[data-open]')) { openCard(e.target.closest('[data-open]').dataset.open); return; }
      if (e.target.closest('[data-cancel]')) { Runner.cancel(); return; }
      if (e.target.closest('[data-load="a-best"]') && S.res) {
        const r = S.res.results[S.sel] || S.res.results[0];
        D.a = r.cards.map((c, i) => ({ id: cardOf(c).id, talent: r.talents[i] || 0 }));
        store.set('duel', D); renderDuel(); return;
      }
      if (e.target.closest('#b-to-foes')) {
        if (!D.b.every(x => x && byId[x.id])) { toast('Complète les 4 cartes du deck B'); return; }
        S.foes.push({ cards: D.b.map(x => x.id), result: null, deck: null, ts: Date.now() });
        saveFoes(); renderCounts(); toast('Deck ajouté à ton journal de classé');
        return;
      }
      if (e.target.closest('#swap-duel')) { const t = D.a; D.a = D.b; D.b = t; store.set('duel', D); S.duelRes = null; renderDuel(); return; }
      if (e.target.closest('#run-duel')) {
        const dd = duelDecks();
        if (!dd) { toast('Complète les 4 cartes de chaque deck'); return; }
        const res = await runJob('duel', 'duel', { a: dd.a, b: dd.b, games: D.games, opt: simOpt(), seed: Math.floor(Math.random() * 1e9) }, 'duel');
        if (res) { S.duelRes = res; renderDuelRes(); }
        return;
      }
      if (e.target.closest('#counter')) {
        const dd = duelDecks();
        if (!dd) { toast('Complète les 4 cartes du deck B'); return; }
        if (ownedIds().length < 4) { toast('Ajoute au moins 4 cartes à ta collection'); return; }
        setTab('optimizer');
        await runOptimize({ gauntlet: [dd.b], weights: [1], vsLabel: 'deck B', opp: [{ group: 'duel', cards: S.duel.b.map(x => x.id), talents: S.duel.b.map(x => x.talent || 0) }] });
      }
    });
  }

  // ================================================================== CLASSÉ
  function myDeckOptions() {
    const opts = [];
    if (S.res && S.res.results[S.sel]) { const r = S.res.results[S.sel]; opts.push({ v: 'best', label: 'Deck affiché dans l\'optimiseur : ' + r.cards.map(c => shortName(cardOf(c))).join(' · '), ids: r.cards.map(c => cardOf(c).id) }); }
    S.saved.forEach((sv, i) => opts.push({ v: 'saved' + i, label: sv.name, ids: sv.cards }));
    opts.push({ v: 'none', label: 'Non précisé', ids: null });
    return opts;
  }
  // courbe du taux de victoire cumulé (une seule série : pas de légende, le titre la nomme)
  function rankedChart(played) {
    if (played.length < 2) return '';
    const W = 640, H = 170, L = 48, R = 12, T = 14, B = 26;
    const pts = [];
    let w = 0;
    played.forEach((f, k) => { if (f.result === 'W') w++; pts.push({ k, v: w / (k + 1), f }); });
    const x = k => L + (played.length === 1 ? 0 : k * (W - L - R) / (played.length - 1));
    const y = v => T + (1 - v) * (H - T - B);
    const grid = [0, 0.5, 1].map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)" stroke-width="1" ${v === 0.5 ? 'stroke-dasharray="4 4"' : ''}/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" style="fill:var(--faint)">${Math.round(v * 100)} %</text>`).join('');
    const path = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.k).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
    const area = `${path} L${x(pts[pts.length - 1].k).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
    const dots = pts.map(p => `<g><circle cx="${x(p.k).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="10" fill="transparent"><title>Match ${p.k + 1} : ${p.f.result === 'W' ? 'victoire' : 'défaite'} · taux cumulé ${Math.round(p.v * 100)} %</title></circle>
      <circle cx="${x(p.k).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4.5" style="fill:${p.f.result === 'W' ? 'var(--good)' : 'var(--bad)'};stroke:var(--panel)" stroke-width="2" pointer-events="none"/></g>`).join('');
    const last = pts[pts.length - 1];
    return `<div class="stack" style="gap:6px"><div class="eyebrow">Évolution de ton taux de victoire (cumulé)</div>
      <svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Taux de victoire cumulé : ${Math.round(last.v * 100)} % après ${played.length} matchs" style="max-width:100%;height:auto">
        ${grid}<path d="${area}" style="fill:var(--gold);opacity:0.10"/><path d="${path}" fill="none" style="stroke:var(--gold)" stroke-width="2" stroke-linejoin="round"/>${dots}
        <text x="${L}" y="${H - 6}" font-size="11" style="fill:var(--faint)">match 1</text><text x="${W - R}" y="${H - 6}" font-size="11" style="fill:var(--faint)" text-anchor="end">match ${played.length}</text>
      </svg><span class="xs faint">Point vert = victoire, rouge = défaite ; survole un point pour le détail.</span></div>`;
  }
  function renderRanked() {
    const decks = foeDecks();
    const played = S.foes.filter(f => f.result);
    const w = played.filter(f => f.result === 'W').length, l = played.length - w;
    // cartes les plus vues (y compris decks incomplets)
    const seen = {};
    S.foes.forEach(f => (f.cards || []).forEach(id => { if (byId[id]) seen[id] = (seen[id] || 0) + 1; }));
    const seenTop = Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 16);
    // bilan par deck joué
    const byMine = {};
    played.forEach(f => { if (!f.deck) return; const k = f.deck.join(); const g = byMine[k] || (byMine[k] = { ids: f.deck, w: 0, n: 0 }); g.n++; if (f.result === 'W') g.w++; });
    const mine = Object.values(byMine).sort((a, b) => b.n - a.n);
    const opts = myDeckOptions();
    if (!opts.some(o => o.v === S.foeDeck)) S.foeDeck = opts[0].v;
    const hist = S.foes.slice().reverse().slice(0, 20);
    const streak = { r: null, n: 0 };
    for (let k = played.length - 1; k >= 0; k--) { if (!streak.r) streak.r = played[k].result; if (played[k].result !== streak.r) break; streak.n++; }
    $('#ranked-body').innerHTML = `
      <div class="ranked-layout">
        <section class="panel stack">
          <div><div class="eyebrow">Journal de classé</div><h2>Noter un match</h2></div>
          <p class="small mute">Entre les cartes de ton adversaire (même partiellement) puis le résultat. Deckforge en déduit ta vraie méta et peut optimiser ton deck contre elle.</p>
          <div class="foe-inputs">${S.foeDraft.map((v, i) => `<input class="input" list="dl-all" data-foe="${i}" placeholder="Carte adverse ${i + 1}" value="${esc(v)}">`).join('')}</div>
          <input class="input" id="foe-code" placeholder="ou colle un code de deck (DECK:…)">
          <label class="field">Mon deck
            <select class="input" id="foe-mine">${opts.map(o => `<option value="${o.v}" ${o.v === S.foeDeck ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></label>
          <div class="row"><button type="button" class="btn primary" data-foe-res="W">Victoire</button><button type="button" class="btn" data-foe-res="L" style="border-color:var(--bad)">Défaite</button><button type="button" class="btn ghost" data-foe-res="">Noter sans résultat</button></div>
        </section>
        <section class="panel stack">
          <div class="row"><div><div class="eyebrow">Mon bilan</div><h2>${played.length ? pct(w / played.length) + ' de victoires' : 'Aucun match noté'}</h2></div><span class="spacer"></span>
            <button type="button" class="btn primary" id="opt-foes" data-needs-idle ${decks.length ? '' : 'disabled'}>Optimiser contre mes adversaires</button></div>
          <div class="kpis"><div class="kpi"><div class="k">Matchs notés</div><div class="v num">${S.foes.length}</div></div>
            <div class="kpi"><div class="k">Victoires</div><div class="v num" style="color:var(--good)">${w}</div></div>
            <div class="kpi"><div class="k">Défaites</div><div class="v num" style="color:var(--bad)">${l}</div></div>
            <div class="kpi"><div class="k">Série en cours</div><div class="v num" style="color:${streak.r === 'W' ? 'var(--good)' : streak.r === 'L' ? 'var(--bad)' : 'var(--ink)'}">${streak.n ? streak.n + (streak.r === 'W' ? ' V' : ' D') : '—'}</div></div>
            <div class="kpi"><div class="k">Decks complets</div><div class="v num">${decks.length}</div></div></div>
          ${rankedChart(played)}
          ${mine.length ? `<div class="stack" style="gap:6px"><div class="eyebrow">Par deck joué</div><div class="bars">${mine.map(g => `<div class="brow"><span class="lab">${g.ids.map(id => byId[id] ? esc(shortName(byId[id])) : '?').join(' · ')} <span class="faint xs">(${g.n})</span></span><span class="track"><i style="width:${Math.round(g.w / g.n * 100)}%;background:${g.w / g.n >= 0.5 ? 'var(--good)' : 'var(--bad)'}"></i></span><span class="pct">${pct(g.w / g.n)}</span></div>`).join('')}</div></div>` : ''}
          ${seenTop.length ? `<div class="stack" style="gap:8px"><div class="eyebrow">Cartes les plus jouées contre toi</div><div class="seen">${seenTop.map(([id, n]) => { const d = byId[id]; return `<span class="sc" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="${esc(d.name)}" title="${esc(d.name)} · vue ${n} fois" data-open="${id}"><b>${n}</b></span>`; }).join('')}</div></div>` : '<p class="small mute">Note quelques matchs pour voir apparaître les cartes les plus jouées à ton niveau.</p>'}
          <div class="progress" data-progress="ranked" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>
        </section>
      </div>
      ${decks.length ? `<section class="panel stack" style="margin-top:16px"><h3>Decks adverses rencontrés</h3><div class="metalist">${decks.map((g, i) => `<div class="metadeck"><span class="rank" style="font-family:var(--display);color:var(--mute)">${g.n}×</span>${g.cards.map(id => { const c = byId[id]; return `<img src="${imgOf(c)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--c:${elColor(c.element)}" data-open="${id}">`; }).join('')}
          <div class="names">${g.cards.map(id => `<b>${esc(byId[id].name)}</b>`).join('<br>')}</div>
          <div class="act row"><span class="tag num">${g.w} V · ${g.l} D</span><button type="button" class="btn sm" data-foe-duel="${i}">Affronter</button></div></div>`).join('')}</div></section>` : ''}
      ${hist.length ? `<section class="panel stack" style="margin-top:16px"><h3>Derniers matchs</h3><div class="stack" style="gap:6px">${hist.map(f => {
        const k = S.foes.indexOf(f);
        return `<div class="hist-row"><span class="res-pill ${f.result === 'W' ? 'w' : f.result === 'L' ? 'l' : 'n'}">${f.result === 'W' ? 'V' : f.result === 'L' ? 'D' : '·'}</span>
          <span class="small">${(f.cards || []).map(id => byId[id] ? esc(byId[id].name) : '?').join(' · ')} <span class="faint xs">${new Date(f.ts).toLocaleDateString('fr-FR')}</span></span>
          <button type="button" class="info" data-foe-del="${k}" aria-label="Supprimer ce match">Supprimer</button></div>`;
      }).join('')}</div></section>` : ''}`;
    renderProgress(); updateBusy();
  }
  function bindRanked() {
    const box = $('#ranked-body');
    box.addEventListener('change', e => {
      const f = e.target.closest('[data-foe]');
      if (f) { S.foeDraft[+f.dataset.foe] = f.value; return; }
      if (e.target.id === 'foe-mine') { S.foeDeck = e.target.value; return; }
      if (e.target.id === 'foe-code') {
        const deck = parseDeckCode(e.target.value);
        if (!deck) { toast('Code invalide : format attendu DECK:12-34.1-56-78'); return; }
        S.foeDraft = deck.map(x => byId[x.id].name); renderRanked();
      }
    });
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-open]')) { openCard(e.target.closest('[data-open]').dataset.open); return; }
      if (e.target.closest('[data-cancel]')) { Runner.cancel(); return; }
      const rb = e.target.closest('[data-foe-res]');
      if (rb) {
        $$('[data-foe]', box).forEach(i => { S.foeDraft[+i.dataset.foe] = i.value; });
        const ids = [...new Set(S.foeDraft.map(findCard).filter(Boolean).map(d => d.id))];
        if (!ids.length) { toast('Saisis au moins une carte adverse'); return; }
        const mine = myDeckOptions().find(o => o.v === S.foeDeck);
        S.foes.push({ cards: ids, result: rb.dataset.foeRes || null, deck: mine && mine.ids ? mine.ids : null, ts: Date.now() });
        saveFoes();
        S.foeDraft = ['', '', '', ''];
        renderRanked(); renderCounts();
        toast(ids.length === 4 ? 'Match noté' : `Match noté (${ids.length} carte${ids.length > 1 ? 's' : ''} adverse${ids.length > 1 ? 's' : ''} : compte pour les statistiques, pas pour l'optimisation)`);
        return;
      }
      const del = e.target.closest('[data-foe-del]');
      if (del) { S.foes.splice(+del.dataset.foeDel, 1); saveFoes(); renderRanked(); renderCounts(); return; }
      const fd = e.target.closest('[data-foe-duel]');
      if (fd) {
        const g = foeDecks()[+fd.dataset.foeDuel];
        const tal = O.guessTalents(g.cards.map(id => byId[id]), [1, 1, 1, 1]);
        S.duel = S.duel || defaultDuel();
        S.duel.b = g.cards.map((id, i) => ({ id, talent: tal[i] }));
        store.set('duel', S.duel); setTab('duel'); return;
      }
      if (e.target.closest('#opt-foes')) {
        if (ownedIds().length < 4) { toast('Ajoute au moins 4 cartes à ta collection'); return; }
        S.objective = 'foes'; store.set('objective', 'foes');
        setTab('optimizer');
        await runOptimize();
      }
    });
  }

  // ================================================================== WINRATES
  // Winrate réaliste : chaque deck contre la population de joueurs simulés (pondérée par fréquence).
  const wrData = () => (S.wr && S.wr.format === 3 && S.wr.decks && S.wr.decks.length ? S.wr : DEFAULT_WR);
  function heat(v) {
    if (v == null) return '';
    const d = Math.max(-1, Math.min(1, (v - 0.5) * 2));
    const c = d >= 0 ? 'var(--good)' : 'var(--bad)';
    return `background:color-mix(in srgb, ${c} ${Math.round(Math.abs(d) * 55 + 6)}%, var(--bg2))`;
  }
  let WROWS = null, WROWS_KEY = null;
  function wrRows() {
    const W = wrData();
    const key = W.generated + '|' + Object.keys(S.coll).join(',').length;
    if (WROWS && WROWS_KEY === key) return WROWS;
    WROWS = (W.decks || []).map((d, i) => {
      if (!d.cards.every(id => byId[id]) || d.wr == null || typeof d.wr !== 'number') return null;
      return { i, d, w: d.wr, vm: d.wr, va: d.wr, global: d.wr, turns: d.turns, share: d.share || 0, tox: d.tox || [], playable: d.cards.every(id => S.coll[id] != null) };
    }).filter(Boolean);
    WROWS_KEY = key;
    return WROWS;
  }
  function toxLabel(k) {
    const m = String(k).match(/^(.*?)(\d)$/);
    return m ? `${E.TOX_NAMES[m[1]] || m[1]} ${['C', 'R', 'É', 'L'][+m[2]] || ''}` : k;
  }
  function toxTitle(t) {
    const m = String(t[0]).match(/^(.*?)(\d)$/);
    return `${m ? (E.TOX_NAMES[m[1]] || m[1]) + ' ' + TIER_NAME[+m[2]] : t[0]} : acheté dans ${Math.round(t[1] * 100)} % des parties, ${t[2] >= 0 ? '+' : '−'}${Math.abs(Math.round(t[2] * 100))} pts de victoire quand il est acheté`;
  }
  function renderWinrates() {
    const W = wrData();
    if (!W.decks || !W.decks.length) return '';
    const V = S.wv;
    const all = wrRows();
    let rows = all.slice();
    const counts = { all: rows.length, play: rows.filter(r => r.playable).length, pop: rows.filter(r => r.share > 0).length };
    if (V.filter === 'play') rows = rows.filter(r => r.playable);
    else if (V.filter === 'pop') rows = rows.filter(r => r.share > 0);
    const cf = findCard(V.card);
    if (V.card && cf) rows = rows.filter(r => r.d.cards.includes(cf.id));
    rows.sort((a, b) => V.dir * (a.w - b.w));
    const shown = V.all ? rows : rows.slice(0, 30);
    const body = shown.map((r, k) => {
      const d = r.d;
      const names = d.cards.map((id, x) => { const c = byId[id]; const t = d.talents[x] ? c.talents[d.talents[x] - 1] : null; return `<b>${esc(shortName(c))}</b>${t ? ' <span class="faint">(' + esc(t.name) + ')</span>' : ''}`; }).join(' · ');
      const sub = [r.share > 0 ? `joué par ${Math.max(1, Math.round(r.share * 100))} % des joueurs` : '', r.playable ? '<span style="color:var(--gold)">jouable</span>' : ''].filter(Boolean).join(' · ');
      const tox = r.tox.filter(t => t[2] > 0).slice(0, 2).map(t => `<span class="tag" title="${esc(toxTitle(t))}">${esc(toxLabel(t[0]))}</span>`).join(' ');
      return `<tr><td class="rk">${k + 1}</td>
        <td><div class="wdeck"><span class="imgs">${d.cards.map(id => { const c = byId[id]; return `<img src="${imgOf(c)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--c:${elColor(c.element)}" data-open="${id}">`; }).join('')}</span><span class="nm">${names}${sub ? `<br><span class="xs">${sub}</span>` : ''}</span></div></td>
        <td class="n"><span class="wcell" style="${heat(r.w)}">${pct(r.w)}</span></td>
        <td>${tox || '<span class="faint xs">—</span>'}</td>
        <td class="n"><button type="button" class="btn sm" data-wduel="${r.i}">Affronter</button></td></tr>`;
    }).join('');
    const games = (W.decks.length * (W.oppCount || 0) * (W.games || 0));
    // matrice des 20 meilleurs
    const M = W.matrix || { idx: [], wr: [] };
    const top = M.idx.map(i => W.decks[i]).filter(d => d && d.cards.every(id => byId[id]));
    const lbl = d => esc(d.cards.map(id => byId[id].name).join(' + '));
    const mxHead = top.map((d, k) => `<th title="${lbl(d)}">${k + 1}</th>`).join('');
    const mxRows = top.map((d, k) => `<tr><th class="rl" title="${lbl(d)}">${k + 1}<span class="imgs">${d.cards.map(id => `<img src="${imgOf(byId[id])}" alt="">`).join('')}</span></th>${top.map((c, q) => {
      if (q === k) return '<td class="self">·</td>';
      const v = M.wr[k] && M.wr[k][q];
      return `<td style="${heat(v)}" title="Deck ${k + 1} contre deck ${q + 1} : ${v == null ? '—' : pct(v)}">${v == null ? '' : Math.round(v * 100)}</td>`;
    }).join('')}</tr>`).join('');
    return `<section class="panel stack">
        <div class="row"><div><div class="eyebrow">Simulations</div><h2>Winrate de tous les decks</h2></div><span class="spacer"></span>
          <button type="button" class="btn" id="wr-recalc" data-needs-idle>Recalculer (≈ 1 à 3 min)</button></div>
        <p class="small mute" style="max-width:84ch"><b style="color:var(--ink)">Winrate</b> = taux de victoire contre les decks réellement joués par <b style="color:var(--ink)">${W.players || '?'} joueurs simulés</b>. Chacun a une collection tirée selon une progression réaliste (les communes tombent plus souvent, les doublons débloquent les talents) et joue le meilleur deck de sa collection ; un deck adverse compte d'autant plus qu'il est joué souvent. La <b style="color:var(--ink)">boutique de Tox</b> est simulée dans chaque partie ; la colonne « Tox clés » donne ceux qui font le plus gagner le deck. ${fmt(games)} parties au total. Un écart de 2 à 3 points n'est pas significatif.${W.generated ? ` Calculé le ${new Date(W.generated).toLocaleDateString('fr-FR')}.` : ''}</p>
        <div class="progress" data-progress="wr" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>
        <div class="wtoolbar">
          <div class="seg" role="group" aria-label="Filtrer">${[['all', 'Tous'], ['pop', 'Joués'], ['play', 'Jouables']].map(([k, l]) => `<button type="button" data-wfilter="${k}" aria-pressed="${V.filter === k}">${l} <small style="display:inline">${counts[k] || 0}</small></button>`).join('')}</div>
          <input class="input" id="w-card" list="dl-all" placeholder="Contient la carte…" value="${esc(V.card)}">
          ${V.card ? '<button type="button" class="btn sm ghost" id="w-card-clear">Effacer</button>' : ''}
        </div>
        <div class="wscroll"><table class="wt"><thead><tr><th>#</th><th>Deck</th><th ${'aria-sort="' + (V.dir < 0 ? 'descending' : 'ascending') + '"'}><button type="button" data-wsort="w" title="Trier par winrate">Winrate ${V.dir < 0 ? '▼' : '▲'}</button></th><th title="Tox de boutique qui font le plus gagner ce deck (C, R, É, L = rareté)">Tox clés</th><th></th></tr></thead>
          <tbody>${body || '<tr><td colspan="5" class="mute">Aucun deck ne correspond à ce filtre.</td></tr>'}</tbody></table></div>
        ${rows.length > 30 ? `<div><button type="button" class="btn sm" data-wall>${V.all ? 'Afficher les 30 premiers' : `Afficher les ${rows.length} decks`}</button></div>` : ''}
      </section>
      ${top.length ? `<section class="panel stack" style="margin-top:16px">
        <div><div class="eyebrow">Face à face</div><h2>Matrice des matchups</h2></div>
        <p class="small mute" style="max-width:84ch">Les ${top.length} decks au meilleur Winrate, chacun contre chacun (${W.gamesMatrix || '?'} parties par duel) : chaque case donne le taux de victoire du deck de la ligne contre celui de la colonne. Survole un numéro pour voir le deck.</p>
        <div class="mx-wrap"><table class="mx"><thead><tr><th></th>${mxHead}</tr></thead><tbody>${mxRows}</tbody></table></div>
      </section>` : ''}`;
  }

  // ================================================================== META
  function metaRow(d, i) {
    return `<div class="metadeck"><span class="rank" style="font-family:var(--display);color:var(--mute)">${i + 1}</span>${d.deck.map(x => { const c = cardOf(x.card); return `<img src="${imgOf(c)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--c:${elColor(c.element)}" data-open="${c.id}">`; }).join('')}
      <div class="names">${d.deck.map(x => { const c = cardOf(x.card); return `<b>${esc(c.name)}</b>${x.talent ? ` <span class="faint xs">(${esc(c.talents[x.talent - 1].name)})</span>` : ''}`; }).join('<br>')}</div>
      <div class="act row">${d.wr != null ? `${d.group === 'meta' ? `<span class="tag num" title="Score contre les autres decks de la méta">${pct(d.wr)}</span>` : ''}` : ''}<button type="button" class="btn sm" data-meta-duel="${d.gi}">Affronter</button></div></div>`;
  }
  function renderMeta() {
    const md = metaDecks().map((d, gi) => Object.assign(d, { gi }));
    const m = S.meta || DEFAULT_META;
    const meta = md.filter(d => d.group === 'meta'), popd = md.filter(d => d.group === 'pop');
    const players = (DEFAULT_POP.decks || []).reduce((x, d) => x + d.n, 0) || 1;
    const popRow = (d, i) => `<div class="metadeck"><span class="rank" style="font-family:var(--display);color:var(--mute)">${i + 1}</span>${d.deck.map(x => { const c = cardOf(x.card); return `<img src="${imgOf(c)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--c:${elColor(c.element)}" data-open="${c.id}">`; }).join('')}
      <div class="names">${d.deck.map(x => { const c = cardOf(x.card); return `<b>${esc(c.name)}</b>${x.talent ? ` <span class="faint xs">(${esc(c.talents[x.talent - 1].name)})</span>` : ''}`; }).join('<br>')}</div>
      <div class="act row"><span class="tag num" title="Part des joueurs simulés qui jouent ce deck">${Math.max(1, Math.round(d.n / players * 100))} % des joueurs</span><button type="button" class="btn sm" data-meta-duel="${d.gi}">Affronter</button></div></div>`;
    $('#meta-body').innerHTML = renderWinrates() + `
      <section class="panel stack" style="margin-top:16px">
        <div><div class="eyebrow">Ce que jouent les joueurs simulés</div><h2>Decks les plus joués</h2></div>
        <p class="small mute" style="max-width:84ch">Les decks les plus fréquents dans la population de ${players} joueurs simulés. Ce sont les adversaires de l'objectif « Réaliste » de l'optimiseur, pondérés par leur fréquence.</p>
        <div class="metalist">${popd.slice(0, 15).map(popRow).join('')}</div>
      </section>
      <section class="panel stack" style="margin-top:16px">
        <div class="row"><div><div class="eyebrow">Le haut du classement</div><h2>Méta simulée</h2></div><span class="spacer"></span>
          <button type="button" class="btn" id="meta-recalc" data-needs-idle>Recalculer la méta (≈ 1 à 2 min)</button>
          ${S.meta ? '<button type="button" class="btn ghost" id="meta-reset">Méta par défaut</button>' : ''}</div>
        <p class="small mute" style="max-width:84ch">Les decks les plus forts trouvés en optimisant sur toutes les cartes (tous talents débloqués), puis en réoptimisant plusieurs fois contre les meilleurs decks trouvés. C'est l'adversaire de l'objectif « Top 1 ». ${m.generated ? `Calculée le ${new Date(m.generated).toLocaleDateString('fr-FR')} sur le SpamDex ${esc(m.version)}.` : ''}</p>
        <div class="progress" data-progress="meta" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg small mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>
        <div class="metalist">${meta.map(metaRow).join('')}</div>
      </section>
      ${renderTierList()}`;
    renderProgress(); updateBusy();
  }
  function renderTierList() {
    if (!TIERS.cards || !Object.keys(TIERS.cards).length) return '';
    const groups = { S: [], A: [], B: [], C: [], D: [] };
    E.DB.cards.forEach(d => { const t = tierOf(d); if (t && groups[t.tier]) groups[t.tier].push([d, t]); });
    const lbl = { S: 'Pièces maîtresses', A: 'Très fortes', B: 'Solides', C: 'Situationnelles', D: 'Faibles en classé' };
    const rows = Object.keys(groups).filter(k => groups[k].length).map(k => {
      const imgs = groups[k].sort((a, b) => b[1].wr - a[1].wr).map(([d, t]) =>
        `<img src="${imgOf(d)}" alt="${esc(d.name)}" title="${esc(d.name)} · ${pct(t.wr)}" style="--c:${elColor(d.element)}" class="${S.coll[d.id] != null ? 'own' : ''}" data-open="${d.id}">`).join('');
      return `<div class="tierrow"><span class="tier t-${k}" title="${lbl[k]}">${k}</span><div class="stack" style="gap:4px"><span class="xs mute">${lbl[k]} · ${groups[k].length} cartes</span><div class="tiercards">${imgs}</div></div></div>`;
    }).join('');
    return `<section class="panel stack" style="margin-top:16px">
      <div><div class="eyebrow">Tier list</div><h2>Classement des cartes</h2></div>
      <p class="small mute" style="max-width:78ch">Pour chaque carte, Deckforge a cherché le meilleur deck qui la contient (toutes cartes et talents disponibles) et mesuré son Winrate réaliste dans le tableau ci-dessus ; le tier vient de ce Winrate. Une carte faible seule peut être excellente dans le bon deck : ce classement le montre. Les cartes entourées d'or sont dans ta collection ; clique pour voir la fiche et son deck idéal.</p>
      <div class="tierlist">${rows}</div>
    </section>`;
  }
  function bindMeta() {
    $('#meta-body').addEventListener('change', e => {
      if (e.target.id === 'w-card') { S.wv.card = e.target.value; renderMeta(); }
    });
    $('#meta-body').addEventListener('click', async e => {
      const ws = e.target.closest('[data-wsort]');
      if (ws) { S.wv.dir = -S.wv.dir; renderMeta(); return; }
      const wf = e.target.closest('[data-wfilter]');
      if (wf) { S.wv.filter = wf.dataset.wfilter; renderMeta(); return; }
      if (e.target.closest('#w-card-clear')) { S.wv.card = ''; renderMeta(); return; }
      if (e.target.closest('[data-wall]')) { S.wv.all = !S.wv.all; renderMeta(); return; }
      const wd = e.target.closest('[data-wduel]');
      if (wd) {
        const d = wrData().decks[+wd.dataset.wduel];
        S.duel = S.duel || defaultDuel();
        S.duel.b = d.cards.map((id, k) => ({ id, talent: d.talents[k] || 0 }));
        store.set('duel', S.duel); setTab('duel'); return;
      }
      if (e.target.closest('#wr-recalc')) {
        const cur = S.meta || DEFAULT_META;
        const decks = [];
        const seen = new Set();
        const add = (d, group) => {
          if (!d.cards.every(id => byId[id])) return;
          const k = d.cards.slice().sort().join();
          if (seen.has(k)) return;
          seen.add(k); decks.push({ group, cards: d.cards, talents: d.talents.map(x => x || 0) });
        };
        cur.decks.forEach(d => add(d, 'meta'));
        wrData().decks.forEach(d => add(d, d.group || 'tier'));
        Object.values(TIERS.cards || {}).forEach(t => add(t, 'tier'));
        const popD = (DEFAULT_POP.decks || []).filter(d => d.cards.every(id => byId[id]));
        const players = popD.reduce((x, d) => x + d.n, 0);
        const share = {};
        popD.forEach(d => { const k = d.cards.slice().sort().join(); share[k] = (share[k] || 0) + d.n / players; });
        const conv = d => d.cards.map((id, k) => ({ card: byId[id].idx, talent: d.talents[k] || 0 }));
        const res = await runJob('wr', 'winrateTable', { decks: decks.map(conv), opp: popD.map(conv), oppW: popD.map(d => d.n / players), games: 12, gamesMatrix: 40, opt: simOpt() }, 'wr');
        if (!res) return;
        S.wr = { format: 3, generated: new Date().toISOString(), games: res.games, gamesMatrix: res.gamesMatrix, players, oppCount: popD.length, matrix: res.matrix,
          decks: decks.map((d, i) => Object.assign(d, { wr: +res.wr[i].toFixed(3), turns: +res.turns[i].toFixed(1), share: +(share[d.cards.slice().sort().join()] || 0).toFixed(3), tox: res.tox[i] })) };
        store.set('winrates', S.wr);
        CSTATS = null; WROWS = null;
        renderMeta(); toast('Winrates recalculés');
        return;
      }
      if (e.target.closest('[data-open]')) { openCard(e.target.closest('[data-open]').dataset.open); return; }
      if (e.target.closest('[data-cancel]')) { Runner.cancel(); return; }
      const md = e.target.closest('[data-meta-duel]');
      if (md) {
        S.duel = S.duel || defaultDuel();
        S.duel.b = metaDecks()[+md.dataset.metaDuel].deck.map(x => ({ id: cardOf(x.card).id, talent: x.talent }));
        store.set('duel', S.duel); setTab('duel'); return;
      }
      if (e.target.closest('#meta-reset')) { S.meta = null; store.set('meta', null); renderMeta(); toast('Méta par défaut restaurée'); return; }
      if (e.target.closest('#meta-recalc')) {
        const res = await runJob('meta', 'computeMeta', { quality: 'fast', rounds: 3, opt: simOpt(), start: metaDecks().map(d => d.deck), seed: Math.floor(Math.random() * 1e9) }, 'meta');
        if (!res) return;
        const cur = S.meta || DEFAULT_META;
        S.meta = { version: E.DB.version, generated: new Date().toISOString(), decks: res.decks.map(d => ({ cards: d.map(x => cardOf(x.card).id), talents: d.map(x => x.talent) })), ladder: cur.ladder || DEFAULT_META.ladder || [] };
        store.set('meta', S.meta);
        renderMeta();
        toast('Nouvelle méta calculée : relance l\'optimiseur pour en tenir compte');
      }
    });
  }

  // ================================================================== GUIDE
  function renderGuide() {
    const artists = {};
    RAW.cards.forEach(c => { const a = c.artwork && c.artwork.artist; if (a) { (artists[a.name] = artists[a.name] || { link: a.link, cards: [] }).cards.push(c.name); } });
    $('#credits').innerHTML = Object.keys(artists).sort((a, b) => a.localeCompare(b, 'fr')).map(n => `<div>${artists[n].link ? `<a href="${esc(artists[n].link)}" target="_blank" rel="noopener">${esc(n)}</a>` : esc(n)} <span class="faint">(${artists[n].cards.length})</span></div>`).join('');
  }

  // ================================================================== MISE À JOUR DES DONNÉES
  async function checkUpdate(manual) {
    try {
      const idx = await fetch(DATA_BASE + 'index.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      S.online = true;
      const latest = idx.latest;
      if (latest && latest !== E.DB.version) {
        const cards = await fetch(DATA_BASE + String(idx.cards || '{version}/cards.{language}.json').replace('{version}', latest).replace('{language}', 'fr'), { cache: 'no-store' }).then(r => r.json());
        if (cards && cards.cards && cards.cards.length) {
          loadData(cards);
          Runner.start();
          S.res = loadRes();
          renderAll();
          toast(`Données mises à jour : SpamDex ${latest} (${cards.cards.length} cartes)`);
        }
      } else if (manual) toast(`Déjà à jour : SpamDex ${E.DB.version}`);
    } catch (e) {
      S.online = false;
      if (manual) toast('spamgame.com injoignable : les données intégrées sont utilisées');
    }
    renderCounts();
  }

  // ================================================================== INIT
  function renderDatalists() {
    $('#dl-all').innerHTML = E.DB.cards.map(d => `<option value="${esc(d.name)}"></option>`).join('');
    $('#dl-owned').innerHTML = ownedIds().map(id => `<option value="${esc(byId[id].name)}"></option>`).join('');
  }
  function renderAll() {
    renderOnboarding();
    renderFilters();
    renderCollection();
    renderDatalists();
    setTab(S.tab);
  }
  function init() {
    $$('.tab').forEach(b => b.addEventListener('click', () => { renderDatalists(); setTab(b.dataset.tab); }));
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('.close')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
    $('#check-update').addEventListener('click', () => checkUpdate(true));
    bindCollection();
    bindOptimizer();
    bindDuel();
    bindMeta();
    bindRanked();
    Runner.start();
    renderAll();
    checkUpdate(false);
    // site web : application installable et utilisable hors ligne
    if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top && document.querySelector('link[rel="manifest"]')) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      const b = $('#install-app');
      if (!b) return;
      b.hidden = false;
      b.onclick = () => { e.prompt(); b.hidden = true; };
    });
    // lien de partage d'un deck
    if (/^#deck-/i.test(location.hash)) setTimeout(openSharedDeck, 300);
    window.addEventListener('hashchange', () => { if (/^#deck-/i.test(location.hash)) openSharedDeck(); });
    // premier lancement : un calcul rapide sur la collection de départ pour montrer un résultat
    if (!S.res && ownedIds().length >= 4 && !/^#deck-/i.test(location.hash)) {
      setTimeout(() => { if (!S.res && !S.running) { const q = S.quality; S.quality = 'fast'; runOptimize().finally(() => { S.quality = q; }); } }, 400);
    }
  }
  init();
})();
