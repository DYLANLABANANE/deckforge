// Assemble l'application en un seul fichier HTML autonome.
//   - Deckforge.html        : à ouvrir directement dans un navigateur (double-clic)
//   - dist/artifact.html    : même contenu sans l'enveloppe <html>/<head>/<body> (publication web)
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const raw = JSON.parse(rd('data/cards.fr.json'));

// ---- données allégées (ce dont le moteur et l'interface ont besoin)
const pickArtwork = a => a ? { small: a.small, tiny: a.tiny, artist: a.artist ? { name: a.artist.name, link: a.artist.link || null } : null } : null;
const data = {
  schema: raw.schema, version: raw.version, language: raw.language, generatedAt: raw.generatedAt,
  cards: raw.cards.map(c => ({
    id: c.id, slug: c.slug, number: c.number, name: c.name, element: c.element, rarity: c.rarity,
    spamton: c.spamton, hp: c.hp, resistances: c.resistances, artwork: pickArtwork(c.artwork),
    abilities: c.abilities.map(a => ({
      name: a.name, effect: a.effect, cooldown: a.cooldown, precision: a.precision, critChance: a.critChance,
      critMultiplier: a.critMultiplier, duration: a.duration, uses: a.uses, cooldownResetChance: a.cooldownResetChance,
      actions: a.actions.map(x => ({ effect: x.effect, min: x.min, max: x.max, element: x.element, chain: x.chain }))
    })),
    skills: c.skills.map(s => ({ id: s.id, name: s.name, effect: s.effect, rarity: s.rarity, value: s.value })),
    talents: c.talents.map(t => ({ slot: t.slot, id: t.id, name: t.name, effect: t.effect })),
    lore: c.lore ? { species: c.lore.species, region: c.lore.region } : null
  }))
};

// ---- méta : identifiants de cartes
const meta = JSON.parse(rd('src/meta.json'));
const tiers = fs.existsSync(path.join(ROOT, 'src/tiers.json')) ? JSON.parse(rd('src/tiers.json')) : { cards: {} };
const winrates = fs.existsSync(path.join(ROOT, 'src/winrates.json')) ? JSON.parse(rd('src/winrates.json')) : { decks: [] };
// talents les plus retenus par carte, calculés sur tous les decks avant d'alléger la page (départ des recherches de l'appli)
if (!winrates.talentPrefs && winrates.decks.length) winrates.talentPrefs = require('../src/optimizer.js').talentPrefsFrom(winrates);
// page plus légère : on garde les decks joués, la méta, les decks réels, les decks à 50 % et plus et le meilleur deck de
// chaque carte, contre chaque adversaire possible (joueurs simulés de chaque niveau, vrais decks de chaque rang)
{
  const modes = [d => d.wr];
  const nb = Math.max(0, ...winrates.decks.map(d => (d.wrb || []).length)), nr = Math.max(0, ...winrates.decks.map(d => (d.wrr || []).length));
  for (let b = 0; b < nb; b++) modes.push(d => (d.wrb ? d.wrb[b] : null));
  for (let q = 0; q < nr; q++) modes.push(d => (d.wrr ? d.wrr[q] : null));
  const keepIdx = new Set();
  for (const f of modes) {
    const bestOf = {};
    winrates.decks.forEach((d, i) => { const v = f(d); if (typeof v === 'number') d.cards.forEach(id => { if (bestOf[id] == null || v > f(winrates.decks[bestOf[id]])) bestOf[id] = i; }); });
    Object.values(bestOf).forEach(i => keepIdx.add(i));
  }
  const strong = d => modes.some(f => { const v = f(d); return typeof v === 'number' && v >= 0.5; });
  const before = winrates.decks.length;
  const kept = winrates.decks.map((d, i) => [d, i]).filter(([d, i]) => d.share > 0 || d.group === 'meta' || d.group === 'real' || strong(d) || keepIdx.has(i));
  const remap = new Map(kept.map(([, i], k) => [i, k]));
  winrates.decks = kept.map(([d]) => d);
  if (winrates.matrix && winrates.matrix.idx) winrates.matrix.idx = winrates.matrix.idx.map(i => (remap.has(i) ? remap.get(i) : -1));
  if (before !== winrates.decks.length) console.log(`winrates : ${winrates.decks.length} decks gardés sur ${before}`);
}
// vrai winrate (Spamomètre, ≥ 15 parties) des decks qui en ont un, pour chaque groupe de rangs des vrais adversaires :
// rw = [[victoires, parties] ou null, …] dans l'ordre des rangs de winrates.real
if (winrates.real && fs.existsSync(path.join(ROOT, 'src/barometre.json'))) {
  const baro = JSON.parse(rd('src/barometre.json'));
  const { POOLS } = require('./realpool.js');
  const key = ids => ids.slice().sort().join();
  const maps = winrates.real.pools.map(p => {
    const P = POOLS.find(x => x.name === p.name), m = new Map();
    const srcs = P && P.ranks ? P.ranks.map(r => baro.ranks && baro.ranks[r]).filter(Boolean) : [baro];
    srcs.forEach(R => (R.decks || []).forEach(d => {
      if (d.win == null) return;
      const e = m.get(key(d.cards)) || { w: 0, g: 0 };
      e.w += d.win * d.games; e.g += d.games;
      m.set(key(d.cards), e);
    }));
    return m;
  });
  winrates.decks.forEach(d => {
    const rw = maps.map(m => { const e = m.get(key(d.cards)); return e ? [+(e.w / e.g).toFixed(3), e.g] : null; });
    if (rw.some(Boolean)) d.rw = rw;
  });
}
const population = fs.existsSync(path.join(ROOT, 'src/population.json')) ? JSON.parse(rd('src/population.json')) : { decks: [], players: 0 };
delete population.players_detail;
// page plus légère : decks optimisés joués en moyenne par au moins 0,6 joueur (la longue traîne pèse moins de quelques %),
// mais tous les decks à thème (un joueur chacun ou presque : ensemble, la majorité des adversaires) ; cartes en numéros,
// ici comme dans les winrates (l'appli les retraduit en identifiants au chargement)
if (population.decks && population.decks.length > 800) {
  const before = population.decks.length;
  population.decks = population.decks.filter((d, i) => i < 800 || d.n - (d.nc || 0) >= 0.6 || (d.nc || 0) > 0);
  console.log(`population : ${population.decks.length} decks gardés sur ${before}`);
}
{
  const num = {}; raw.cards.forEach(c => { num[c.id] = c.number; });
  const toNum = d => { d.cards = d.cards.map(id => (num[id] != null ? num[id] : id)); };
  (population.decks || []).forEach(toNum);
  winrates.decks.forEach(toNum);
  if (winrates.real) winrates.real.decks.forEach(toNum);
}
const patch = fs.existsSync(path.join(ROOT, 'src/patch.json')) ? JSON.parse(rd('src/patch.json')) : {};

// ---- images intégrées (data URI)
const b64 = f => 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');
const assets = { img: {}, el: {}, rar: {} };
for (const c of raw.cards) {
  const f = path.join(ROOT, 'assets/tiny', path.basename(c.artwork.tiny));
  if (fs.existsSync(f)) assets.img[c.slug] = b64(f);
  else console.warn('image manquante', c.slug);
}
for (const e of ['fire', 'water', 'earth', 'nature', 'light', 'shadow', 'divine']) assets.el[e] = b64(path.join(ROOT, 'assets/icons', e + '.webp'));

// ---- assemblage
const safeJSON = o => JSON.stringify(o).replace(/</g, '\\u003c');
const code = p => { const s = rd(p); if (/<\/script/i.test(s)) throw new Error(p + ' contient </script'); return s; };
let html = rd('src/app.html');
const parts = {
  '/*CSS*/': rd('src/app.css'),
  '/*DATA*/': safeJSON(data),
  '/*META*/': safeJSON(meta),
  '/*TIERS*/': safeJSON(tiers),
  '/*WINRATES*/': safeJSON(winrates),
  '/*POP*/': safeJSON(population),
  '/*PATCH*/': safeJSON(patch),
  '/*ASSETS*/': safeJSON(assets),
  '/*ENGINE*/': code('src/engine.js'),
  '/*OPTIMIZER*/': code('src/optimizer.js'),
  '/*APP*/': code('src/app.js')
};
for (const [k, v] of Object.entries(parts)) {
  if (!html.includes(k)) throw new Error('marqueur absent ' + k);
  html = html.split(k).join(v);
}

// favicon intégré (fichier local et version en ligne sur claude.ai)
const favPath = path.join(ROOT, 'assets/app/favicon-64.png');
if (fs.existsSync(favPath)) html = html.replace('<title>', `<link rel="icon" type="image/png" href="data:image/png;base64,${fs.readFileSync(favPath).toString('base64')}">\n<title>`);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'dist/artifact.html'), html);
const split = html.indexOf('<header');
const doc = (headExtra) => '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  + (headExtra || '') + html.slice(0, split) + '</head>\n<body>\n' + html.slice(split) + '\n</body>\n</html>\n';
const full = doc('');
fs.writeFileSync(path.join(ROOT, 'Deckforge.html'), full);

// ---- site web (Netlify ou tout hébergeur statique) : dossier site/
const SITE = path.join(ROOT, 'site');
fs.mkdirSync(SITE, { recursive: true });
// adresse publique : fournie par Netlify pendant un build (URL) ou à la main (SITE_URL=https://…)
const siteUrl = (process.env.SITE_URL || process.env.URL || '').replace(/\/$/, '');
const desc = `Coche tes cartes SPAM et trouve ton meilleur deck : winrate en direct, tier list et tactiques calculés sur des milliers de parties simulées (SpamDex ${raw.version}). Projet de fan non officiel.`;
const head = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<meta name="theme-color" content="#13101d">',
  '<link rel="apple-touch-icon" href="apple-touch-icon.png">',
  '<meta property="og:type" content="website">',
  '<meta property="og:title" content="Deckforge · optimiseur de decks SPAM">',
  `<meta property="og:description" content="${desc}">`,
  `<meta property="og:image" content="${siteUrl ? siteUrl + '/' : ''}og.png">`,
  siteUrl ? `<meta property="og:url" content="${siteUrl}/">` : '',
  '<meta name="twitter:card" content="summary_large_image">',
  ''
].filter(x => x !== null).join('\n');
const siteHtml = doc(head);
fs.writeFileSync(path.join(SITE, 'index.html'), siteHtml);
for (const f of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'favicon-64.png', 'og.png']) {
  const src = path.join(ROOT, 'assets/app', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SITE, f));
}
fs.writeFileSync(path.join(SITE, 'manifest.webmanifest'), JSON.stringify({
  name: 'Deckforge · optimiseur de decks SPAM', short_name: 'Deckforge', lang: 'fr', start_url: './', scope: './',
  display: 'standalone', background_color: '#13101d', theme_color: '#13101d', description: desc,
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
  ]
}, null, 2));
const version = require('crypto').createHash('md5').update(siteHtml).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(SITE, 'sw.js'), `// Service worker Deckforge : l'application reste utilisable hors ligne.
const V = 'deckforge-${version}';
const IMG = 'deckforge-img';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './favicon-64.png'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== V && k !== IMG).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') {
      // page : réseau d'abord (mises à jour), cache si hors ligne
      e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(V).then(c => c.put('./index.html', copy)); return r; })
        .catch(() => caches.match('./index.html')));
    } else {
      e.respondWith(caches.match(req).then(r => r || fetch(req)));
    }
    return;
  }
  // illustrations HD de spamgame.com : gardées en cache une fois vues
  if (/(^|\\.)spamgame\\.com$/.test(url.hostname) && url.pathname.indexOf('/img/') >= 0) {
    e.respondWith(caches.open(IMG).then(c => c.match(req).then(r => r || fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }))));
  }
});
`);
fs.writeFileSync(path.join(SITE, '_headers'), `/index.html
  Cache-Control: no-cache
/
  Cache-Control: no-cache
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Content-Type: application/manifest+json
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
`);
fs.writeFileSync(path.join(SITE, 'robots.txt'), 'User-agent: *\nAllow: /\n');

const kb = n => (n / 1024).toFixed(0) + ' Ko';
console.log('Deckforge.html', kb(Buffer.byteLength(full)), '| site/index.html', kb(Buffer.byteLength(siteHtml)), siteUrl ? '(' + siteUrl + ')' : '(sans adresse publique : og:image relative)',
  '| données', kb(safeJSON(data).length), '| images', kb(safeJSON(assets).length));
