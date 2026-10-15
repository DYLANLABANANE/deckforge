/* Deckforge — interface simple centrée sur le winrate */
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
  const DEFAULT_WR = JSON.parse($('#winrates-data').textContent);
  const POP = JSON.parse($('#pop-data').textContent);
  const PATCH = (() => { try { return JSON.parse($('#patch-data').textContent) || {}; } catch (e) { return {}; } })();
  const ENGINE_SRC = $('#src-engine').textContent + '\n;\n' + $('#src-optimizer').textContent;
  const DATA_BASE = 'https://www.spamgame.com/data/';
  const LIVE_GAMES = 1000;

  const EL_ORDER = ['fire', 'light', 'earth', 'nature', 'shadow', 'water', 'divine'];
  const ELI = ['fire', 'water', 'earth', 'nature', 'light', 'shadow'];
  const EL_NAME = { fire: 'Feu', water: 'Eau', earth: 'Terre', nature: 'Nature', light: 'Lumière', shadow: 'Ombre', divine: 'Éther' };
  const RAR_ORDER = ['common', 'rare', 'epic', 'legendary', 'divine'];
  const RAR_NAME = { common: 'Commune', rare: 'Rare', epic: 'Épique', legendary: 'Légendaire', divine: 'Divine' };
  const RAR_COLOR = { common: '#9692A0', rare: '#4FE6FF', epic: '#C06AFF', legendary: '#FFC756', divine: '#ff8fd8' };
  const TIER_NAME = ['commune', 'rare', 'épique', 'légendaire'];
  // rôles : [libellé court, libellé long]
  const ROLE = {
    carry: ['Carry', 'Carry principal'], carry2: ['2e carry', 'Second carry'], support: ['Support', 'Support (bonus)'],
    healer: ['Soigneur', 'Soigneur'], tank: ['Tank', 'Tank'], utility: ['Utilitaire', 'Utilitaire']
  };
  const roleTag = (r, long) => (r && ROLE[r] ? `<span class="rtag r-${r}">${ROLE[r][long ? 1 : 0]}</span>` : '');

  // ------------------------------------------------------------------ stockage
  const store = {
    get(k, d) { try { const v = localStorage.getItem('deckforge.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('deckforge.' + k, JSON.stringify(v)); } catch (e) { /* stockage indisponible */ } }
  };

  // ------------------------------------------------------------------ données
  let byId = {}, rawById = {}, byNum = {};
  let CSTATS = null, WROWS = null, WROWS_KEY = null, DUOS = null, DUOS_KEY = null;
  function loadData(raw) {
    RAW = raw;
    E.load(raw);
    byId = {}; rawById = {}; byNum = {};
    E.DB.cards.forEach(d => { byId[d.id] = d; byNum[d.num] = d; });
    raw.cards.forEach(c => { rawById[c.id] = c; });
    CSTATS = null; WROWS = null;
  }
  loadData(RAW);
  const cardOf = idx => E.DB.cards[idx];
  const rawOf = def => rawById[def.id];
  const elColor = el => `var(--${el || 'divine'})`;
  const elIcon = el => ASSETS.el[el] || '';
  const imgOf = def => ASSETS.img[def.slug] || (def.tiny ? DATA_BASE + def.tiny : '');
  const bigImgOf = def => (def.art ? DATA_BASE + def.art : imgOf(def));
  const artistOf = def => { const r = rawOf(def); return r && r.artwork && r.artwork.artist ? r.artwork.artist : null; };
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

  // ------------------------------------------------------------------ état
  const STARTERS = E.DB.cards.filter(d => d.num >= 1 && d.num <= 6).map(d => d.id);
  const S = {
    tab: store.get('tab', 'deck') === 'winrates' ? 'winrates' : 'deck',
    coll: store.get('coll', null),
    filt: { q: '', els: new Set(), rars: new Set(), show: 'all', sort: 'wr', patch: false },
    deck: (store.get('deck', []) || []).filter(x => x && byId[x.id]).slice(0, 4),
    live: null,
    improve: null,
    // winrates mis en cache : jetés quand la version du SpamDex change (règles et cartes différentes)
    alts: (store.get('alts', []) || []).filter(a => a && a.v === E.DB.version),
    wv: { filter: 'all', dir: -1, card: '', all: false },
    wr: store.get('winrates', null),
    lvl: +store.get('lvl', -1),     // niveau des adversaires : -1 = tous, sinon index de POP.levels
    wish: null,
    running: null,
    online: false
  };
  if (!S.coll || typeof S.coll !== 'object') { S.coll = {}; STARTERS.forEach(id => { S.coll[id] = 0; }); }
  const saveColl = () => store.set('coll', S.coll);
  const saveDeck = () => store.set('deck', S.deck);
  const ownedIds = () => Object.keys(S.coll).filter(id => byId[id]);
  const ownedInput = () => ownedIds().map(id => ({ idx: byId[id].idx, unlocked: S.coll[id] || 0 }));
  const deckKey = d => (d || S.deck).map(x => x.id + '.' + (x.talent || 0)).join('|');
  // cartes gardées (épinglées) : la recherche construit le meilleur deck autour sans jamais les remplacer
  const lockedIds = () => S.deck.filter(x => x.lock).map(x => x.id);
  const poolInput = () => {
    const inp = ownedInput(), have = new Set(ownedIds());
    lockedIds().forEach(id => { if (!have.has(id)) inp.push({ idx: byId[id].idx, unlocked: 3 }); });
    return inp;
  };
  const canOptimize = () => poolInput().length >= 4 && lockedIds().length < 4;
  const PIN = '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M15 2l7 7-2.5 1-4.5 4.5.5 5.5-2 2-4.5-4.5L3 23l-2-2 5.5-6L2 10.5l2-2 5.5.5L14 4.5z"/></svg>';

  // ------------------------------------------------------------------ population (adversaires réalistes)
  // niveaux d'adversaires (taille de collection) ; n = nombre de joueurs du niveau choisi qui jouent ce deck
  const LEVELS = POP.levels || [];
  const lvl = () => (S.lvl >= 0 && LEVELS[S.lvl] ? S.lvl : -1);
  const LVL_TIP = ['Collections de moins de 70 cartes obtenues : début de saison, petits rangs', 'Collections de 70 à 235 cartes obtenues', 'Collections de plus de 235 cartes obtenues : joueurs avancés'];
  const popDecks = () => {
    const b = lvl();
    const list = (POP.decks || []).filter(d => d.cards.every(id => byId[id]));
    if (b < 0) return list;
    return list.map(d => Object.assign({}, d, { n: d.nb ? d.nb[b] : 0 })).filter(d => d.n > 0).sort((x, y) => y.n - x.n);
  };
  const popPlayers = () => (lvl() >= 0 ? LEVELS[lvl()].players : POP.players) || 200;
  const oppText = () => (lvl() >= 0 ? `${popPlayers()} joueurs simulés de niveau ${LEVELS[lvl()].name.toLowerCase()}` : `${popPlayers()} joueurs simulés`);
  // le winrate en direct dépend du deck et du niveau des adversaires
  const liveKey = () => deckKey() + '@' + lvl();
  function lvlSeg() {
    if (!LEVELS.length) return '';
    const cur = lvl();
    return `<div class="seg lvlseg" role="group" aria-label="Niveau des adversaires">${[[-1, 'Tous', 'Tous les joueurs simulés']].concat(LEVELS.map((l, i) => [i, l.name, LVL_TIP[i] || ''])).map(([k, n, t]) => `<button type="button" data-lvl="${k}" aria-pressed="${cur === k}" title="${esc(t)}">${esc(n)}</button>`).join('')}</div>`;
  }
  function setLvl(k) {
    S.lvl = k; store.set('lvl', k);
    CSTATS = null; WROWS = null; DUOS = null;
    renderGrid(); renderDeck(); scheduleEval();
    if (S.tab === 'winrates') renderWinrates();
    toast(k < 0 ? 'Adversaires : tous les joueurs' : `Adversaires : ${LEVELS[k].name.toLowerCase()}`);
  }
  const toDeck = d => d.cards.map((id, i) => ({ card: byId[id].idx, talent: (d.talents && d.talents[i]) || 0 }));
  const popAll = () => { const p = popDecks(); return { decks: p.map(toDeck), weights: p.map(d => d.n) }; };
  function popSample(n) {
    const p = popDecks().slice(0, n || 24);
    const tot = p.reduce((s, d) => s + d.n, 0) || 1;
    return { decks: p.map(toDeck), weights: p.map(d => d.n / tot) };
  }

  // ------------------------------------------------------------------ winrates précalculés
  const wrData = () => (S.wr && S.wr.format === 3 && S.wr.version === E.DB.version && S.wr.decks && S.wr.decks.length ? S.wr : DEFAULT_WR);
  const wrStale = () => { const v = wrData().version; return !!v && v !== E.DB.version; };

  // ------------------------------------------------------------------ notes de patch (tools/patch.js)
  const KIND = { buff: ['▲', 'Renforcée'], nerf: ['▼', 'Affaiblie'], change: ['◆', 'Retravaillée'], new: ['★', 'Nouvelle'] };
  const patchOf = def => (PATCH.to === E.DB.version && PATCH.cards && PATCH.cards[def.id]) || null;
  const patchCount = () => (PATCH.to === E.DB.version && PATCH.cards ? Object.keys(PATCH.cards).filter(id => byId[id]).length : 0);
  // écart du winrate de la carte (meilleur deck qui la contient) entre l'ancienne et la nouvelle version
  function wrDelta(def) {
    if (PATCH.to !== E.DB.version || wrStale() || !PATCH.wrBefore || lvl() >= 0) return null;
    const t = tierOf(def), b = PATCH.wrBefore[def.id];
    return t && b != null ? t.wr - b : null;
  }
  const signed = d => (d >= 0 ? '+' : '−') + Math.abs(Math.round(d * 100));
  function wrRows() {
    const W = wrData();
    const b = lvl();
    const key = W.generated + '|' + ownedIds().length + '|' + b;
    if (WROWS && WROWS_KEY === key) return WROWS;
    WROWS = (W.decks || []).map((d, i) => {
      if (!d.cards.every(id => byId[id]) || typeof d.wr !== 'number') return null;
      const w = b >= 0 && d.wrb ? d.wrb[b] : d.wr, share = b >= 0 && d.shareb ? d.shareb[b] : (d.share || 0);
      return { i, d, w, share, tox: d.tox || [], playable: d.cards.every(id => S.coll[id] != null) };
    }).filter(Boolean);
    WROWS_KEY = key;
    return WROWS;
  }
  // winrate par carte : meilleur deck du tableau qui la contient + popularité dans la population
  function cardStats() {
    if (CSTATS) return CSTATS;
    const m = {};
    wrRows().forEach(r => r.d.cards.forEach(id => {
      const st = m[id] || (m[id] = { n: 0, sum: 0, best: null, pick: 0 });
      st.n++; st.sum += r.w;
      if (!st.best || r.w > st.best.w) st.best = r;
    }));
    const vals = Object.values(m).filter(st => st.best).map(st => st.best.w).sort((a, b) => b - a);
    const q = f => vals[Math.min(vals.length - 1, Math.floor(vals.length * f))];
    const cut = { S: q(0.1), A: q(0.3), B: q(0.55), C: q(0.8) };
    const players = popDecks().reduce((s, d) => s + d.n, 0) || 1;
    popDecks().forEach(d => d.cards.forEach(id => { if (m[id]) m[id].pick += d.n / players; }));
    for (const id in m) {
      const st = m[id], w = st.best ? st.best.w : 0;
      st.avg = st.sum / st.n;
      st.tier = w >= cut.S ? 'S' : w >= cut.A ? 'A' : w >= cut.B ? 'B' : w >= cut.C ? 'C' : 'D';
    }
    CSTATS = m;
    return m;
  }
  function tierOf(def) {
    const st = cardStats()[def.id];
    return st && st.best ? { tier: st.tier, wr: st.best.w, best: st.best, avg: st.avg, n: st.n, pick: st.pick } : null;
  }
  function heat(v) {
    if (v == null) return '';
    const d = Math.max(-1, Math.min(1, (v - 0.5) * 2));
    return `background:color-mix(in srgb, ${d >= 0 ? 'var(--good)' : 'var(--bad)'} ${Math.round(Math.abs(d) * 55 + 6)}%, var(--bg2))`;
  }
  const toxLabel = k => { const m = String(k).match(/^(.*?)(\d)$/); return m ? `${E.TOX_NAMES[m[1]] || m[1]} ${['C', 'R', 'É', 'L'][+m[2]] || ''}` : k; };
  const toxLong = k => { const m = String(k).match(/^(.*?)(\d)$/); return m ? `${E.TOX_NAMES[m[1]] || m[1]} (${TIER_NAME[+m[2]]})` : k; };
  function toxTitle(t) { return `${toxLong(t[0])} : acheté dans ${Math.round(t[1] * 100)} % des parties, ${t[2] >= 0 ? '+' : '−'}${Math.abs(Math.round(t[2] * 100))} pts de victoire quand il est acheté`; }
  const toxChips = tox => (tox || []).filter(t => t[2] > 0).slice(0, 3).map(t => `<span class="tag" title="${esc(toxTitle(t))}">${esc(toxLabel(t[0]))}</span>`).join(' ');

  // ------------------------------------------------------------------ calcul en arrière-plan (Web Worker, file d'attente)
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
    w: null, ready: null, job: null, seq: 0, queue: Promise.resolve(),
    start() {
      this.w = null;
      try {
        const url = URL.createObjectURL(new Blob([ENGINE_SRC + '\n;\n' + WORKER_HANDLER], { type: 'text/javascript' }));
        const w = new Worker(url);
        this.ready = new Promise((res, rej) => { this._res = res; this._rej = rej; setTimeout(() => rej(new Error('timeout')), 6000); });
        this.ready.catch(() => {});
        w.onmessage = e => this.onMsg(e.data);
        w.onerror = () => { if (this._rej) this._rej(new Error('worker')); this.fallback(); };
        w.postMessage({ type: 'init', data: RAW });
        this.w = w;
      } catch (e) { this.fallback(); }
    },
    fallback() {
      if (this.w) { try { this.w.terminate(); } catch (e) { /* rien */ } }
      this.w = null;
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
    run(cmd, input, onProgress) { // les calculs passent l'un après l'autre
      const p = this.queue.then(() => this._run(cmd, input, onProgress || (() => {})));
      this.queue = p.catch(() => {});
      return p;
    },
    _run(cmd, input, onProgress) {
      const self = this;
      return new Promise((resolve, reject) => {
        const go = async () => {
          if (self.w) { try { await self.ready; } catch (e) { self.fallback(); } }
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
  async function runJob(where, cmd, input) {
    if (S.running) { toast('Un calcul est déjà en cours'); return null; }
    S.running = { where, f: 0, msg: 'Démarrage…' };
    renderProgress(); updateBusy();
    try {
      return await Runner.run(cmd, input, (f, msg) => { if (S.running) { S.running.f = f; S.running.msg = msg; renderProgress(); } });
    } catch (e) { toast(e.message || String(e)); return null; }
    finally { S.running = null; renderProgress(); updateBusy(); }
  }
  function renderProgress() {
    $$('[data-progress]').forEach(el => {
      const r = S.running, mine = r && el.dataset.progress === r.where;
      el.hidden = !mine;
      if (mine) { $('.bar > i', el).style.width = Math.round(r.f * 100) + '%'; $('.pmsg', el).textContent = r.msg; }
    });
  }
  function updateBusy() { $$('[data-needs-idle]').forEach(b => { b.disabled = !!S.running || (b.dataset.needsIdle === 'owned4' && !canOptimize()); }); }
  const progressHTML = where => `<div class="progress" data-progress="${where}" hidden><div class="bar"><i></i></div><div class="row"><span class="pmsg xs mute"></span><span class="spacer"></span><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div></div>`;

  // ------------------------------------------------------------------ toast / fenêtre
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; }, 3200);
  }
  function openModal(html) { $('#modal-body').innerHTML = html; $('#modal').hidden = false; $('#modal .close').focus(); }
  function closeModal() { $('#modal').hidden = true; }
  function copyText(txt, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast(okMsg), () => toast('Copie refusée : ' + txt));
    else toast(txt);
  }

  // ------------------------------------------------------------------ onglets
  function setTab(t) {
    S.tab = t; store.set('tab', t);
    $$('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    $('#view-deck').hidden = t !== 'deck';
    $('#view-winrates').hidden = t !== 'winrates';
    if (t === 'winrates') renderWinrates();
    window.scrollTo(0, 0);
  }

  // ================================================================== CARTES
  function tierBadge(def) {
    const t = tierOf(def);
    if (!t) return '';
    return `<span class="tier t-${t.tier}" title="Tier ${t.tier} : son meilleur deck a ${Math.round(t.wr * 100)} % de winrate · jouée par ${Math.round(t.pick * 100)} % des joueurs simulés">${t.tier}<small>${Math.round(t.wr * 100)}%</small></span>`;
  }
  function patchBadge(def) {
    const p = patchOf(def);
    if (!p) return '';
    const d = wrDelta(def), k = KIND[p.kind] || KIND.change;
    const tip = `${k[1]} en ${PATCH.to}${d != null ? ` (winrate ${signed(d)} pts)` : ''} : ${p.changes.join(' · ')}`;
    return `<span class="pbadge k-${p.kind}" title="${esc(tip)}">${k[0]} ${esc(PATCH.to)}</span>`;
  }
  function tileHTML(def) {
    const owned = S.coll[def.id] != null;
    const u = S.coll[def.id] || 0;
    const inDeck = S.deck.some(x => x.id === def.id);
    const art = artistOf(def);
    const pips = def.talents.map((t, i) => `<button type="button" class="${i < u ? 'on' : ''}" data-pip="${i + 1}" title="Talent ${i + 1} débloqué : ${esc(t.name)} — ${esc(t.effect)}" aria-label="Talent ${i + 1}"></button>`).join('');
    return `<div class="tile${owned ? ' owned' : ''}${inDeck ? ' indeck' : ''}" data-id="${def.id}" style="--c:${elColor(def.element)};--rc:${RAR_COLOR[def.rar]}">
      <div class="art" role="button" tabindex="0" title="${esc(def.name)}${art ? ' — illustration : ' + esc(art.name) : ''}. Clic : ${inDeck ? 'retirer du' : 'ajouter au'} deck">
        <img class="pic" src="${imgOf(def)}" alt="${esc(def.name)}" loading="lazy">
        <img class="el" src="${elIcon(def.element)}" alt="${EL_NAME[def.element]}">
        ${tierBadge(def)}
        ${patchBadge(def)}
        ${inDeck ? '<span class="indeck-lbl">Dans le deck</span>' : ''}
        <div class="stats num"><span>♥ ${def.hp}</span><span class="sp" title="Spamtons par tour">◉ ${def.gen}</span></div>
      </div>
      <button type="button" class="own" data-own title="${owned ? 'Je possède cette carte (clic : retirer de ma collection)' : 'Je ne possède pas cette carte (clic : ajouter à ma collection)'}" aria-pressed="${owned}">${owned ? '✓' : '+'}</button>
      <div class="name"><i class="gem" title="${RAR_NAME[def.rar]}"></i><span>${esc(def.name)}</span></div>
      <div class="foot"><span class="pips">${pips}</span><button type="button" class="info" data-info>Détails</button></div>
    </div>`;
  }
  function findCard(name) {
    const n = E.norm(String(name || '').trim());
    if (!n) return null;
    return E.DB.cards.find(d => E.norm(d.name) === n) || E.DB.cards.find(d => E.norm(d.name).startsWith(n)) || null;
  }
  function filteredCards() {
    const f = S.filt, q = E.norm(f.q.trim());
    return E.DB.cards.filter(d => {
      if (f.els.size && !f.els.has(d.element)) return false;
      if (f.rars.size && !f.rars.has(d.rar)) return false;
      const owned = S.coll[d.id] != null;
      if (f.show === 'owned' && !owned) return false;
      if (f.show === 'missing' && owned) return false;
      if (f.patch && !patchOf(d)) return false;
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
        case 'wr': return (tb ? tb.wr : 0) - (ta ? ta.wr : 0) || byEl;
        case 'delta': { const dv = x => { const v = wrDelta(x); return v == null ? -9 : v; }; return dv(b) - dv(a) || byEl; }
        case 'name': return a.name.localeCompare(b.name, 'fr');
        case 'hp': return b.hp - a.hp || byEl;
        case 'gen': return b.gen - a.gen || byEl;
        case 'rar': return RAR_ORDER.indexOf(b.rar) - RAR_ORDER.indexOf(a.rar) || byEl;
        default: return byEl;
      }
    });
  }
  function renderGrid() {
    const list = filteredCards();
    $('#grid').innerHTML = list.map(tileHTML).join('') || '<div class="panel mute" style="grid-column:1/-1;text-align:center">Aucune carte ne correspond à ces filtres.</div>';
    $('#grid-count').textContent = `${list.length} carte${list.length > 1 ? 's' : ''} · clique sur une carte pour l'ajouter au deck`;
  }
  function refreshTile(id) { const t = $(`.tile[data-id="${id}"]`); if (t && byId[id]) t.outerHTML = tileHTML(byId[id]); }
  function renderFilters() {
    $('#f-els').innerHTML = EL_ORDER.map(e => `<button type="button" class="chip" data-el="${e}" aria-pressed="${S.filt.els.has(e)}" style="--c:${elColor(e)}"><img src="${elIcon(e)}" alt="">${EL_NAME[e]}</button>`).join('');
    $('#f-rars').innerHTML = RAR_ORDER.map(r => `<button type="button" class="chip text" data-rar="${r}" aria-pressed="${S.filt.rars.has(r)}" style="--c:${RAR_COLOR[r]}">${RAR_NAME[r]}</button>`).join('');
    $$('#f-show button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.show === S.filt.show)));
    const n = patchCount();
    $('#f-patch-box').hidden = !n;
    $('#f-patch').innerHTML = n ? `<button type="button" class="chip text" data-patch aria-pressed="${S.filt.patch}" style="--c:var(--good)">Modifiées en ${esc(PATCH.to)} · ${n}</button>` : '';
    $('#f-sort option[value="delta"]').hidden = !n;
    if (!n && S.filt.sort === 'delta') S.filt.sort = 'wr';
    $('#f-sort').value = S.filt.sort;
  }
  function renderCollSummary() {
    const ids = ownedIds();
    const tal = ids.reduce((s, id) => s + (S.coll[id] || 0), 0);
    $('#coll-summary').innerHTML = `<b style="color:var(--ink)" class="num">${ids.length}</b> / ${E.DB.cards.length} cartes · ${tal} talent${tal > 1 ? 's' : ''} débloqué${tal > 1 ? 's' : ''}`;
    updateBusy();
  }
  function toggleOwned(id) {
    if (S.coll[id] != null) delete S.coll[id]; else S.coll[id] = 0;
    saveColl(); refreshTile(id); renderCollSummary(); renderDeck();
  }
  function setPip(id, k) {
    if (S.coll[id] == null) return;
    S.coll[id] = S.coll[id] === k ? k - 1 : k;
    saveColl(); refreshTile(id); renderCollSummary();
  }

  // ================================================================== TACTIQUE D'UN DECK
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
  // conseil d'utilisation d'une compétence, déduit de ses effets
  function abilityAdvice(a) {
    const acts = a.choice ? [].concat(...a.options) : a.acts;
    const has = t => acts.some(x => x.t === t);
    const out = [];
    if (a.choice) out.push("Choix : l'option bonus en début de partie (les bonus s'accumulent), l'option attaque quand elle peut achever une carte.");
    if (has('destroy') && !a.absorbAlly) out.push('Élimine une carte d\'un coup : vise le carry adverse ou la carte qui a le plus de PV.');
    if (a.absorbAlly) out.push('Sacrifie un allié presque mort pour récupérer ses PV : seulement quand cet allié va tomber.');
    if (has('Resurection')) out.push('Ressuscite ta dernière carte détruite : garde-la pour relever ton carry.');
    if (has('SetHPInPercent')) out.push('Réduit une carte adverse à un pourcentage de ses PV : sur la carte adverse la plus en forme.');
    if (a.cost && a.cost.hp) out.push('Coûte des PV : lance-la tant que la carte a de la marge.');
    else if (a.cost && a.cost.any && (has('healPVmaxTarget') || has('healPVmaxCaster'))) out.push('Soin complet payé en bonus : quand la carte passe sous la moitié de ses PV.');
    else if (a.cost && a.cost.any) out.push('Consomme des bonus : lance-la quand tu en as assez accumulé.');
    if (a.hasBonus && !a.hasDmg && !a.choice) out.push('Génère des bonus : à lancer en premier, dès qu\'elle est disponible.');
    if (a.hasBonus && a.hasDmg && !a.choice) out.push('Attaque qui donne des bonus : dès qu\'elle est prête, avant tes autres attaques.');
    if (has('AddAllPlayerCritick') || has('AddOppCardCriticChance') || has('AddCardCriticChance')) out.push('Augmente les critiques : le plus tôt possible, l\'effet se cumule.');
    if (has('AddAllPlayerMiss') || has('AddOppCardBaseDamage') || has('AddAllPlayerHPMax')) out.push('Renforce ton équipe : tôt dans la partie.');
    if (a.taunt) out.push('Provocation : active-la quand ton carry ou ton soigneur est menacé.');
    if (a.gel) out.push('Gèle la cible : elle saute son prochain tour. Ne la frappe plus ce tour-ci (ça brise la glace), sauf pour l\'achever.');
    if (acts.some(x => x.t === 'AddCooldown' && x.min > 0) || a.eterText || has('ResetCooldownTarget')) out.push('Retarde l\'adversaire : sur la carte dont la grosse attaque revient bientôt.');
    if (acts.some(x => x.t === 'AddCooldown' && x.min < 0)) out.push('Réduit les recharges : sur ton carry pour relancer ses attaques plus vite.');
    if (a.hasDmg && !has('destroy')) {
      if (a.dmgT === 'all') out.push('Frappe toutes les cartes adverses : très rentable tant qu\'elles sont toutes en vie.');
      else if (a.dmgT === 'randOne' || a.dmgT === 'randEach' || a.dmgT === 'randField') out.push('Cible aléatoire : lance-la après tes bonus, tu ne choisis pas la cible.');
      else if (a.cd >= 4) out.push(`Grosse attaque (recharge ${a.cd}) : après tes bonus, pour achever une carte ou frapper la cible prioritaire.`);
      else out.push('Attaque régulière : chaque tour, sur une carte que tu peux achever, sinon sur le carry ou le support adverse.');
    }
    if (a.hasHeal && !a.hasDmg && !a.cost) {
      if (a.allyT === 'all') out.push('Soigne toute l\'équipe : quand plusieurs cartes ont perdu des PV.');
      else if (a.selfHeal) out.push('Se soigne : quand la carte a perdu beaucoup de PV.');
      else out.push('Soin : sur ton allié le plus blessé, en priorité le carry.');
    }
    if (a.uses) out.push(`Utilisable ${a.uses} fois par partie.`);
    if (a.echo) out.push(`Écho ${a.echo} % : peut se relancer aussitôt.`);
    return out.slice(0, 3).join(' ') || 'À lancer dès qu\'elle est disponible.';
  }
  // deck = { cards: [ids], talents, roles, shares, wr, tox, turns }
  function openTactic(deck, opts) {
    opts = opts || {};
    const defs = deck.cards.map(id => byId[id]);
    const roles = deck.roles || [];
    const sh = deck.shares || [];
    const idxOf = r => roles.indexOf(r);
    const nm = i => `<b>${esc(defs[i].name)}</b>`;
    const plan = [];
    const c = idxOf('carry');
    if (c >= 0) plan.push(`${nm(c)} est ton carry : il fait ${sh[c] ? Math.round(sh[c][0] * 100) : '?'} % des dégâts. Tout le deck tourne autour de lui : protège-le et donne-lui les bonus.`);
    roles.forEach((r, i) => { if (r === 'carry2') plan.push(`${nm(i)} est le second carry (${Math.round(sh[i][0] * 100)} % des dégâts) : il finit les cartes que le carry a entamées.`); });
    roles.forEach((r, i) => { if (r === 'support') plan.push(`${nm(i)} génère ${Math.round(sh[i][1] * 100)} % des bonus : lance ses compétences de bonus en premier à chaque tour.`); });
    roles.forEach((r, i) => { if (r === 'healer') plan.push(`${nm(i)} assure ${Math.round(sh[i][2] * 100)} % des soins : garde-le en vie et soigne le carry en priorité.`); });
    roles.forEach((r, i) => { if (r === 'tank') plan.push(`${nm(i)} encaisse ${Math.round(sh[i][3] * 100)} % des dégâts adverses : c'est lui qui doit prendre les coups, avec sa provocation s'il en a une.`); });
    // axe élémentaire
    const prof = [0, 0, 0, 0, 0, 0];
    defs.forEach(d => d.elDmg.forEach((v, k) => { prof[k] += v; }));
    const tot = prof.reduce((s, x) => s + x, 0) || 1;
    const main = prof.map((v, k) => [v / tot, k]).sort((x, y) => y[0] - x[0]).filter(x => x[0] >= 0.25).slice(0, 2);
    if (main.length) plan.push(`Axe ${main.map(x => EL_NAME[ELI[x[1]]]).join(' et ')} : ${Math.round(main.reduce((s, x) => s + x[0], 0) * 100)} % des dégâts de base. Chaque point de bonus dans ${main.length > 1 ? 'ces éléments' : 'cet élément'} ajoute +10 % et ils s'additionnent pendant toute la partie.`);
    plan.push('Cible en priorité les supports et soigneurs adverses (ceux qui génèrent les bonus ou soignent), puis achève les cartes basses en PV.');
    const tox = (deck.tox || []).filter(t => t[2] > 0);
    if (tox.length) plan.push(`En boutique, achète en priorité : ${tox.map(t => toxLong(t[0])).join(', ')}.`);
    if (deck.turns) plan.push(`Une partie dure en moyenne ${String(Math.round(deck.turns * 10) / 10).replace('.', ',')} tours.`);
    const cardsHTML = defs.map((d, i) => {
      const t = deck.talents && deck.talents[i] ? d.talents[deck.talents[i] - 1] : null;
      return `<div class="tcard" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="${esc(d.name)}"><div><b>${esc(d.name)}</b><div>${roleTag(roles[i], true)}</div>${t ? `<div class="xs" style="color:var(--gold2)">Talent : ${esc(t.name)}</div>` : ''}${sh[i] ? `<div class="xs faint">${Math.round(sh[i][0] * 100)} % dégâts · ${Math.round(sh[i][1] * 100)} % bonus · ${Math.round(sh[i][2] * 100)} % soins</div>` : ''}</div></div>`;
    }).join('');
    const order = defs.map((d, i) => i).sort((x, y) => ['carry', 'carry2', 'support', 'healer', 'tank', 'utility'].indexOf(roles[x]) - ['carry', 'carry2', 'support', 'healer', 'tank', 'utility'].indexOf(roles[y]));
    const abil = order.map(i => {
      const d = defs[i];
      return `<div class="stack" style="gap:6px"><div class="row" style="gap:8px"><b style="font-family:var(--display)">${esc(d.name)}</b>${roleTag(roles[i])}</div>
        ${d.abilities.map(a => `<div class="abil"><div class="t"><b>${esc(a.name)}</b><span class="tag" title="Premier tour où elle est disponible si tu commences / si tu joues second">dispo T${availTurn(a.cd, true)} / T${availTurn(a.cd, false)}</span><span class="tag">recharge ${a.cd}</span></div><div class="fx">${esc(abilityAdvice(a))}</div></div>`).join('') || '<p class="small mute" style="margin:0">Pas de compétence active : ses effets passifs agissent seuls.</p>'}</div>`;
    }).join('');
    const A = openingSeq(defs, true, 5), B = openingSeq(defs, false, 5);
    const cell = list => (list.length ? list.map(x => `<span class="ab" style="--c:${elColor(x.d.element)}" title="${esc(x.d.name)}">${esc(x.a.name)}</span>`).join('') : '<span class="faint">—</span>');
    let seq = '';
    for (let t = 0; t < 5; t++) seq += `<span class="t">T${t + 1}</span><div class="cell">${cell(A[t])}</div><div class="cell">${cell(B[t])}</div>`;
    openModal(`<div class="stack">
      <div class="row"><div><div class="eyebrow">Tactique</div><h2>Comment jouer ce deck</h2></div><span class="spacer"></span>
        ${deck.wr != null ? `<span class="wcell" style="${heat(deck.wr)};font-size:1.1rem">${pct(deck.wr)} de winrate</span>` : ''}</div>
      <div class="tcards">${cardsHTML}</div>
      <div class="stack" style="gap:6px"><div class="eyebrow">Plan de jeu</div><ul class="plan-list">${plan.map(p => `<li>${p}</li>`).join('')}</ul></div>
      <div class="stack" style="gap:8px"><div class="eyebrow">Compétences : quand les utiliser</div>${abil}</div>
      <div class="stack" style="gap:6px"><div class="eyebrow">Ordre des compétences sur les 5 premiers tours</div>
        <div class="seq"><span></span><span class="h">Si tu commences</span><span class="h">Si tu es second</span>${seq}</div>
        <p class="xs faint" style="margin:0">Dans chaque tour : bonus d'abord, puis attaques, puis soins. La couleur indique la carte.</p></div>
      <div class="stack" style="gap:6px"><div class="eyebrow">Contre les decks les plus joués</div><div id="tactic-mu" class="small mute">Calcul des matchups…</div></div>
      ${opts.load ? '<div><button type="button" class="btn primary" id="tactic-load">Charger ce deck</button></div>' : ''}
    </div>`);
    fillMatchups(deck);
    const tl = $('#tactic-load');
    if (tl) tl.addEventListener('click', () => { closeModal(); setTab('deck'); setDeck(deck.cards.map((id, k) => ({ id, talent: deck.talents[k] || 0 }))); toast('Deck chargé'); });
  }

  async function fillMatchups(deck) {
    const box = () => $('#tactic-mu');
    const pd = popDecks();
    let per = deck.per, perN = deck.perN;
    if (!per) {
      const pop = popAll();
      try {
        const r = await Runner.run('quickWinrate', { deck: deck.cards.map((id, k) => ({ card: byId[id].idx, talent: (deck.talents && deck.talents[k]) || 0 })), opp: pop.decks, oppW: pop.weights, games: LIVE_GAMES, seed: 4242 });
        per = r.per; perN = r.perN;
      } catch (e) { if (box()) box().textContent = 'Matchups indisponibles.'; return; }
    }
    if (!box()) return;
    const players = pd.reduce((s, d) => s + d.n, 0) || 1;
    const rows = pd.map((d, j) => ({ d, j, wr: per[j], n: perN ? perN[j] : 0 })).filter(r => r.wr != null && r.n >= 15).slice(0, 8);
    if (!rows.length) { box().textContent = 'Pas assez de parties pour afficher les matchups.'; return; }
    const worst = rows.slice().sort((a, b) => a.wr - b.wr)[0];
    box().innerHTML = `<div class="mus">${rows.map(r => `<div class="mu"><span class="imgs">${r.d.cards.map(id => `<img src="${imgOf(byId[id])}" alt="${esc(byId[id].name)}" title="${esc(byId[id].name)}" style="--c:${elColor(byId[id].element)}">`).join('')}</span>
      <span class="xs mute">${r.d.cards.map(id => esc(shortName(byId[id]))).join(' · ')}<br>${Math.max(1, Math.round(r.d.n / players * 100))} % des joueurs</span><span class="wcell" style="${heat(r.wr)}">${pct(r.wr)}</span></div>`).join('')}</div>
      ${worst.wr < 0.5 ? `<p class="xs" style="margin:6px 0 0">Match le plus difficile : <b>${worst.d.cards.map(id => esc(shortName(byId[id]))).join(' · ')}</b> (${pct(worst.wr)}). Face à lui, vise en priorité son carry et garde tes soins pour ton propre carry.</p>` : ''}`;
  }

  // ================================================================== MON DECK
  function addToDeck(id) {
    const i = S.deck.findIndex(x => x.id === id);
    if (i >= 0) { S.deck.splice(i, 1); afterDeckChange([id]); return; }
    if (S.deck.length >= 4) { toast('Deck complet : retire d\'abord une carte (croix sur la carte dans « Mon deck »)'); return; }
    const defs = S.deck.map(x => byId[x.id]).concat([byId[id]]);
    const unl = defs.map(c => (S.coll[c.id] != null ? S.coll[c.id] : 3));
    S.deck.push({ id, talent: O.guessTalents(defs, unl)[defs.length - 1], lock: true });
    afterDeckChange([id]);
  }
  function afterDeckChange(changed) { saveDeck(); (changed || []).forEach(refreshTile); renderDeck(); scheduleEval(); }
  function setDeck(list) {
    const old = S.deck.map(x => x.id);
    S.deck = list.slice(0, 4);
    afterDeckChange(old.concat(S.deck.map(x => x.id)));
  }
  // winrate en direct : ~600 parties contre les decks joués par la population, au prorata de leur fréquence
  let evalTimer = null;
  function scheduleEval() { clearTimeout(evalTimer); evalTimer = setTimeout(evalDeck, 250); }
  async function evalDeck() {
    if (S.deck.length < 4) { S.live = null; renderDeck(); return; }
    const key = liveKey();
    if (S.live && S.live.key === key && !S.live.busy) return;
    S.live = { key, busy: true, wr: S.live && S.live.key === key ? S.live.wr : null };
    renderDeck();
    const pop = popAll();
    try {
      const res = await Runner.run('quickWinrate', { deck: S.deck.map(x => ({ card: byId[x.id].idx, talent: x.talent || 0 })), opp: pop.decks, oppW: pop.weights, games: LIVE_GAMES, seed: 4242 });
      if (liveKey() !== key) return;
      S.live = { key, v: E.DB.version, rf: 2, busy: false, wr: res.wr, tox: res.tox, turns: res.turns, roles: res.roles.roles, shares: res.roles.shares, per: res.per, perN: res.perN };
      store.set('live', S.live);
    } catch (e) { if (liveKey() === key) S.live = null; }
    renderDeck();
  }
  function gaugeSVG(v) {
    const r = 52, c = 2 * Math.PI * r, col = v >= 0.6 ? 'var(--good)' : v >= 0.45 ? 'var(--gold)' : 'var(--bad)';
    return `<svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="${r}" fill="none" style="stroke:var(--raised)" stroke-width="12"/>
      <circle cx="60" cy="60" r="${r}" fill="none" style="stroke:${col}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(c * v).toFixed(1)} ${c.toFixed(1)}"/></svg>`;
  }
  function renderDeck() {
    const defs = S.deck.map(x => byId[x.id]);
    const L = S.live && S.live.key === liveKey() ? S.live : null;
    const slots = [0, 1, 2, 3].map(i => {
      const x = S.deck[i];
      if (!x) return `<div class="slot"><div class="empty">${i + 1}</div><span class="xs faint">Carte ${i + 1}</span></div>`;
      const d = byId[x.id], owned = S.coll[x.id] != null, u = owned ? S.coll[x.id] : 3;
      const opts = ['<option value="0">Sans talent</option>'].concat(d.talents.map((t, k) => `<option value="${k + 1}" ${x.talent === k + 1 ? 'selected' : ''}>${esc(t.name)}${k + 1 > u ? ' (verrouillé)' : ''}</option>`)).join('');
      return `<div class="slot${x.lock ? ' locked' : ''}" style="--c:${elColor(d.element)}"><div class="sart" data-open="${d.id}" title="Voir la fiche"><img class="pic" src="${imgOf(d)}" alt="${esc(d.name)}"><img class="el" src="${elIcon(d.element)}" alt="">${owned ? '' : '<span class="miss">À obtenir</span>'}</div>
        <button type="button" class="rm" data-rm="${i}" aria-label="Retirer ${esc(d.name)} du deck">✕</button>
        <button type="button" class="pin" data-pin="${i}" aria-pressed="${!!x.lock}" title="${x.lock ? 'Carte gardée : la recherche construit le deck autour sans la remplacer (clic : la libérer)' : 'Garder cette carte : la recherche construira le meilleur deck autour'}" aria-label="${x.lock ? 'Libérer' : 'Garder'} ${esc(d.name)}">${PIN}</button>
        <span class="snm">${esc(d.name)}</span>${L && L.roles ? roleTag(L.roles[i]) : ''}
        <select class="input" data-slot-tal="${i}" aria-label="Talent de ${esc(d.name)}">${opts}</select></div>`;
    }).join('');
    let wr;
    if (S.deck.length < 4) wr = `<div class="wrbox empty">Ajoute ${4 - S.deck.length} carte${4 - S.deck.length > 1 ? 's' : ''} pour voir le winrate de ton deck.</div>`;
    else if (!L || L.wr == null) wr = '<div class="wrbox empty">Calcul du winrate…</div>';
    else wr = `<div class="wrbox"><div class="gauge ${L.busy ? 'busy' : ''}">${gaugeSVG(L.wr)}<div class="val"><b class="num">${Math.round(L.wr * 100)}%</b><span>winrate</span></div></div>
        <div class="stack" style="gap:6px"><span class="small">${L.busy ? 'Recalcul…' : `Sur ${LIVE_GAMES} parties contre les decks joués par ${oppText()} (± 1,5 pt).`}</span>
          ${L.tox && L.tox.some(t => t[2] > 0) ? `<div><div class="lbl" style="margin-bottom:4px">Tox clés</div><div class="row" style="gap:4px">${toxChips(L.tox)}</div></div>` : ''}
          ${L.roles && !L.busy ? '<div class="row" style="gap:6px"><button type="button" class="btn sm primary" data-tactic>Voir la tactique</button><button type="button" class="btn sm" data-improve data-needs-idle>Améliorer ce deck</button><button type="button" class="btn sm" data-wish data-needs-idle title="Les cartes que tu n\'as pas encore qui feraient le plus gagner ce deck">Cartes à obtenir</button></div>' : ''}</div></div>
      ${progressHTML('imp')}
      ${improveHTML()}
      ${progressHTML('wish')}
      ${wishHTML()}`;
    const hp = defs.reduce((s, d) => s + d.hp, 0), gen = defs.reduce((s, d) => s + d.gen, 0);
    const els = [...new Set(defs.map(d => d.element))];
    const missing = defs.filter(d => S.coll[d.id] == null).length;
    const alts = (S.alts || []).filter(a => a.cards.every(id => byId[id]));
    const code = S.deck.length === 4 ? deckCode(S.deck.map(x => x.id), S.deck.map(x => x.talent)) : '';
    const mini = [0, 1, 2, 3].map(i => (S.deck[i] ? `<img src="${imgOf(byId[S.deck[i].id])}" alt="">` : '<span class="ph"></span>')).join('');
    $('#deck-panel').innerHTML = `
      <button type="button" class="mini-sum" data-toggle-deck aria-label="Ouvrir mon deck"><span class="grab"></span>${mini}<span class="small mute">Mon deck ${S.deck.length}/4</span><b class="num">${L && L.wr != null ? Math.round(L.wr * 100) + '%' : ''}</b></button>
      <div class="panel deck">
        <div class="deck-head"><div><div class="eyebrow">Composition</div><h2>Mon deck <span class="num">${S.deck.length}/4</span></h2></div><span class="spacer"></span>
          ${S.deck.length ? '<button type="button" class="btn sm ghost" data-deck-reset>Vider</button>' : ''}</div>
        <div class="slots4">${slots}</div>
        ${wr}
        ${S.deck.length ? `<div class="dstats"><div class="dstat"><div class="k">PV totaux</div><div class="v num">${fmt(hp)}</div></div>
          <div class="dstat"><div class="k">Spamtons / tour</div><div class="v num" style="color:var(--gold)">${gen}</div></div>
          <div class="dstat"><div class="k">Éléments</div><div class="v">${els.map(e => `<img src="${elIcon(e)}" alt="${EL_NAME[e]}" title="${EL_NAME[e]}">`).join('')}</div></div></div>` : ''}
        ${deckSynergiesHTML()}
        ${LEVELS.length ? `<div class="stack" style="gap:4px"><span class="lbl">Niveau de tes adversaires</span>${lvlSeg()}</div>` : ''}
        ${missing ? `<p class="xs" style="margin:0;color:var(--warn)">${missing} carte${missing > 1 ? 's' : ''} de ce deck ne ${missing > 1 ? 'sont' : 'est'} pas dans ta collection.</p>` : ''}
        ${code ? `<div class="row" style="gap:6px"><button type="button" class="btn sm" data-copy-code>Copier le code</button>${canShareLink() ? '<button type="button" class="btn sm" data-share>Partager le lien</button>' : ''}<span class="xs faint">${esc(code)}</span></div>` : ''}
        <hr class="divider">
        <div class="stack" style="gap:8px">
          <button type="button" class="btn primary big" data-optimize data-needs-idle="owned4">${optLabel()}</button>
          <span class="xs mute">${optHint()}</span>
          ${progressHTML('opt')}
          ${alts.length ? `<div class="lbl">${altsLabel(alts)}</div><div class="alts">${alts.map((a, i) => `<button type="button" class="alt" data-alt="${i}" aria-current="${deckKey(a.cards.map((id, k) => ({ id, talent: a.talents[k] }))) === deckKey()}">${a.cards.map(id => { const d = byId[id]; return `<img src="${imgOf(d)}" alt="${esc(d.name)}" title="${esc(d.name)}" style="--c:${elColor(d.element)}">`; }).join('')}<span class="names">${a.cards.map(id => esc(shortName(byId[id]))).join(' · ')}</span><span class="wr num">${a.wr != null ? Math.round(a.wr * 100) + '%' : '…'}</span></button>`).join('')}</div>` : ''}
        </div>
      </div>`;
    renderProgress(); updateBusy();
  }
  const namesOf = ids => ids.map(id => esc(shortName(byId[id]))).join(', ').replace(/, ([^,]*)$/, ' et $1');
  function optLabel() {
    const L = lockedIds();
    if (!L.length) return 'Trouver mon meilleur deck';
    return `Construire le meilleur deck autour ${L.length === 1 ? 'de ' + esc(shortName(byId[L[0]])) : `de ${L.length} cartes`}`;
  }
  function optHint() {
    const L = lockedIds(), n = ownedIds().length;
    if (poolInput().length < 4) return 'Coche au moins 4 cartes que tu possèdes (rond ✓).';
    if (L.length === 4) return 'Les 4 cartes sont gardées (épingle dorée) : libère au moins une carte pour que la recherche puisse la remplacer.';
    if (L.length) return `Garde ${namesOf(L)} et cherche dans tes ${n} cartes les meilleures pour compléter le deck (≈ 30 s). L'épingle d'une carte la garde ou la libère.`;
    return `Teste les combinaisons de tes ${n} cartes (≈ 30 s). Astuce : épingle une carte du deck pour construire le meilleur deck autour.`;
  }
  const altsLabel = alts => (alts[0] && alts[0].locked && alts[0].locked.length ? `Meilleurs decks autour de ${namesOf(alts[0].locked.filter(id => byId[id]))}` : 'Meilleurs decks avec tes cartes');
  // deck issu d'une recherche : les cartes gardées restent à leur place, les autres remplissent les emplacements libres
  function deckFrom(a) {
    const keep = new Set(a.locked || []);
    const out = [null, null, null, null];
    S.deck.forEach((x, i) => { if (i < 4 && keep.has(x.id) && a.cards.includes(x.id)) out[i] = { id: x.id, talent: a.talents[a.cards.indexOf(x.id)] || 0, lock: true }; });
    const rest = a.cards.map((id, k) => ({ id, talent: a.talents[k] || 0, lock: keep.has(id) })).filter(x => !out.some(o => o && o.id === x.id));
    for (let i = 0; i < 4; i++) if (!out[i]) out[i] = rest.shift() || null;
    return out.filter(Boolean);
  }
  function buildAround(id) {
    const d = byId[id], unl = S.coll[id] != null ? S.coll[id] : 3;
    closeModal(); setTab('deck');
    setDeck([{ id, talent: O.guessTalents([d], [unl])[0], lock: true }]);
    if (!canOptimize()) { toast('Coche au moins 3 autres cartes que tu possèdes pour construire un deck autour'); return; }
    runOptimize();
  }

  // améliorations proposées pour le deck affiché (talents + échange d'une carte)
  function improveHTML() {
    const I = S.improve;
    if (!I || I.key !== liveKey()) return '';
    const rows = [];
    const talGain = I.wrTalents - I.base;
    if (I.talents.some((t, i) => t !== (S.deck[i].talent || 0)) && talGain >= 0.01) {
      const names = I.talents.map((t, i) => (t !== (S.deck[i].talent || 0) ? `${esc(shortName(byId[S.deck[i].id]))} → ${t ? esc(byId[S.deck[i].id].talents[t - 1].name) : 'sans talent'}` : null)).filter(Boolean).join(', ');
      rows.push(`<div class="imp"><div><b>Meilleurs talents</b><div class="xs mute">${names}</div></div><span class="gain">+${Math.round(talGain * 100)} pts</span><button type="button" class="btn sm" data-imp-tal>Appliquer</button></div>`);
    }
    I.swaps.forEach((w, k) => {
      const out = byId[S.deck[w.slot].id], inn = cardOf(w.card);
      rows.push(`<div class="imp"><div><b>${esc(shortName(inn))}</b> <span class="mute">à la place de</span> <b>${esc(shortName(out))}</b><div class="xs mute">winrate ${pct(w.wr)}${S.coll[inn.id] != null ? '' : ' · carte à obtenir'}</div></div><span class="gain">+${Math.round(w.gain * 100)} pts</span><button type="button" class="btn sm" data-imp-swap="${k}">Appliquer</button></div>`);
    });
    return `<div class="stack" style="gap:6px"><div class="lbl">Améliorations trouvées</div>${rows.join('') || '<p class="xs mute" style="margin:0">Aucune amélioration nette avec tes cartes : ce deck est déjà au mieux.</p>'}</div>`;
  }
  // duos en synergie présents dans le deck affiché
  function deckSynergiesHTML() {
    if (S.deck.length < 2) return '';
    const ids = new Set(S.deck.map(x => x.id));
    const list = duos().filter(p => ids.has(p.a) && ids.has(p.b)).slice(0, 3);
    if (!list.length) return '';
    return `<div class="stack" style="gap:4px"><span class="lbl">Synergies de ton deck</span><div class="row" style="gap:4px">${list.map(p => `<span class="tag syn" title="Leur meilleur deck commun fait ${Math.round(p.gain * 100)} pts de mieux que le meilleur deck de chacune sans l'autre">${esc(shortName(byId[p.a]))} + ${esc(shortName(byId[p.b]))} <b>+${Math.round(p.gain * 100)}</b></span>`).join('')}</div></div>`;
  }
  // cartes que le joueur n'a pas encore et qui feraient le plus gagner ce deck (échange d'une carte non gardée)
  function wishHTML() {
    const Wh = S.wish;
    if (!Wh || Wh.key !== liveKey()) return '';
    const rows = Wh.swaps.map((w, k) => {
      const out = byId[S.deck[w.slot].id], inn = cardOf(w.card);
      return `<div class="imp"><div><b>${esc(inn.name)}</b> <span class="mute">à la place de</span> <b>${esc(shortName(out))}</b><div class="xs mute">${RAR_NAME[inn.rar]} · winrate ${pct(w.wr)} sans talent débloqué</div></div><span class="gain">+${Math.round(w.gain * 100)} pts</span><button type="button" class="btn sm" data-wish-try="${k}">Essayer</button></div>`;
    });
    return `<div class="stack" style="gap:6px"><div class="lbl">Cartes à obtenir pour ce deck</div>${rows.join('') || '<p class="xs mute" style="margin:0">Aucune carte manquante ne fait nettement mieux : ce deck est déjà très bon avec tes cartes.</p>'}</div>`;
  }
  async function runWish() {
    if (S.deck.length < 4) return;
    const key = liveKey();
    const inDeck = new Set(S.deck.map(x => x.id));
    const missing = E.DB.cards.filter(d => S.coll[d.id] == null && !inDeck.has(d.id)).map(d => ({ idx: d.idx, unlocked: 0 }));
    if (!missing.length) { toast('Tu as déjà toutes les cartes'); return; }
    const pop = popAll();
    const res = await runJob('wish', 'improveDeck', {
      deck: S.deck.map(x => ({ card: byId[x.id].idx, talent: x.talent || 0, unlocked: S.coll[x.id] != null ? S.coll[x.id] : 3 })),
      owned: missing, opp: pop.decks, oppW: pop.weights, games: 300, seed: 778, locked: S.deck.map(x => !!x.lock), swapsOnly: true
    });
    if (!res || liveKey() !== key) return;
    S.wish = { key, swaps: res.swaps };
    renderDeck();
    if (!res.swaps.length) toast('Aucune carte manquante ne fait nettement mieux');
  }

  async function runImprove() {
    if (S.deck.length < 4) return;
    const key = liveKey();
    const pop = popAll();
    const res = await runJob('imp', 'improveDeck', {
      deck: S.deck.map(x => ({ card: byId[x.id].idx, talent: x.talent || 0, unlocked: S.coll[x.id] != null ? S.coll[x.id] : 3 })),
      owned: ownedInput(), opp: pop.decks, oppW: pop.weights, games: 300, seed: 777, locked: S.deck.map(x => !!x.lock)
    });
    if (!res || liveKey() !== key) return;
    S.improve = Object.assign({ key }, res);
    renderDeck();
    const first = $('#deck-panel .imp') || $('#deck-panel [data-improve]');
    if (first) first.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    if (!res.swaps.length && res.wrTalents - res.base < 0.01) toast('Aucune amélioration nette trouvée');
  }
  async function runOptimize() {
    if (poolInput().length < 4) { toast('Coche au moins 4 cartes que tu possèdes'); return; }
    const locked = lockedIds();
    if (locked.length === 4) { toast('Les 4 cartes sont gardées : libère au moins une carte (épingle)'); return; }
    const pop = popSample(40);
    const res = await runJob('opt', 'optimize', { owned: poolInput(), must: locked.map(id => byId[id].idx), gauntlet: pop.decks, weights: pop.weights, quality: 'normal', seed: Math.floor(Math.random() * 1e9) });
    if (!res || !res.results.length) return;
    const alts = res.results.slice(0, 6).map(r => ({ cards: r.cards.map(i => cardOf(i).id), talents: r.talents, wr: null, v: E.DB.version, locked }));
    // vérification : chaque proposition est mesurée comme le deck affiché (toute la population), puis la meilleure est chargée
    const all = popAll();
    S.running = { where: 'opt', f: 0.97, msg: 'Vérification des meilleurs decks…' };
    renderProgress(); updateBusy();
    try {
      for (let k = 0; k < alts.length; k++) {
        const a = alts[k];
        try {
          const r = await Runner.run('quickWinrate', { deck: a.cards.map((id, j) => ({ card: byId[id].idx, talent: a.talents[j] || 0 })), opp: all.decks, oppW: all.weights, games: LIVE_GAMES, seed: 4242 });
          a.wr = r.wr;
        } catch (e) { /* ignoré */ }
        S.running.f = 0.97 + 0.03 * (k + 1) / alts.length; renderProgress();
      }
    } finally { S.running = null; renderProgress(); updateBusy(); }
    alts.sort((x, y) => (y.wr == null ? -1 : y.wr) - (x.wr == null ? -1 : x.wr));
    S.alts = alts;
    store.set('alts', S.alts);
    setDeck(deckFrom(S.alts[0]));
    toast(locked.length ? `Meilleur deck construit autour de ${locked.map(id => shortName(byId[id])).join(', ')}` : 'Meilleur deck trouvé et chargé');
  }

  // ------------------------------------------------------------------ codes de deck et liens de partage
  function deckCode(ids, talents) { return 'DECK:' + ids.map((id, i) => byId[id].num + (talents && talents[i] ? '.' + talents[i] : '')).join('-'); }
  function parseDeckCode(txt) {
    const m = String(txt || '').trim().match(/^DECK\s*:\s*([\d.\-\s]+)$/i);
    if (!m) return null;
    const out = m[1].split('-').map(p => p.trim()).filter(Boolean).map(p => { const [n, t] = p.split('.'); const d = byNum[+n]; return d ? { id: d.id, talent: Math.min(+(t || 0), d.talents.length) } : null; });
    return out.length === 4 && out.every(Boolean) && new Set(out.map(x => x.id)).size === 4 ? out : null;
  }
  const canShareLink = () => /^https?:$/.test(location.protocol) && window.self === window.top;
  const shareLink = () => location.origin + location.pathname + '#deck-' + deckCode(S.deck.map(x => x.id), S.deck.map(x => x.talent)).slice(5);
  function openSharedDeck() {
    const m = decodeURIComponent(location.hash || '').match(/^#deck-([\d.\-]+)$/i);
    if (!m) return;
    const deck = parseDeckCode('DECK:' + m[1]);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* rien */ }
    if (!deck) { toast('Lien de deck invalide'); return; }
    setTab('deck'); setDeck(deck); toast('Deck partagé chargé');
  }
  function bindDeck() {
    const p = $('#deck-panel');
    p.addEventListener('click', e => {
      if (e.target.closest('[data-toggle-deck]')) { p.classList.toggle('open'); return; }
      const pin = e.target.closest('[data-pin]');
      if (pin) { const x = S.deck[+pin.dataset.pin]; if (x) { x.lock = !x.lock; saveDeck(); renderDeck(); } return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { const [x] = S.deck.splice(+rm.dataset.rm, 1); afterDeckChange([x.id]); return; }
      if (e.target.closest('[data-deck-reset]')) { setDeck([]); return; }
      const op = e.target.closest('[data-open]');
      if (op) { openCard(op.dataset.open); return; }
      if (e.target.closest('[data-tactic]') && S.live) {
        openTactic({ cards: S.deck.map(x => x.id), talents: S.deck.map(x => x.talent), roles: S.live.roles, shares: S.live.shares, wr: S.live.wr, tox: S.live.tox, turns: S.live.turns, per: S.live.per, perN: S.live.perN });
        return;
      }
      if (e.target.closest('[data-copy-code]')) { copyText(deckCode(S.deck.map(x => x.id), S.deck.map(x => x.talent)), 'Code du deck copié'); return; }
      if (e.target.closest('[data-share]')) { copyText(shareLink(), 'Lien du deck copié'); return; }
      if (e.target.closest('[data-optimize]')) { runOptimize(); return; }
      if (e.target.closest('[data-improve]')) { runImprove(); return; }
      if (e.target.closest('[data-wish]')) { runWish(); return; }
      const wt = e.target.closest('[data-wish-try]');
      if (wt && S.wish) {
        const w = S.wish.swaps[+wt.dataset.wishTry];
        setDeck(S.deck.map((x, i) => (i === w.slot ? { id: cardOf(w.card).id, talent: 0, lock: false } : x)));
        toast('Carte essayée dans le deck (à obtenir)'); return;
      }
      if (e.target.closest('[data-imp-tal]') && S.improve) {
        const t = S.improve.talents;
        setDeck(S.deck.map((x, i) => ({ id: x.id, talent: t[i], lock: x.lock })));
        toast('Talents appliqués'); return;
      }
      const sw = e.target.closest('[data-imp-swap]');
      if (sw && S.improve) {
        const w = S.improve.swaps[+sw.dataset.impSwap], t = S.improve.talents.slice();
        t[w.slot] = w.talent;
        const d = S.deck.map((x, i) => ({ id: i === w.slot ? cardOf(w.card).id : x.id, talent: t[i], lock: i === w.slot ? false : x.lock }));
        setDeck(d); toast('Échange appliqué'); return;
      }
      if (e.target.closest('[data-cancel]')) { Runner.cancel(); return; }
      const al = e.target.closest('[data-alt]');
      if (al) { setDeck(deckFrom(S.alts[+al.dataset.alt])); }
    });
    p.addEventListener('change', e => {
      const s = e.target.closest('[data-slot-tal]');
      if (s) { S.deck[+s.dataset.slotTal].talent = +s.value; afterDeckChange([]); }
    });
  }

  // ================================================================== FILTRES + COLLECTION
  function bindCatalog() {
    $('#grid').addEventListener('click', e => {
      const tile = e.target.closest('.tile');
      if (!tile) return;
      const id = tile.dataset.id;
      const pip = e.target.closest('[data-pip]');
      if (pip) { setPip(id, +pip.dataset.pip); return; }
      if (e.target.closest('[data-own]')) { toggleOwned(id); return; }
      if (e.target.closest('[data-info]')) { openCard(id); return; }
      if (e.target.closest('.art')) addToDeck(id);
    });
    $('#grid').addEventListener('keydown', e => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('art')) {
        e.preventDefault();
        const id = e.target.closest('.tile').dataset.id;
        addToDeck(id);
        const n = $(`.tile[data-id="${id}"] .art`); if (n) n.focus();
      }
    });
    $('#f-q').addEventListener('input', e => { S.filt.q = e.target.value; renderGrid(); });
    $('#f-sort').addEventListener('change', e => { S.filt.sort = e.target.value; renderGrid(); });
    $('#f-els').addEventListener('click', e => { const b = e.target.closest('[data-el]'); if (!b) return; const s = S.filt.els; s.has(b.dataset.el) ? s.delete(b.dataset.el) : s.add(b.dataset.el); renderFilters(); renderGrid(); });
    $('#f-rars').addEventListener('click', e => { const b = e.target.closest('[data-rar]'); if (!b) return; const s = S.filt.rars; s.has(b.dataset.rar) ? s.delete(b.dataset.rar) : s.add(b.dataset.rar); renderFilters(); renderGrid(); });
    $('#f-show').addEventListener('click', e => { const b = e.target.closest('[data-show]'); if (!b) return; S.filt.show = b.dataset.show; renderFilters(); renderGrid(); });
    $('#f-patch').addEventListener('click', e => { if (!e.target.closest('[data-patch]')) return; S.filt.patch = !S.filt.patch; renderFilters(); renderGrid(); });
    $('#coll-tal').addEventListener('click', e => {
      const b = e.target.closest('[data-tal]'); if (!b) return;
      const k = +b.dataset.tal;
      ownedIds().forEach(id => { S.coll[id] = Math.min(k, byId[id].talents.length); });
      saveColl(); renderGrid(); renderCollSummary();
      toast(`Talents débloqués : ${k} pour toutes tes cartes`);
    });
    $('#coll-box').addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act, vis = filteredCards();
      if (act === 'import') { openImport(); return; }
      if (act === 'export') { openExport(); return; }
      if (act === 'add-visible') { vis.forEach(d => { if (S.coll[d.id] == null) S.coll[d.id] = 0; }); toast(`${vis.length} cartes cochées`); }
      if (act === 'remove-visible') { vis.forEach(d => { delete S.coll[d.id]; }); toast('Cartes affichées décochées'); }
      if (act === 'starters') { S.coll = {}; STARTERS.forEach(id => { S.coll[id] = 0; }); toast('Collection réinitialisée aux 6 starters'); }
      saveColl(); renderGrid(); renderCollSummary(); renderDeck();
    });
  }

  // ------------------------------------------------------------------ import / export
  function exportCode() {
    return 'DF1:' + ownedIds().map(id => byId[id].num + (S.coll[id] ? '.' + S.coll[id] : '')).sort((a, b) => parseFloat(a) - parseFloat(b)).join(',');
  }
  function importCode(txt) {
    const m = String(txt).trim().match(/^DF1:([\d.,\s]*)$/i);
    if (!m) throw new Error('Code invalide : il doit commencer par « DF1: »');
    const coll = {};
    m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(p => { const [num, u] = p.split('.'); const d = byNum[+num]; if (d) coll[d.id] = Math.min(+(u || 0), d.talents.length); });
    return coll;
  }
  function parseNameList(txt) {
    const coll = {}, unknown = [];
    String(txt).split(/[\n;,]+/).map(l => l.trim()).filter(Boolean).forEach(line => {
      let n = 1, name = line, m;
      if ((m = line.match(/^(\d+)\s*[x×*]?\s+(.+)$/i))) { n = +m[1]; name = m[2]; }
      else if ((m = line.match(/^(.+?)\s*[x×*]\s*(\d+)$/i))) { n = +m[2]; name = m[1]; }
      else if ((m = line.match(/^(.+?)\s*\((\d+)\)$/))) { n = +m[2]; name = m[1]; }
      const d = findCard(name) || E.DB.cards.find(c => E.norm(c.name).includes(E.norm(name.trim())));
      if (!d) { unknown.push(line); return; }
      coll[d.id] = Math.min(d.talents.length, Math.max(coll[d.id] || 0, n - 1));
    });
    return { coll, unknown };
  }
  const backupJSON = () => JSON.stringify({ app: 'deckforge', v: 2, date: new Date().toISOString(), coll: S.coll, deck: S.deck });
  function restoreBackup(obj) {
    if (!obj || obj.app !== 'deckforge' || !obj.coll) throw new Error('Ce texte n\'est pas une sauvegarde Deckforge.');
    const coll = {};
    Object.keys(obj.coll).forEach(id => { if (byId[id]) coll[id] = Math.min(+obj.coll[id] || 0, byId[id].talents.length); });
    S.coll = coll; saveColl();
    if (Array.isArray(obj.deck)) { S.deck = obj.deck.filter(x => x && byId[x.id]).slice(0, 4); saveDeck(); }
    return Object.keys(coll).length;
  }
  function openExport() {
    openModal(`<h2>Exporter ma collection</h2>
      <div class="stack" style="margin-top:12px">
        <p class="small mute" style="margin:0">Code court à copier-coller : tes cartes et leurs talents débloqués. Utile pour passer du fichier à la version en ligne, ou d'un appareil à l'autre.</p>
        <textarea class="input" id="exp-code" readonly style="min-height:80px">${esc(exportCode())}</textarea>
        <div class="row"><button type="button" class="btn primary" id="exp-copy">Copier le code</button><button type="button" class="btn" id="exp-json">Copier la sauvegarde complète (avec le deck)</button></div>
      </div>`);
    $('#exp-copy').addEventListener('click', () => copyText($('#exp-code').value, 'Code copié'));
    $('#exp-json').addEventListener('click', () => copyText(backupJSON(), 'Sauvegarde copiée'));
  }
  function openImport() {
    openModal(`<h2>Importer</h2>
      <p class="small mute">Colle un <b style="color:var(--ink)">code « DF1:… »</b>, une <b style="color:var(--ink)">sauvegarde</b> (texte commençant par « { ») ou une <b style="color:var(--ink)">liste de noms de cartes</b>, une par ligne. « Spectre Canin x3 » veut dire 3 exemplaires, donc 2 talents débloqués.</p>
      <textarea class="input" id="imp-code" placeholder="Esprit Ombre&#10;Spectre Canin x2&#10;Ashtarae Lycaria"></textarea>
      <label class="row small mute" style="gap:8px;font-weight:700;margin-top:8px"><input type="checkbox" id="imp-merge"> Ajouter à ma collection au lieu de la remplacer</label>
      <p class="small" id="imp-err" style="color:var(--bad)" hidden></p>
      <div class="row" style="margin-top:10px"><button type="button" class="btn primary" id="imp-go">Importer</button></div>`);
    $('#imp-go').addEventListener('click', () => {
      const txt = $('#imp-code').value.trim();
      const fail = msg => { const el = $('#imp-err'); el.hidden = false; el.textContent = msg; };
      try {
        if (!txt) throw new Error('Colle un code, une sauvegarde ou une liste de cartes.');
        let n, unknown = [];
        if (txt[0] === '{') n = restoreBackup(JSON.parse(txt));
        else {
          let coll;
          if (/^DF1:/i.test(txt)) coll = importCode(txt); else ({ coll, unknown } = parseNameList(txt));
          n = Object.keys(coll).length;
          if (!n) throw new Error('Aucune carte reconnue.' + (unknown.length ? ' Non reconnues : ' + unknown.slice(0, 5).join(', ') : ''));
          S.coll = $('#imp-merge').checked ? Object.assign({}, S.coll, coll) : coll;
          saveColl();
        }
        closeModal(); renderAll();
        toast(`${n} cartes importées` + (unknown.length ? ` · non reconnues : ${unknown.slice(0, 3).join(', ')}` : ''));
      } catch (e) { fail(e.message); }
    });
  }

  // ------------------------------------------------------------------ fiche carte
  function openCard(id) {
    const def = byId[id], r = rawOf(def), u = S.coll[id], art = artistOf(def), t = tierOf(def);
    const res = ELI.map((e, i) => `<div><img src="${elIcon(e)}" alt="${EL_NAME[e]}"><span style="color:${def.res[i] < 0 ? 'var(--bad)' : def.res[i] >= 25 ? 'var(--good)' : 'var(--ink)'}">${def.res[i]}%</span></div>`).join('');
    const abil = r.abilities.map(a => `<div class="abil"><div class="t"><b>${esc(a.name)}</b><span class="tag">Recharge ${a.cooldown}</span>${a.precision < 100 ? `<span class="tag">Précision ${a.precision}%</span>` : ''}${a.critChance ? `<span class="tag">Critique ${a.critChance}% ×${a.critMultiplier}</span>` : ''}${a.cooldownResetChance ? `<span class="tag">Écho ${a.cooldownResetChance}%</span>` : ''}</div><div class="fx">${esc(a.effect)}</div></div>`).join('');
    const skills = r.skills.map(s => `<div class="abil"><div class="t"><b>${esc(s.name)}</b><span class="tag" style="color:${RAR_COLOR[s.rarity]}">Tox ${RAR_NAME[s.rarity].toLowerCase()}</span></div><div class="fx">${esc(s.effect)}</div></div>`).join('');
    const tals = r.talents.slice().sort((a, b) => a.slot - b.slot).map(tl => `<div class="abil${u == null || u < tl.slot ? ' locked' : ''}"><div class="t"><b>${esc(tl.name)}</b><span class="tag">Talent ${tl.slot}${u == null || u < tl.slot ? ' · verrouillé' : ' · débloqué'}</span></div><div class="fx">${esc(tl.effect)}</div></div>`).join('');
    const best = t && t.best ? t.best.d : null;
    const wrBlock = t ? `<div class="abil" style="gap:8px"><div class="row" style="gap:10px"><span class="tier t-${t.tier}" style="height:34px;font-size:1.2rem;padding:0 8px">${t.tier}</span>
        <div class="dstats" style="flex:1"><div class="dstat"><div class="k">Winrate du meilleur deck</div><div class="v num">${pct(t.wr)}</div></div>
          <div class="dstat" title="Moyenne des ${t.n} decks simulés qui contiennent cette carte"><div class="k">Moyenne (${t.n} decks)</div><div class="v num">${pct(t.avg)}</div></div>
          <div class="dstat" title="Part des joueurs simulés dont le deck contient cette carte"><div class="k">Jouée par</div><div class="v num">${Math.round(t.pick * 100)} %</div></div></div></div>
      ${best ? `<div class="xs mute">Meilleur deck avec cette carte :</div><div class="row" style="gap:6px">${best.cards.map((cid, k) => { const c = byId[cid]; const tl = best.talents[k] ? c.talents[best.talents[k] - 1] : null; return `<span class="tag el" style="--c:${elColor(c.element)}"><img src="${elIcon(c.element)}" alt="">${esc(c.name)}${best.roles ? ' · ' + ROLE[best.roles[k]][0] : ''}${tl ? ' · ' + esc(tl.name) : ''}</span>`; }).join('')}</div>
        <div class="row" style="gap:6px"><button type="button" class="btn sm primary" id="card-load">Charger ce deck</button>${best.roles ? '<button type="button" class="btn sm" id="card-tactic">Voir la tactique</button>' : ''}</div>` : ''}</div>` : '';
    const pp = patchOf(def), dd = wrDelta(def), before = PATCH.wrBefore ? PATCH.wrBefore[id] : null;
    const evo = dd != null ? `Meilleur deck : ${pct(before)} → ${pct(t.wr)} (${signed(dd)} pts)` : '';
    const patchBlock = pp
      ? `<div class="abil patchbox k-${pp.kind}"><div class="t"><b>${KIND[pp.kind][0]} ${KIND[pp.kind][1]} en ${esc(PATCH.to)}</b>${evo ? `<span class="tag">${evo}</span>` : ''}</div><ul class="plist">${pp.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>`
      : (dd != null && Math.abs(dd) >= 0.03 ? `<p class="xs mute" style="margin:0">Pas modifiée en ${esc(PATCH.to)}, mais la méta a bougé. ${evo}.</p>` : '');
    openModal(`<div class="detail" style="--c:${elColor(def.element)}">
      <div class="stack">
        <div class="bigart"><img src="${bigImgOf(def)}" alt="${esc(def.name)}" data-fallback="${imgOf(def)}"></div>
        ${art ? `<p class="xs mute" style="margin:0">Illustration : ${art.link ? `<a href="${esc(art.link)}" target="_blank" rel="noopener">${esc(art.name)}</a>` : esc(art.name)}</p>` : ''}
        <button type="button" class="btn ${u != null ? '' : 'primary'}" id="card-own">${u != null ? 'Retirer de ma collection' : 'Je possède cette carte'}</button>
        <button type="button" class="btn" id="card-deck">${S.deck.some(x => x.id === id) ? 'Retirer du deck' : 'Ajouter au deck'}</button>
        <button type="button" class="btn" id="card-around" title="Garde cette carte et cherche dans ta collection les 3 meilleures cartes pour l'accompagner">Construire un deck autour</button>
      </div>
      <div class="stack">
        <div><div class="eyebrow" style="color:${RAR_COLOR[def.rar]}">${RAR_NAME[def.rar]} · ${EL_NAME[def.element]} · n°${def.num}</div><h2 style="font-size:1.9rem">${esc(def.name)}</h2></div>
        ${wrBlock}
        ${patchBlock}
        <div class="row"><span class="tag">♥ ${def.hp} PV</span><span class="tag" style="color:var(--gold)">◉ ${def.gen} Spamtons / tour</span></div>
        <div><div class="eyebrow" style="margin-bottom:6px">Résistances</div><div class="resbars">${res}</div></div>
        <div class="stack" style="gap:8px"><div class="eyebrow">Compétences</div>${abil || '<p class="mute small">Aucune compétence active.</p>'}</div>
        ${skills ? `<div class="stack" style="gap:8px"><div class="eyebrow">Tox de base</div>${skills}</div>` : ''}
        <div class="stack" style="gap:8px"><div class="eyebrow">Talents (un seul actif, chaque doublon débloque le suivant)</div>${tals}</div>
      </div></div>`);
    const img = $('.bigart img');
    img.addEventListener('error', () => { if (img.dataset.fallback && img.src !== img.dataset.fallback) img.src = img.dataset.fallback; });
    $('#card-own').addEventListener('click', () => { toggleOwned(id); openCard(id); });
    $('#card-deck').addEventListener('click', () => { addToDeck(id); closeModal(); });
    $('#card-around').addEventListener('click', () => buildAround(id));
    const cl = $('#card-load');
    if (cl) cl.addEventListener('click', () => { closeModal(); setTab('deck'); setDeck(best.cards.map((cid, k) => ({ id: cid, talent: best.talents[k] || 0 }))); toast('Deck chargé'); });
    const ct = $('#card-tactic');
    if (ct) ct.addEventListener('click', () => openTactic(Object.assign({}, best), { load: true }));
  }

  // ================================================================== WINRATES
  function renderWinrates() {
    const W = wrData();
    const V = S.wv;
    let rows = wrRows().slice();
    const counts = { all: rows.length, pop: rows.filter(r => r.share > 0).length, play: rows.filter(r => r.playable).length };
    if (V.filter === 'play') rows = rows.filter(r => r.playable);
    else if (V.filter === 'pop') rows = rows.filter(r => r.share > 0);
    const cf = findCard(V.card);
    if (V.card && cf) rows = rows.filter(r => r.d.cards.includes(cf.id));
    rows.sort((a, b) => V.dir * (a.w - b.w));
    const shown = V.all ? rows : rows.slice(0, 30);
    const body = shown.map((r, k) => {
      const d = r.d;
      const names = d.cards.map((id, x) => `<span class="cn"><b>${esc(shortName(byId[id]))}</b> ${d.roles ? roleTag(d.roles[x]) : ''}</span>`).join('');
      const sub = [r.share > 0 ? `joué par ${Math.max(1, Math.round(r.share * 100))} % des joueurs` : '', r.playable ? '<span style="color:var(--gold)">jouable avec tes cartes</span>' : ''].filter(Boolean).join(' · ');
      return `<tr class="wrow" data-tactic-row="${r.i}" title="Clique pour voir la tactique du deck"><td class="rk">${k + 1}</td>
        <td><div class="wdeck"><span class="imgs">${d.cards.map(id => { const c = byId[id]; return `<img src="${imgOf(c)}" alt="${esc(c.name)}" title="${esc(c.name)}" style="--c:${elColor(c.element)}">`; }).join('')}</span><span class="nm"><span class="cns">${names}</span>${sub ? `<span class="xs">${sub}</span>` : ''}</span></div></td>
        <td class="n"><span class="wcell" style="${heat(r.w)}">${pct(r.w)}</span></td>
        <td>${toxChips(r.tox) || '<span class="faint xs">—</span>'}</td>
        <td class="n"><button type="button" class="btn sm" data-wload="${r.i}">Charger</button></td></tr>`;
    }).join('');
    const groups = { S: [], A: [], B: [], C: [], D: [] };
    E.DB.cards.forEach(d => { const t = tierOf(d); if (t && groups[t.tier]) groups[t.tier].push([d, t]); });
    const lbl = { S: 'Pièces maîtresses', A: 'Très fortes', B: 'Solides', C: 'Situationnelles', D: 'Faibles en classé' };
    const tiers = Object.keys(groups).filter(k => groups[k].length).map(k => `<div class="tierrow"><span class="tier t-${k}" title="${lbl[k]}">${k}</span><div class="stack" style="gap:4px"><span class="xs mute">${lbl[k]} · ${groups[k].length} cartes</span><div class="tiercards">${groups[k].sort((a, b) => b[1].wr - a[1].wr).map(([d, t]) => `<span class="tc${S.coll[d.id] != null ? ' own' : ''}" data-open="${d.id}" title="${esc(d.name)} · meilleur deck ${pct(t.wr)}" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="${esc(d.name)}"><span>${Math.round(t.wr * 100)} %</span></span>`).join('')}</div></div></div>`).join('');
    const games = (W.decks || []).length * ((W.games || 0) + (W.oppCount || 0) * 4);
    const stale = wrStale() ? `<div class="warnbox small">Ces winrates ont été calculés pour le SpamDex ${esc(W.version)}, mais le jeu est passé en ${esc(E.DB.version)}. Clique sur <b>Recalculer</b> pour les mettre à jour avec les nouvelles cartes.</div>` : '';
    $('#wr-body').innerHTML = `
      ${patchPanelHTML()}
      <section class="panel stack">
        <div class="row"><div><div class="eyebrow">Simulations</div><h2>Winrate de tous les decks</h2></div><span class="spacer"></span>
          <button type="button" class="btn" id="wr-recalc" data-needs-idle>Recalculer (≈ 1 min)</button></div>
        ${stale}
        <p class="small mute" style="margin:0;max-width:88ch"><b style="color:var(--ink)">Winrate</b> = taux de victoire contre les decks réellement joués par <b style="color:var(--ink)">${oppText()}</b> : chacun a une collection tirée selon une progression réaliste et joue le meilleur deck de sa collection. La boutique de Tox est simulée dans chaque partie. ${fmt((W.decks || []).length)} decks évalués, environ ${fmt(games)} parties ; un écart de 1 à 2 points n'est pas significatif. <b style="color:var(--ink)">Clique sur un deck</b> pour voir ses rôles, sa tactique et quand utiliser chaque compétence.</p>
        ${progressHTML('wr')}
        <div class="wtoolbar">
          <div class="seg" role="group" aria-label="Filtrer">${[['all', 'Tous'], ['pop', 'Joués'], ['play', 'Jouables']].map(([k, l]) => `<button type="button" data-wfilter="${k}" aria-pressed="${V.filter === k}">${l} ${counts[k]}</button>`).join('')}</div>
          ${lvlSeg()}
          <input class="input" id="w-card" list="dl-all" placeholder="Contient la carte…" value="${esc(V.card)}">
          ${V.card ? '<button type="button" class="btn sm ghost" id="w-card-clear">Effacer</button>' : ''}
        </div>
        <div class="wscroll"><table class="wt"><thead><tr><th>#</th><th>Deck et rôles</th><th aria-sort="${V.dir < 0 ? 'descending' : 'ascending'}"><button type="button" data-wsort title="Inverser le tri">Winrate ${V.dir < 0 ? '▼' : '▲'}</button></th><th title="Tox de boutique qui font le plus gagner ce deck (C, R, É, L = rareté)">Tox clés</th><th></th></tr></thead>
          <tbody>${body || '<tr><td colspan="5" class="mute">Aucun deck ne correspond à ce filtre.</td></tr>'}</tbody></table></div>
        ${rows.length > 30 ? `<div><button type="button" class="btn sm" data-wall>${V.all ? 'Afficher les 30 premiers' : `Afficher les ${rows.length} decks`}</button></div>` : ''}
      </section>
      <section class="panel stack" style="margin-top:16px">
        <div><div class="eyebrow">Tier list</div><h2>Winrate par carte</h2></div>
        <p class="small mute" style="margin:0;max-width:88ch">Pour chaque carte : le winrate du meilleur deck simulé qui la contient. Les cartes entourées d'or sont dans ta collection ; clique pour voir la fiche et charger son meilleur deck.</p>
        <div class="tierlist">${tiers}</div>
      </section>
      ${duosHTML()}`;
    renderProgress(); updateBusy();
  }
  // Duos en synergie : paires de cartes qui gagnent plus ensemble que séparément.
  // gain = meilleur deck avec les deux − max(meilleur deck avec l'une sans l'autre), d'après le tableau des winrates
  function duos() {
    const rows = wrRows(), key = WROWS_KEY;
    if (DUOS && DUOS_KEY === key) return DUOS;
    const byCard = {};
    rows.forEach(r => r.d.cards.forEach(id => (byCard[id] = byCard[id] || []).push(r)));
    for (const id in byCard) byCard[id].sort((a, b) => b.w - a.w);
    const bestWithout = (a, b) => { const r = byCard[a].find(x => !x.d.cards.includes(b)); return r ? r.w : null; };
    const pairs = new Map();
    rows.forEach(r => {
      const c = r.d.cards;
      for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
        const [a, b] = c[i] < c[j] ? [c[i], c[j]] : [c[j], c[i]];
        const k = a + '|' + b, cur = pairs.get(k);
        if (!cur || r.w > cur.best.w) pairs.set(k, { a, b, best: r });
      }
    });
    const out = [];
    for (const p of pairs.values()) {
      if (p.best.w < 0.55) continue;
      const wa = bestWithout(p.a, p.b), wb = bestWithout(p.b, p.a);
      if (wa == null || wb == null) continue;
      const gain = p.best.w - Math.max(wa, wb);
      if (gain >= 0.03) out.push(Object.assign(p, { gain }));
    }
    out.sort((x, y) => y.gain - x.gain || y.best.w - x.best.w);
    DUOS = out; DUOS_KEY = key;
    return out;
  }
  function duosHTML() {
    const list = duos(), V = S.wv;
    if (!list.length) return wrRows().length ? `<section class="panel stack" style="margin-top:16px"><div><div class="eyebrow">Synergies</div><h2>Duos qui gagnent ensemble</h2></div><p class="small mute" style="margin:0">Aucun duo ne se démarque nettement à ce niveau : les meilleurs decks gagnent déjà largement, avec ou sans une carte donnée.</p></section>` : '';
    const shown = list.filter(p => !V.duoMine || (S.coll[p.a] != null && S.coll[p.b] != null)).slice(0, V.duoAll ? 60 : 12);
    const card = id => { const d = byId[id]; return `<span class="duo-c${S.coll[id] != null ? ' own' : ''}" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="${esc(d.name)}"><b>${esc(shortName(d))}</b></span>`; };
    return `<section class="panel stack" style="margin-top:16px">
      <div class="row"><div><div class="eyebrow">Synergies</div><h2>Duos qui gagnent ensemble</h2></div><span class="spacer"></span>
        <div class="seg" role="group" aria-label="Duos"><button type="button" data-duo-mine="0" aria-pressed="${!V.duoMine}">Tous</button><button type="button" data-duo-mine="1" aria-pressed="${!!V.duoMine}">Avec mes cartes</button></div></div>
      <p class="small mute" style="margin:0;max-width:88ch">Paires de cartes dont le meilleur deck commun fait mieux que le meilleur deck de chacune sans l'autre : c'est la synergie, en points de winrate. <b style="color:var(--ink)">Clique sur un duo</b> pour charger son meilleur deck avec les deux cartes gardées (la recherche construira autour).</p>
      <div class="duos">${shown.map(p => `<button type="button" class="duo" data-duo="${p.a}|${p.b}" title="Meilleur deck avec les deux : ${esc(p.best.d.cards.map(id => byId[id].name).join(' + '))} (${pct(p.best.w)})">${card(p.a)}<span class="plus">+</span>${card(p.b)}<span class="duo-v"><span class="gain">+${Math.round(p.gain * 100)} pts</span><span class="xs mute">deck ${Math.round(p.best.w * 100)} %</span></span></button>`).join('') || '<p class="small mute" style="margin:0">Aucun duo avec tes cartes pour l\'instant.</p>'}</div>
      ${list.length > 12 && !V.duoMine ? `<div><button type="button" class="btn sm" data-duo-all>${V.duoAll ? 'Afficher les 12 premiers' : 'Afficher plus de duos'}</button></div>` : ''}
    </section>`;
  }

  // panneau « Patch » : règles modifiées, cartes qui montent / descendent, cartes modifiées
  function patchPanelHTML() {
    const n = patchCount();
    if (!n) return '';
    const moves = E.DB.cards.map(d => [d, wrDelta(d)]).filter(x => x[1] != null);
    const chip = ([d, v]) => `<span class="tc${S.coll[d.id] != null ? ' own' : ''}" data-open="${d.id}" title="${esc(d.name)} · meilleur deck ${pct(PATCH.wrBefore[d.id])} → ${pct(v + PATCH.wrBefore[d.id])}" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt="${esc(d.name)}"><span class="${v >= 0 ? 'up' : 'down'}">${signed(v)}</span></span>`;
    const up = moves.filter(x => x[1] >= 0.02).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const down = moves.filter(x => x[1] <= -0.02).sort((a, b) => a[1] - b[1]).slice(0, 10);
    const changed = E.DB.cards.filter(d => patchOf(d));
    const order = { buff: 0, new: 1, change: 2, nerf: 3 };
    changed.sort((a, b) => order[patchOf(a).kind] - order[patchOf(b).kind] || a.name.localeCompare(b.name, 'fr'));
    const kinds = ['buff', 'nerf', 'change', 'new'].map(k => [k, changed.filter(d => patchOf(d).kind === k).length]).filter(x => x[1]);
    return `<section class="panel stack patchpanel" id="patch-panel" style="margin-bottom:16px">
      <div class="row"><div><div class="eyebrow">Mise à jour du jeu · ${esc(PATCH.date || '')}</div><h2>SpamDex ${esc(PATCH.to)} : ce qui change</h2></div><span class="spacer"></span>
        <span class="row" style="gap:6px">${kinds.map(([k, c]) => `<span class="tag pk k-${k}">${KIND[k][0]} ${c} ${KIND[k][1].toLowerCase()}${c > 1 ? 's' : ''}</span>`).join('')}</span></div>
      ${PATCH.rules && PATCH.rules.length ? `<ul class="plist small">${PATCH.rules.map(r => `<li>${r}</li>`).join('')}</ul>` : ''}
      <p class="small mute" style="margin:0;max-width:88ch">Méta, tier list, population et winrates ont été recalculés avec ces règles. Variation = winrate du meilleur deck qui contient la carte, avant et après le patch.</p>
      <div class="pmoves">
        ${up.length ? `<div class="stack" style="gap:6px"><span class="lbl">Montent</span><div class="tiercards">${up.map(chip).join('')}</div></div>` : ''}
        ${down.length ? `<div class="stack" style="gap:6px"><span class="lbl">Descendent</span><div class="tiercards">${down.map(chip).join('')}</div></div>` : ''}
      </div>
      <details class="pdetails"><summary>Voir les ${changed.length} cartes modifiées</summary>
        <div class="pcards">${changed.map(d => { const p = patchOf(d), v = wrDelta(d); return `<button type="button" class="pcard k-${p.kind}" data-open="${d.id}" style="--c:${elColor(d.element)}"><img src="${imgOf(d)}" alt=""><span class="stack" style="gap:2px;min-width:0"><b>${KIND[p.kind][0]} ${esc(d.name)}${v != null ? ` <span class="${v >= 0 ? 'up' : 'down'}">${signed(v)} pts</span>` : ''}</b><span class="xs mute">${esc(p.changes.join(' · '))}</span></span></button>`; }).join('')}</div>
      </details>
    </section>`;
  }
  function renderPatchNote() {
    const box = $('#patchnote'), n = patchCount();
    if (!n || store.get('patchSeen', '') === PATCH.to) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<div class="row" style="gap:12px;align-items:center"><span class="pnew">Nouveau</span>
      <div class="stack" style="gap:2px;flex:1;min-width:220px"><b>SpamDex ${esc(PATCH.to)}${PATCH.title ? ' : ' + esc(PATCH.title) : ''}</b><span class="small mute">${n} cartes modifiées${PATCH.headline ? ', ' + esc(PATCH.headline) : ''}. Winrates, tier list et tactiques ont été recalculés.</span></div>
      <button type="button" class="btn sm primary" data-patch-see>Voir les changements</button><button type="button" class="btn sm ghost" data-patch-ok>OK</button></div>`;
  }
  function bindPatchNote() {
    $('#patchnote').addEventListener('click', e => {
      const see = e.target.closest('[data-patch-see]');
      if (!see && !e.target.closest('[data-patch-ok]')) return;
      store.set('patchSeen', PATCH.to); renderPatchNote();
      if (see) setTab('winrates'); // le panneau du patch est en haut de l'onglet
    });
  }
  function bindWinrates() {
    const box = $('#wr-body');
    box.addEventListener('change', e => { if (e.target.id === 'w-card') { S.wv.card = e.target.value; renderWinrates(); } });
    box.addEventListener('click', async e => {
      if (e.target.closest('[data-wsort]')) { S.wv.dir = -S.wv.dir; renderWinrates(); return; }
      const wf = e.target.closest('[data-wfilter]');
      if (wf) { S.wv.filter = wf.dataset.wfilter; renderWinrates(); return; }
      if (e.target.closest('#w-card-clear')) { S.wv.card = ''; renderWinrates(); return; }
      if (e.target.closest('[data-wall]')) { S.wv.all = !S.wv.all; renderWinrates(); return; }
      const dm = e.target.closest('[data-duo-mine]');
      if (dm) { S.wv.duoMine = dm.dataset.duoMine === '1'; renderWinrates(); return; }
      if (e.target.closest('[data-duo-all]')) { S.wv.duoAll = !S.wv.duoAll; renderWinrates(); return; }
      const du = e.target.closest('[data-duo]');
      if (du) {
        const [a, b] = du.dataset.duo.split('|');
        const p = duos().find(x => x.a === a && x.b === b);
        if (!p) return;
        const d = p.best.d;
        setTab('deck');
        setDeck(d.cards.map((id, k) => ({ id, talent: d.talents[k] || 0, lock: id === a || id === b })));
        toast(`Deck chargé : ${shortName(byId[a])} et ${shortName(byId[b])} sont gardés`);
        return;
      }
      if (e.target.closest('[data-cancel]')) { Runner.cancel(); return; }
      const op = e.target.closest('[data-open]');
      if (op) { openCard(op.dataset.open); return; }
      const wl = e.target.closest('[data-wload]');
      if (wl) {
        const d = wrData().decks[+wl.dataset.wload];
        setTab('deck'); setDeck(d.cards.map((id, k) => ({ id, talent: d.talents[k] || 0 }))); toast('Deck chargé');
        return;
      }
      const tr = e.target.closest('[data-tactic-row]');
      if (tr) { const d = wrData().decks[+tr.dataset.tacticRow]; openTactic(Object.assign({}, d), { load: true }); return; }
      if (e.target.closest('#wr-recalc')) {
        // dans le navigateur : les 150 meilleurs decks + les decks joués, contre les 60 decks adverses les plus joués
        const all = wrData().decks.filter(d => d.cards.every(id => byId[id]));
        const decks = all.slice().sort((a, b) => b.wr - a.wr).filter((d, k) => k < 150 || (d.share || 0) > 0).slice(0, 220);
        const pdAll = popDecks(), players = pdAll.reduce((x, d) => x + d.n, 0) || 1;
        const pd = pdAll.slice(0, 60), pw = pd.reduce((x, d) => x + d.n, 0) || 1;
        const share = {};
        pdAll.forEach(d => { const k = d.cards.slice().sort().join(); share[k] = (share[k] || 0) + d.n / players; });
        const res = await runJob('wr', 'winrateTable', { decks: decks.map(toDeck), opp: pd.map(toDeck), oppW: pd.map(d => d.n / pw), games: 400, gamesMatrix: 2 });
        if (!res) return;
        S.wr = { format: 3, version: E.DB.version, generated: new Date().toISOString(), games: res.games, players, oppCount: pd.length,
          decks: decks.map((d, i) => ({ cards: d.cards, talents: d.talents, group: d.group, wr: +res.wr[i].toFixed(3), turns: +res.turns[i].toFixed(1), share: +(share[d.cards.slice().sort().join()] || 0).toFixed(3), tox: res.tox[i], roles: res.roles[i].roles, shares: res.roles[i].shares })) };
        store.set('winrates', S.wr);
        CSTATS = null; WROWS = null;
        renderWinrates(); renderGrid();
        toast('Winrates recalculés');
      }
    });
  }

  // ================================================================== AIDE / ACCUEIL
  function openHelp() {
    const artists = {};
    RAW.cards.forEach(c => { const a = c.artwork && c.artwork.artist; if (a) (artists[a.name.trim()] = artists[a.name.trim()] || { link: a.link, n: 0 }).n++; });
    openModal(`<div class="prose">
      <div><div class="eyebrow">Comment c'est calculé · SpamDex ${esc(E.DB.version)}</div><h2>Le winrate de Deckforge</h2></div>
      <p>Chaque deck joue des milliers de parties simulées contre les decks que jouent <b>${POP.players || 200} joueurs simulés</b>. Chaque joueur a une collection tirée au hasard selon une progression réaliste (les communes tombent plus souvent que les légendaires, les doublons débloquent les talents) et choisit son deck parmi les meilleurs de sa collection${POP.rounds ? ` face aux decks que jouent les joueurs de son niveau. Comme sur un vrai classement, la méta s'est ajustée en ${POP.rounds} tours : à chaque tour, chacun s'adapte à ce que jouent ses adversaires` : ''}. Les joueurs ne sont pas parfaits : la plupart jouent leur meilleur deck, certains le 2e ou le 3e. Un deck adverse compte d'autant plus qu'il est joué souvent : c'est ce qui rend le winrate proche du classé.</p>
      <h3>La recherche du meilleur deck</h3>
      <p>Il y a trop de combinaisons pour toutes les simuler en entier. La recherche procède donc par étapes : chaque deck candidat joue d'abord des <b>mini-parties contre les decks les plus joués</b>, ce qui fait apparaître les synergies entre tes cartes (bonus d'un même élément, soins et tanks, provocations, Gel, effets liés aux PV perdus ou aux morts…). On mesure la valeur de chaque carte et de chaque paire de cartes, puis on améliore les meilleurs decks en échangeant une carte à la fois. Les meilleurs candidats passent ensuite des centaines de vraies parties, et leurs talents sont réglés par simulation. Les cartes gardées (épingle dorée dans « Mon deck », ou « Construire un deck autour » dans la fiche d'une carte) sont imposées dans tous les decks testés.</p>
      <h3>Le niveau de tes adversaires</h3>
      <p>En classé, tu affrontes surtout des joueurs de ton niveau. Les joueurs simulés sont donc répartis en trois niveaux selon la taille de leur collection : <b>débutants</b> (moins de 70 cartes obtenues, typique du début de saison), <b>intermédiaires</b> (70 à 235) et <b>confirmés</b> (plus de 235). Choisis le niveau de tes adversaires dans « Mon deck » ou dans l'onglet Winrates : winrates, tier list, duos, recherche du meilleur deck et winrate en direct s'adaptent.</p>
      <h3>Les rôles</h3>
      <p>Ils viennent des parties simulées : le <b>carry</b> fait le plus de dégâts, le <b>support</b> génère le plus de bonus élémentaires, le <b>soigneur</b> soigne le plus, le <b>tank</b> encaisse le plus de coups.</p>
      <h3>Règles simulées</h3>
      <ul>
        <li>Deux joueurs, 4 cartes chacun ; on gagne en détruisant les 4 cartes adverses.</li>
        <li>Chaque tour, toutes les compétences disponibles sont lancées (bonus d'abord, puis attaques, puis soins) ; le premier joueur démarre avec ses recharges réduites de 1, le second de 2.</li>
        <li>Les bonus élémentaires appartiennent au joueur et s'additionnent pendant la partie :</li>
      </ul>
      <code class="formula">Dégâts ou soins = base × (1 + 10 % × bonus de l'élément) × critique × Berserk × (1 − résistance de la cible)</code>
      <ul>
        <li>Talents, Tox de base, provocations, critiques, précision, écho, coûts, métamorphoses et résurrections sont simulés. Pas de terrain aléatoire (retiré du jeu).</li>
        <li><b>Gel</b> : la carte gelée saute son prochain tour ; un dégât d'une autre compétence, un soin ou un nouveau Tox brise la glace et lui inflige 40 dégâts. L'IA évite donc de frapper une carte gelée, sauf pour l'achever.</li>
        <li>Les critiques et Berserk s'appliquent aussi aux soins. <b>Contre</b> riposte une fois sur l'attaquant sous 25 % de PV ; <b>Anticipation</b> lance toutes les compétences au début sur une même carte adverse.</li>
        <li><b>Boutique de Tox</b> : tous les 3 tours, 4 Tox proposés (rareté selon la Chance), l'IA achète les plus utiles à son deck. Les « Tox clés » sont ceux qui font le plus gagner un deck.</li>
      </ul>
      <h3>Limites</h3>
      <ul>
        <li>Certaines règles ne sont pas publiques : les textes ambigus suivent l'interprétation la plus plausible.</li>
        <li>Les deux camps sont joués par la même IA simple ; un joueur humain peut faire mieux ou moins bien.</li>
        <li>Estimation Monte-Carlo : un écart de 1 à 2 points n'est pas significatif dans l'onglet Winrates (des milliers de parties par deck), d'environ 3 points pour le winrate en direct de ton deck.</li>
      </ul>
      <h3>Crédits</h3>
      <p class="small mute" style="margin:0">Données : <a href="https://www.spamgame.com/spamdex" target="_blank" rel="noopener">SpamDex officiel</a>. Projet de fan non officiel, sans lien avec Ticroco ; « Spam » et ses contenus appartiennent à leurs ayants droit. Illustrations de :</p>
      <div class="credits">${Object.keys(artists).sort((a, b) => a.localeCompare(b, 'fr')).map(n => `<div>${artists[n].link ? `<a href="${esc(artists[n].link)}" target="_blank" rel="noopener">${esc(n)}</a>` : esc(n)} <span class="faint">(${artists[n].n})</span></div>`).join('')}</div>
    </div>`);
  }
  function renderOnboarding() {
    const box = $('#onboard');
    if (store.get('onboarded', false)) { box.hidden = true; return; }
    box.hidden = false;
    box.style.marginBottom = '16px';
    box.innerHTML = `<div class="row" style="align-items:flex-start;gap:16px"><div class="stack" style="gap:8px;flex:1">
      <div><div class="eyebrow">Bienvenue</div><h2>Trouve ton meilleur deck</h2></div>
      <ol class="steps"><li>Coche le rond <b>✓</b> des cartes que tu possèdes (ou importe une liste de noms).</li>
        <li>Clique sur des cartes pour composer ton deck : son winrate et les rôles s'affichent dans « Mon deck ». Ou clique sur <b>Trouver mon meilleur deck</b> : les cartes que tu as choisies sont gardées (épingle dorée) et la recherche construit le meilleur deck autour.</li>
        <li>Compare avec tous les decks du jeu dans l'onglet <b>Winrates</b> et clique sur un deck pour voir sa tactique.</li></ol></div>
      <button type="button" class="btn" id="onboard-ok">Compris</button></div>`;
    $('#onboard-ok').addEventListener('click', () => { store.set('onboarded', true); box.hidden = true; });
  }

  // ================================================================== MISE À JOUR DES DONNÉES
  function renderBadge() {
    $('#data-version').textContent = `SpamDex ${E.DB.version} · ${E.DB.cards.length} cartes`;
    $('#data-dot').classList.toggle('off', !S.online);
    $('#data-dot').title = S.online ? 'Données à jour (spamgame.com)' : 'Données intégrées (hors ligne)';
  }
  async function checkUpdate() {
    try {
      const idx = await fetch(DATA_BASE + 'index.json', { cache: 'no-store' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
      S.online = true;
      if (idx.latest && idx.latest !== E.DB.version) {
        const cards = await fetch(DATA_BASE + String(idx.cards || '{version}/cards.{language}.json').replace('{version}', idx.latest).replace('{language}', 'fr'), { cache: 'no-store' }).then(r => r.json());
        if (cards && cards.cards && cards.cards.length) {
          loadData(cards);
          Runner.start();
          renderAll();
          toast(`Données mises à jour : SpamDex ${idx.latest}`);
        }
      }
    } catch (e) { S.online = false; }
    renderBadge();
  }

  // ================================================================== INIT
  function renderAll() {
    renderPatchNote();
    renderOnboarding();
    renderFilters();
    renderGrid();
    renderCollSummary();
    renderDeck();
    renderBadge();
    $('#dl-all').innerHTML = E.DB.cards.map(d => `<option value="${esc(d.name)}"></option>`).join('');
    setTab(S.tab);
  }
  function init() {
    $$('.tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    $('#open-help').addEventListener('click', openHelp);
    document.addEventListener('click', e => { const b = e.target.closest('[data-lvl]'); if (b) setLvl(+b.dataset.lvl); });
    $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' || e.target.closest('.close')) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
    bindCatalog();
    bindDeck();
    bindWinrates();
    bindPatchNote();
    Runner.start();
    const live = store.get('live', null);
    if (live && live.key === liveKey() && live.v === E.DB.version && live.rf === 2 && live.wr != null && live.roles) S.live = Object.assign(live, { busy: false });
    renderAll();
    checkUpdate();
    if (S.deck.length === 4 && !(S.live && S.live.key === liveKey())) scheduleEval();
    if ('serviceWorker' in navigator && location.protocol === 'https:' && window.self === window.top && document.querySelector('link[rel="manifest"]')) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      const b = $('#install-app'); if (!b) return;
      b.hidden = false;
      b.onclick = () => { e.prompt(); b.hidden = true; };
    });
    if (/^#deck-/i.test(location.hash)) setTimeout(openSharedDeck, 200);
    window.addEventListener('hashchange', () => { if (/^#deck-/i.test(location.hash)) openSharedDeck(); });
  }
  init();
})();
