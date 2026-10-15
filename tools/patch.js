// Notes de patch : compare l'ancienne version archivée (cartes + winrates) à la version actuelle.
// Écrit src/patch.json : règles modifiées, changements par carte, winrate de chaque carte avant le patch.
// usage: node tools/patch.js archive/spamdex-1.19
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const rd = p => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), 'utf8'));

const oldDir = process.argv[2];
if (!oldDir) { console.error('usage: node tools/patch.js <dossier de l\'ancienne version>'); process.exit(1); }
const A = rd(path.join(oldDir, 'data/cards.fr.json'));
const B = rd('data/cards.fr.json');
const oldWr = fs.existsSync(path.join(ROOT, oldDir, 'src/winrates.json')) ? rd(path.join(oldDir, 'src/winrates.json')) : { decks: [] };

// règles du jeu modifiées (textes écrits à la main pour chaque version)
const RULES = {
  '1.20': [
    '<b>Gel</b> remplace Étourdissement : la cible ne peut pas agir pendant son prochain tour, mais un autre dégât, un soin ou un nouveau Tox brise la glace (+40 dégâts).',
    'Les <b>critiques</b>, la Puissance critique et <b>Berserk</b> s\'appliquent aussi aux soins.',
    '<b>Contre</b> : une fois par partie, quand la carte passe sous 25 % de PV, elle riposte avec toutes ses compétences sur son attaquant.',
    '<b>Anticipation</b> : au début de la partie, la carte lance toutes ses compétences sur une même carte adverse aléatoire.',
    '<b>Résilience</b> : +25 % de résistances tant que la carte est sous 50 % de PV (et plus seulement la première fois).',
    '<b>Inversement</b> échange aussi Éternité et Temporalité ; <b>Évolution</b> remplace Cœur d\'acier sur les 6 Rois élémentaires.'
  ]
};
RULES['1.21'] = [
  '<b>Gel</b> : la glace brisée inflige maintenant <b>60 dégâts</b> (au lieu de 40).',
  '<b>Cœur résistance</b> agit au début de chacun de vos tours (+3 de résistances à toutes vos cartes à chaque tour en commune, +6 en rare), au lieu d\'une seule fois.',
  '<b>Ashtarae</b> perd 300 PV et la moitié de ses Spamtons, et sa Résurrection coûte maintenant 5 Ombre ; <b>Murmures du Corail Noir</b> et <b>Tisseuse de Mots</b> sont aussi affaiblis.',
  '<b>Zombie Floral</b> frappe désormais toutes les cartes adverses, <b>Rongeur Nuageux</b> gagne « Foudre » (dégâts selon ses PV manquants), <b>Dragon Ciel</b> une attaque de zone.',
  '<b>Précision</b> : réussite de l\'effet d\'une compétence ; <b>Sac de frappe</b> : seulement les attaques adverses (déjà le cas dans les simulations).'
];
RULES['1.23'] = [
  "<b>Dégâts bonus</b> (nouveau mot-clé) : les dégâts liés aux PV manquants d'<b>Aleera</b> et de <b>Rongeur Nuageux</b> ne profitent plus des bonus élémentaires (Berserk et résistances s'appliquent toujours). Gros nerf d'Aleera.",
  '<b>Cavalerie</b> : +100 PV aux alliés au lieu de +150. <b>Vitalité des Âmes</b> : +200 PV par mort au lieu de +300.',
  '<b>Rois élémentaires</b> : attaque principale à recharge 3 au lieu de 5, dégâts [30 à 50]. <b>Lums</b> et <b>Le Héraut des Cendres</b> ne demandent plus de choisir : attaque ET bonus.',
  '<b>Wyrm des Dunes Cornu</b> devient « Grain de sable » : attaque 10 Terre, Gel en cas de coup critique, Écho 50 %.',
  'Les valeurs des talents sont maintenant lues directement dans le SpamDex : les prochains rééquilibrages de talents seront pris en compte automatiquement.'
];
const TITLE = { '1.20': 'sortie du jeu', '1.21': 'rééquilibrage', '1.23': 'gros rééquilibrage' };
const HEADLINE = { '1.20': "le Gel remplace l'Étourdissement", '1.21': 'Ashtarae et Murmures affaiblis, Zombie Floral et Rongeur Nuageux renforcés', '1.23': 'Aleera nerfée, Cavalerie et Vitalité des Âmes réduites, Rois accélérés' };
// talents dont le texte a changé de sens (les autres changements de texte sont des reformulations)
const REWORKED_TALENTS = new Set(['Contre', 'Anticipation', 'Resilience']);
// Tox dont le texte a changé de sens en 1.21 (les autres : précisions sans effet sur les simulations)
const TOX_REWORKED = ['CoeurResistance'];

const flat = s => String(s || '').replace(/\s*-{3,}\s*ou\s*-{3,}\s*/g, ' — ou — ').replace(/^Choix\s*\n/, 'Choix : ').replace(/\s*\n\s*/g, ' · ');
const same = (a, b) => String(a || '').replace(/\s+/g, '').replace(/\+(\d)/g, '$1').replace(/’/g, "'").toLowerCase() === String(b || '').replace(/\s+/g, '').replace(/\+(\d)/g, '$1').replace(/’/g, "'").toLowerCase();
const sum = (acts, kinds) => acts.filter(x => kinds.includes(x.effect)).reduce((s, x) => s + (x.min + x.max) / 2, 0);
const DMG = ['damage', 'DamageAll', 'DamageCasterHP', 'DamageWithCardElement'];
const HEAL = ['healTarget', 'healCaster'];
const BONUS = ['AddAllPlayerAttack', 'AddAllPlayerAttackRandomTeam'];
const CRIT = ['AddAllPlayerCritick', 'AddCardCriticChance', 'AddOppCardCriticChance', 'AddCardCriticRatio'];

const oldById = new Map(A.cards.map(c => [c.id, c]));
const cards = {};
for (const c of B.cards) {
  const o = oldById.get(c.id);
  if (!o) { cards[c.id] = { kind: 'new', changes: ['Nouvelle carte'] }; continue; }
  const ch = [];
  let score = 0;
  if (o.hp !== c.hp) { ch.push(`PV ${o.hp} → ${c.hp}`); score += Math.sign(c.hp - o.hp); }
  if (o.spamton !== c.spamton) { ch.push(`Spamtons ${o.spamton} → ${c.spamton}`); score += Math.sign(c.spamton - o.spamton); }
  const els = ['fire', 'water', 'earth', 'nature', 'light', 'shadow'];
  const rd0 = els.map(e => (c.resistances[e] || 0) - (o.resistances[e] || 0));
  if (rd0.some(Boolean)) {
    const same = els.every(e => o.resistances[e] === o.resistances.fire && c.resistances[e] === c.resistances.fire);
    ch.push(same ? `Résistances ${o.resistances.fire} % → ${c.resistances.fire} %` : 'Résistances modifiées');
    score += Math.sign(rd0.reduce((s, x) => s + x, 0));
  }
  c.abilities.forEach((a, i) => {
    const p = o.abilities[i];
    if (!p) { ch.push(`Nouvelle compétence « ${a.name} »`); score++; return; }
    const label = p.name !== a.name ? `« ${p.name} » devient « ${a.name} »` : `« ${a.name} »`;
    if (p.cooldown !== a.cooldown) { ch.push(`${label} : recharge ${p.cooldown} → ${a.cooldown}`); score += Math.sign(p.cooldown - a.cooldown); }
    if ((p.critChance || 0) !== (a.critChance || 0)) { ch.push(`${label} : critique ${p.critChance || 0} % → ${a.critChance || 0} %`); score += Math.sign((a.critChance || 0) - (p.critChance || 0)); }
    if (!same(p.effect, a.effect)) {
      ch.push(`${label} : ${flat(a.effect)} (avant : ${flat(p.effect)})`);
      for (const k of [DMG, HEAL, BONUS, CRIT]) score += Math.sign(sum(a.actions, k) - sum(p.actions, k));
      if (/\[co[uû]t/i.test(a.effect) && !/\[co[uû]t/i.test(p.effect)) score--;          // un coût apparaît
      if (/toutes les cartes adverses/i.test(a.effect) && !/toutes les cartes adverses/i.test(p.effect)) score++; // devient une attaque de zone
      if (/dégâts bonus/i.test(a.effect) && !/dégâts bonus/i.test(p.effect)) score--;                          // « dégâts bonus » sans bonus élémentaire (1.23)
    }
  });
  c.skills.forEach((s, i) => {
    const p = o.skills[i];
    if (!p) { ch.push(`Nouveau Tox ${s.name}`); return; }
    if (p.name !== s.name && p.name.replace(/e/g, 'é') !== s.name) ch.push(`Tox ${p.name} → ${s.name}`);
    else if (p.value !== s.value) { ch.push(`Tox ${s.name} : ${p.value} → ${s.value}`); score += Math.sign(s.value - p.value); }
    else if (TOX_REWORKED.some(x => s.id.startsWith(x)) && !same(p.effect, s.effect)) ch.push(`Tox ${s.name} : ${flat(s.effect)}`);
  });
  c.talents.forEach(t => {
    const p = o.talents.find(x => x.slot === t.slot);
    if (!p) return;
    if (p.id !== t.id) ch.push(`Talent ${t.slot} : ${p.name} → ${t.name}`);
    else if (JSON.stringify((p.actions || []).map(x => x.min)) !== JSON.stringify((t.actions || []).map(x => x.min))) {
      ch.push(`Talent ${t.name} : ${flat(t.effect)} (avant : ${flat(p.effect)})`);
      score += Math.sign((t.actions || []).reduce((a, x) => a + Math.abs(x.min), 0) - (p.actions || []).reduce((a, x) => a + Math.abs(x.min), 0));
    }
    else if (REWORKED_TALENTS.has(t.id) && !same(p.effect, t.effect)) ch.push(`Talent ${t.name} retravaillé : ${flat(t.effect)}`);
  });
  if (ch.length) cards[c.id] = { kind: score > 0 ? 'buff' : score < 0 ? 'nerf' : 'change', changes: ch };
}

// winrate de chaque carte avant le patch : meilleur deck simulé qui la contient (même calcul que l'appli)
const wrBefore = {};
for (const d of oldWr.decks || []) {
  if (typeof d.wr !== 'number') continue;
  for (const id of d.cards) if (!(id in wrBefore) || d.wr > wrBefore[id]) wrBefore[id] = d.wr;
}

const out = { from: A.version, to: B.version, date: (B.generatedAt || '').slice(0, 10), title: TITLE[B.version] || '', headline: HEADLINE[B.version] || '', rules: RULES[B.version] || [], cards, wrBefore };
fs.writeFileSync(path.join(ROOT, 'src/patch.json'), JSON.stringify(out, null, 1));
const n = Object.keys(cards).length;
const k = t => Object.values(cards).filter(x => x.kind === t).length;
console.log(`Patch ${out.from} → ${out.to} : ${n} cartes modifiées (${k('buff')} renforcées, ${k('nerf')} affaiblies, ${k('change')} retravaillées, ${k('new')} nouvelles)`);
for (const c of B.cards) if (cards[c.id]) console.log(`${cards[c.id].kind.padEnd(6)} ${c.name} : ${cards[c.id].changes.join(' | ')}`);
