// Mise à jour du SpamDex en une commande.
//   node tools/update.js              nouvelle version ? archive, téléchargement, contrôle du simulateur, notes de patch
//   node tools/update.js --check      dit seulement s'il y a une nouvelle version (code de sortie 1 si oui)
//   node tools/update.js --run quick  … puis recalcul rapide (≈ 1 h) et construction du site
//   node tools/update.js --run full   … puis recalcul complet (≈ 10 h, tools/night.sh) et construction du site
// Le contrôle signale ce que le simulateur ne sait peut-être pas encore gérer (nouvelles actions, talents, Tox, textes) :
// dans ce cas il vaut mieux faire adapter src/engine.js avant de lancer le recalcul (--force pour lancer quand même).
const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const BASE = 'https://www.spamgame.com/data/';
const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true) : null; };

const get = url => new Promise((resolve, reject) => {
  https.get(url, res => {
    if (res.statusCode !== 200) { res.resume(); return reject(new Error(`${url} : HTTP ${res.statusCode}`)); }
    const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve(Buffer.concat(chunks)));
  }).on('error', reject);
});
const rd = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const copyDir = (a, b) => { fs.mkdirSync(b, { recursive: true }); for (const f of fs.readdirSync(a)) { const s = path.join(a, f), d = path.join(b, f); if (fs.statSync(s).isDirectory()) copyDir(s, d); else if (!/partial/.test(f)) fs.copyFileSync(s, d); } };

// ---------------------------------------------------------------- contrôle : ce que le simulateur connaît
function coverage(A, B) {
  const engine = fs.readFileSync(path.join(ROOT, 'src/engine.js'), 'utf8');
  const out = [];
  const actions = d => { const s = new Set(); for (const c of d.cards) { for (const a of c.abilities) for (const x of a.actions) s.add(x.effect); } return s; };
  const na = [...actions(B)].filter(x => !actions(A).has(x) && !engine.includes(`'${x}'`));
  if (na.length) out.push(`Nouvelles actions de compétence : ${na.join(', ')}`);
  const tal = new Set(B.cards.flatMap(c => c.talents.map(t => t.id)));
  const nt = [...tal].filter(id => !engine.includes(`'${id}'`) && !A.cards.some(c => c.talents.some(t => t.id === id)));
  if (nt.length) out.push(`Nouveaux talents : ${nt.join(', ')}`);
  const sk = new Set(B.cards.flatMap(c => c.skills.map(s => String(s.id).replace(/_[CREL]$/, ''))));
  const ns = [...sk].filter(id => !engine.includes(`'${id}'`));
  if (ns.length) out.push(`Tox inconnus du simulateur : ${ns.join(', ')}`);
  const ka = new Set(A.keywords.map(k => k.id));
  const nk = B.keywords.filter(k => !ka.has(k.id));
  if (nk.length) out.push(`Nouveaux mots-clés : ${nk.map(k => `${k.title} (« ${k.description} »)`).join(' ; ')}`);
  // lignes de texte de compétence jamais vues (chiffres ignorés) : nouvelles mécaniques possibles
  const lines = d => { const s = new Set(); for (const c of d.cards) for (const a of c.abilities) for (const l of a.effect.split('\n')) s.add(l.replace(/[\d.,]+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase()); return s; };
  const la = lines(A), nl = [...lines(B)].filter(l => l && !la.has(l));
  if (nl.length) out.push(`Textes de compétence nouveaux (à vérifier) :\n    - ${nl.join('\n    - ')}`);
  return out;
}

(async () => {
  const idx = JSON.parse(await get(BASE + 'index.json'));
  const cur = rd('data/cards.fr.json');
  const latest = idx.latest;
  if (opt('--check')) { console.log(latest === cur.version ? `À jour (SpamDex ${cur.version}).` : `Nouvelle version : ${latest} (installée : ${cur.version}).`); process.exit(latest === cur.version ? 0 : 1); }
  let A = cur, B = cur, archive = null;
  if (latest !== cur.version) {
    console.log(`SpamDex ${cur.version} → ${latest}`);
    B = JSON.parse(await get(BASE + String(idx.cards || '{version}/cards.{language}.json').replace('{version}', latest).replace('{language}', 'fr')));
    archive = `archive/spamdex-${cur.version}`;
    if (!fs.existsSync(path.join(ROOT, archive))) {
      copyDir(path.join(ROOT, 'src'), path.join(ROOT, archive, 'src'));
      copyDir(path.join(ROOT, 'data'), path.join(ROOT, archive, 'data'));
      if (fs.existsSync(path.join(ROOT, 'Deckforge.html'))) fs.copyFileSync(path.join(ROOT, 'Deckforge.html'), path.join(ROOT, archive, 'Deckforge.html'));
      console.log(`  ancienne version archivée dans ${archive}`);
    }
    fs.writeFileSync(path.join(ROOT, 'data/cards.fr.json'), JSON.stringify(B, null, 1));
    // miniatures nouvelles ou modifiées
    let img = 0;
    for (const c of B.cards) {
      const f = path.join(ROOT, 'assets/tiny', path.basename(c.artwork.tiny));
      if (fs.existsSync(f)) continue;
      try { fs.writeFileSync(f, await get(BASE + c.artwork.tiny)); img++; } catch (e) { console.warn('  miniature indisponible :', c.name); }
    }
    if (img) console.log(`  ${img} miniature(s) téléchargée(s)`);
    fs.writeFileSync(path.join(__dirname, 'last_archive.txt'), archive);
  } else {
    console.log(`Déjà à jour (SpamDex ${cur.version}).`);
    archive = fs.existsSync(path.join(__dirname, 'last_archive.txt')) ? fs.readFileSync(path.join(__dirname, 'last_archive.txt'), 'utf8').trim() : null;
    if (archive) A = rd(path.join(archive, 'data/cards.fr.json'));
  }
  // contrôle du simulateur
  const issues = A === B ? [] : coverage(A, B);
  if (issues.length) {
    console.log('\nÀ VÉRIFIER avant le recalcul (le simulateur ne connaît peut-être pas encore ces changements) :');
    issues.forEach(i => console.log('  • ' + i));
  } else if (A !== B) console.log('\nContrôle du simulateur : rien de nouveau à adapter (seulement des valeurs, lues automatiquement).');
  // notes de patch
  if (archive) {
    try { console.log('\n' + execSync(`node tools/patch.js ${archive}`, { cwd: ROOT }).toString().split('\n')[0]); }
    catch (e) { console.warn('notes de patch impossibles :', e.message.split('\n')[0]); }
  }
  // recalcul
  const run = opt('--run');
  if (!run) return;
  if (issues.length && !opt('--force')) { console.log('\nRecalcul NON lancé : adapte d\'abord le simulateur (ou relance avec --force).'); process.exit(2); }
  const sh = cmd => { console.log(`\n[${new Date().toLocaleTimeString('fr-FR')}] ${cmd}`); execSync(cmd, { cwd: ROOT, stdio: 'inherit' }); };
  if (run === 'full') sh('bash tools/night.sh');
  else {
    // rapide : tier list et duos allégés, ladder court (repart de la méta précédente), winrates à 8000 parties
    sh('node tools/tiers.js normal 3 > tools/tiers.log 2>&1');
    sh('node tools/pairs.js 40 fast > tools/pairs.log 2>&1');
    sh('node tools/ladder.js 1500 2 fast 30 > tools/ladder.log 2>&1');
    sh('node tools/winrates.js 8000 200 3000 > tools/winrates.log 2>&1');
    if (archive) sh(`node tools/patch.js ${archive} > tools/patch.log 2>&1`);
    sh('node tools/build.js');
  }
  console.log('\nTerminé : Deckforge.html et site/ sont à jour.');
})().catch(e => { console.error('Erreur :', e.message); process.exit(3); });
