/*
 * SPAM Deck Optimizer — moteur de simulation de combat.
 *
 * Modélise une partie SPAM (2 joueurs, 4 cartes chacun) à partir des données officielles
 * du SpamDex (cards.<lang>.json). Tout est déterministe à graine donnée (PRNG mulberry32).
 *
 * Règles implémentées (voir l'onglet « Règles & hypothèses » de l'appli) :
 *  - Dégâts/Soins = base × (1 + 10 % × bonus élémentaire du joueur) × critique × Berserk × (1 - résistance)
 *  - Pas de terrain aléatoire (retiré du jeu) ; l'option opt.terrain le réactive (+5 dans un élément pour les deux joueurs)
 *  - Recharges : le premier joueur démarre à CD-1, le second à CD-2 ; -1 à la fin de chacun de ses tours
 *  - Chaque tour, toutes les compétences disponibles de toutes les cartes vivantes sont lancées
 *  - Talents (1 au choix par carte, débloqués par les doublons), Tox innées, boutique de Tox simplifiée
 *  - SpamDex 1.23 : valeurs des talents lues dans les données, « dégâts bonus » hors bonus élémentaires, Gel sur critique
 *  - SpamDex 1.21 : Gel à 60 dégâts (valeur lue dans les données), Cœur résistance à chaque tour
 *  - SpamDex 1.20 (sortie du jeu) : Gel remplace Étourdissement, Berserk/critiques s'appliquent aux soins,
 *    « Contre » = riposte sur l'attaquant, « Anticipation » = toutes les compétences sur une même cible
 */
(function (root) {
  'use strict';

  const ELS = ['fire', 'water', 'earth', 'nature', 'light', 'shadow'];
  const EI = { fire: 0, water: 1, earth: 2, nature: 3, light: 4, shadow: 5 };
  const FRE = { feu: 0, eau: 1, terre: 2, nature: 3, lumiere: 4, ombre: 5 };
  const RAR_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3, divine: 4 };

  // ---------------------------------------------------------------- aléatoire
  let R = Math.random;
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seed(s) { R = mulberry32(s >>> 0); }
  function rint(a, b) { return a >= b ? a : a + Math.floor(R() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(R() * arr.length)]; }

  function norm(s) {
    return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[’`]/g, "'").replace(/‑/g, '-');
  }

  // ------------------------------------------------------------ compilation
  const DMG = { damage: 1, DamageAll: 1, DamageOpponentHPMAX: 1, DamageCasterHP: 1, DamageWithCardElement: 1 };
  const HEAL = { healTarget: 1, healCaster: 1, healPVmaxTarget: 1, healPVmaxCaster: 1, healCasterWithoutElement: 1 };
  const BONUS = { AddAllPlayerAttack: 1, AddAllPlayerAttackRandomTeam: 1, AddAllPlayerAttackCountActivation1: 1, AddAllPlayerAttackWithCardType: 1, StealElement: 1 };

  // valeurs des Tox par palier (commune, rare, épique, légendaire) — utilisé par Évolution et la boutique
  const TIERV = {
    aoe: [20, 40, 80, 100], vamp: [25, 50, 75, 100], berserk: [12, 25, 40, 60], phoenix: [25, 50, 75, 100],
    cimetiere: [3, 5, 7, 10], coeur: [1, 2, 3, 4], coeurRes: [3, 6, 9, 12], soinPrimitif: [4, 6, 8, 10],
    renvoi: [25, 50, 75, 100], coeurVital: [15, 30, 45, 60], poison: [1, 2, 3, 4], erosion: [50, 75, 100, 100],
    luck: [0.5, 1, 1.5, 2], spamland: [3, 5, 8, 12], contrecoup: [50, 50, 50, 50], sacDeFrappe: [1, 2, 3, 4]
  };
  const MAX_ORDER = 5; // ordres de lancement : 0 bonus, 1 attaque + bonus, 2 attaque, 3 soin, 4 spécial, 5 gel seul
  let GEL_DMG = 40; // dégâts infligés quand la glace se brise : valeur du Tox « Gel » du SpamDex (voir load)

  const SKILL_MAP = {
    'Aoe': ['aoe'], 'Berserk': ['berserk'], 'Brut': ['brut'], 'Chance': ['luck'], 'Cimetiere': ['cimetiere'],
    'CoeurEau': ['coeur', 1], 'CoeurFeu': ['coeur', 0], 'CoeurLumiere': ['coeur', 4], 'CoeurNature': ['coeur', 3],
    'CoeurOmbre': ['coeur', 5], 'CoeurTerre': ['coeur', 2], 'CoeurResistance': ['coeurRes'], 'CoeurVital': ['coeurVital'],
    'ContreCoup': ['contrecoup'], 'Disparition': ['disparition'], 'Erosion': ['erosion'], 'Eternity': ['eternite'],
    'Immunity': ['immunite'], 'Life Steal': ['vamp'], 'Mimetisme': ['mimetisme'], 'Multiplicator': ['multiplicateur'],
    'Mystere': ['mystere'], 'Phoenix': ['phoenix'], 'Poison': ['poison'], 'Primitive heal': ['soinPrimitif'],
    'PunchingBag': ['sacDeFrappe'], 'Reflect': ['renvoi'], 'Reset': ['reset'], 'Revenge': ['revanche'],
    'Smoked': ['fumee'], 'Frozen': ['gel'], 'Stun': ['gel'], 'Taunt': ['provocation'], 'Temporality': ['temporalite'],
    'Tenacite': ['tenacite'], 'Vengeur': ['vengeur']
  };
  const TIER_OF = { C: 0, R: 1, E: 2, L: 3 };

  function compileSkill(s) {
    const m = String(s.id).match(/^(.*?)_([CREL])$/);
    const base = m ? m[1] : s.id;
    const tier = m ? TIER_OF[m[2]] : (RAR_ORDER[s.rarity] || 0);
    const map = SKILL_MAP[base];
    if (!map) return null;
    const p = { k: map[0], tier, v: typeof s.value === 'number' ? s.value : 0, innate: true };
    if (map[0] === 'coeur') p.el = map[1];
    return p;
  }

  function parseCost(txt) {
    const m = txt.match(/\[cout ([^\]]+)\]/);
    if (!m) return null;
    const cost = { el: [0, 0, 0, 0, 0, 0], hp: 0, any: false };
    for (const part of m[1].split('&')) {
      const mm = part.trim().match(/(\d+)\s*([a-z]+)/);
      if (!mm) continue;
      const n = +mm[1];
      if (mm[2] === 'pv') cost.hp = n;
      else if (FRE[mm[2]] !== undefined) { cost.el[FRE[mm[2]]] += n; cost.any = true; }
    }
    return cost;
  }

  function compileAbility(a) {
    const txt = norm(a.effect);
    const ab = {
      name: a.name, effect: a.effect, cd: Math.max(1, a.cooldown || 1), acc: a.precision == null ? 100 : a.precision,
      cc: a.critChance || 0, cm: a.critMultiplier || 2, uses: a.uses || 0, echo: a.cooldownResetChance || 0
    };
    ab.cost = parseCost(txt);
    const acts = (a.actions || []).map(x => ({
      t: x.effect, min: x.min, max: x.max, el: x.element ? (EI[x.element] !== undefined ? EI[x.element] : -1) : -1, ch: x.chain || 0
    })).filter(x => !(x.t === 'damage' && x.max <= 0));

    // cibles
    ab.dmgT = 'enemy';
    if (/cible aleatoirement les cartes du terrain/.test(txt)) ab.dmgT = 'randField';
    else if (/cible toutes les cartes adverses|a toutes les cartes adverses|attaque toutes les cartes adverses|sur toutes les cartes adverses/.test(txt) || acts.some(x => x.t === 'DamageAll')) ab.dmgT = 'all';
    else if (/cible aleatoirement une carte adverse/.test(txt)) ab.dmgT = 'randOne';
    else if (/cible aleatoirement les cartes adverses|ennemis aleatoires/.test(txt)) ab.dmgT = 'randEach';
    ab.allyT = 'chosen';
    if (/cible toutes les cartes du terrain/.test(txt)) ab.allyT = 'field';
    else if (/toutes les cartes alliees/.test(txt)) ab.allyT = 'all';
    else if (/aleatoirement les cartes alliees|carte alliee aleatoire|aleatoirement sur une carte alliee/.test(txt)) ab.allyT = 'randEach';
    ab.selfHeal = /se soigne/.test(txt);

    // choix
    ab.choice = /(^|\/ )choix/.test(txt);
    if (ab.choice) {
      const groups = {};
      for (const x of acts) { if (x.t === '_NULL') continue; (groups[x.ch] = groups[x.ch] || []).push(x); }
      ab.options = Object.keys(groups).sort((p, q) => p - q).map(k => groups[k]);
      ab.acts = null;
    } else {
      ab.acts = acts.filter(x => x.t !== '_NULL');
      ab.options = null;
    }

    // drapeaux textuels
    // Gel (ex-Étourdissement) : par option pour les compétences « Choix »
    const hasGel = s => /(^|\n|\/ )(applique )?(gel|etourdissement)\s*($|\n)/.test(s);
    ab.gel = hasGel(txt);
    ab.gelCrit = /gel en cas de (coup )?critique/.test(txt);
    ab.optGel = ab.choice ? txt.split(/-{3,}\s*ou\s*-{3,}/).map(hasGel) : null;
    ab.eterText = /applique eternite/.test(txt) && !acts.some(x => x.t === 'AddCooldown');
    ab.vamp = /vampirisme/.test(txt) ? 25 : 0;
    ab.smoke = /fumee/.test(txt);
    ab.aoe = /(^|\/ )aoe\b/.test(txt) ? 20 : 0;
    ab.disp = /applique disparition/.test(txt);
    // « Applique Éternité en cas de critique » : seule l'Éternité dépend du critique, le reste s'applique toujours
    ab.critEter = /eternite en cas de (coup )?critique/.test(txt) && acts.some(x => x.t !== 'AddCooldown' && !DMG[x.t] && !HEAL[x.t]);
    ab.onCrit = /en cas de (coup )?critique/.test(txt) && !ab.critEter;
    ab.breakTaunt = /brise une provocation/.test(txt);
    ab.taunt = 0; ab.tauntRandAlly = false;
    if (/provocation/.test(txt) && !ab.breakTaunt) {
      ab.tauntRandAlly = /aleatoirement a une carte alliee/.test(txt);
      ab.taunt = /pendant 2 tours/.test(txt) ? 2 : 1;
    }
    ab.absorbAlly = /absorbe une carte alliee/.test(txt);
    ab.cdAll = /cible toutes les cartes adverses/.test(txt);

    const all = ab.choice ? [].concat(...ab.options) : ab.acts;
    ab.hasDmg = all.some(x => DMG[x.t]) || all.some(x => x.t === 'destroy' && !ab.absorbAlly);
    ab.hasBonus = all.some(x => BONUS[x.t]);
    ab.hasHeal = all.some(x => HEAL[x.t]);
    ab.special = all.some(x => x.t === 'destroy' || x.t === 'SetHPInPercent' || x.t === 'Resurection' || x.t === 'ChangeElementTargetRandom' || (x.t === 'AddOppHPMax' && x.min < 0));
    ab.order = ab.special ? 4 : ab.hasDmg ? (ab.hasBonus ? 1 : 2) : ab.hasHeal ? 3 : 0;
    if (ab.gel && !ab.hasDmg && !ab.hasHeal) ab.order = 5; // geler en dernier : les attaques suivantes briseraient la glace

    // estimation statique (menace / heuristiques)
    let dmg = 0, heal = 0, bonus = 0;
    const tf = ab.dmgT === 'all' ? 3 : ab.dmgT === 'randField' ? 0.25 : 1;
    const opts = ab.choice ? ab.options : [ab.acts];
    let best = 0;
    for (const o of opts) {
      let d = 0, h = 0, b = 0;
      for (const x of o) {
        const avg = (x.min + x.max) / 2;
        if (x.t === 'damage' || x.t === 'DamageAll' || x.t === 'DamageWithCardElement') d += avg * tf;
        else if (x.t === 'DamageOpponentHPMAX') d += avg / 100 * 800;
        else if (x.t === 'DamageCasterHP') d += (avg + 75) * 3;
        else if (x.t === 'destroy' && !ab.absorbAlly) d += 700;
        else if (x.t === 'healTarget' || x.t === 'healCaster') h += avg * (ab.allyT === 'all' ? 3 : 1);
        else if (x.t === 'healPVmaxTarget' || x.t === 'healPVmaxCaster') h += avg / 100 * 600;
        else if (BONUS[x.t]) b += x.t === 'AddAllPlayerAttackCountActivation1' ? avg + 3 : Math.abs(avg) * (x.el < 0 && x.t === 'AddAllPlayerAttack' ? 6 : 1);
      }
      const v = d + h * 0.5 + b * 12;
      if (v >= best) { best = v; dmg = d; heal = h; bonus = b; }
    }
    const critF = 1 + Math.min(100, ab.cc) / 100 * (ab.cm - 1);
    const echoF = 1 / (1 - Math.min(0.9, ab.echo / 100));
    let useF = ab.uses ? Math.min(1, ab.uses * ab.cd / 10) : 1;
    if (ab.cost && ab.cost.any) useF /= Math.max(1, ab.cost.el.reduce((s, x) => s + x, 0) / 3);
    if (ab.cost && ab.cost.hp) useF *= 0.7;
    ab.pDmg = dmg * (ab.acc / 100) * critF * echoF * useF / ab.cd;
    ab.pHeal = heal * (ab.acc / 100) * echoF * useF / ab.cd;
    ab.pBonus = bonus * (ab.acc / 100) * echoF * useF / ab.cd;
    return ab;
  }

  function compileTalent(t) {
    // vals : valeur (absolue) de chaque type d'action du talent, pour suivre les rééquilibrages sans toucher au code
    const vals = {};
    for (const x of t.actions || []) if (vals[x.effect] == null && typeof x.min === 'number') vals[x.effect] = Math.abs(x.min);
    return { slot: t.slot, id: t.id, name: t.name, effect: t.effect, vals };
  }
  // valeur d'un talent (action « eff » dans les données), sinon la valeur connue « d »
  function tv(c, eff, d) { const v = c.tal && c.tal.vals ? c.tal.vals[eff] : null; return v ? v : d; }

  function compileCard(c, idx) {
    const def = {
      idx, id: c.id, slug: c.slug, num: c.number, name: c.name,
      el: EI[c.element] !== undefined ? EI[c.element] : -1, element: c.element, rar: c.rarity,
      hp: c.hp, gen: c.spamton, res: ELS.map(e => (c.resistances && c.resistances[e]) || 0),
      art: c.artwork ? c.artwork.small : null, tiny: c.artwork ? c.artwork.tiny : null,
      abilities: (c.abilities || []).map(compileAbility),
      skills: (c.skills || []).map(compileSkill).filter(Boolean),
      talents: (c.talents || []).slice().sort((a, b) => a.slot - b.slot).map(compileTalent)
    };
    def.pDmg = def.abilities.reduce((s, a) => s + a.pDmg, 0);
    def.pHeal = def.abilities.reduce((s, a) => s + a.pHeal, 0);
    def.pBonus = def.abilities.reduce((s, a) => s + a.pBonus, 0);
    def.power = def.pDmg + def.pHeal * 0.4 + def.pBonus * 6 + 5;
    // profil élémentaire offensif (dégâts de base moyens par tour, par élément)
    def.elDmg = [0, 0, 0, 0, 0, 0];
    for (const a of def.abilities) {
      const opts = a.choice ? a.options : [a.acts];
      const o = opts[0];
      for (const x of o) {
        if (x.t === 'damage' || x.t === 'DamageAll' || x.t === 'DamageWithCardElement' || x.t === 'DamageCasterHP' || x.t === 'healTarget' || x.t === 'healCaster') {
          let e = x.el;
          if (x.t === 'DamageWithCardElement') e = def.el;
          const w = ((x.min + x.max) / 2) * (a.dmgT === 'all' ? 3 : 1) / a.cd * (HEAL[x.t] ? 0.4 : 1);
          if (e >= 0) def.elDmg[e] += w; else for (let i = 0; i < 6; i++) def.elDmg[i] += w / 6;
        }
      }
    }
    return def;
  }

  // ------------------------------------------------------------- base de données
  const DB = { cards: [], byId: {}, byRar: {}, version: '', raw: null };

  function load(json) {
    DB.raw = json;
    DB.version = json.version;
    // valeur du Gel (Tox Frozen_*) : la même pour les compétences qui gèlent
    const gelV = [].concat(...json.cards.map(c => (c.skills || []).filter(x => /^Frozen/.test(x.id)).map(x => x.value))).filter(v => v > 0);
    GEL_DMG = gelV.length ? Math.max.apply(null, gelV) : 40;
    DB.cards = json.cards.map(compileCard);
    DB.byId = {}; DB.byRar = {};
    for (const d of DB.cards) {
      DB.byId[d.id] = d;
      (DB.byRar[d.rar] = DB.byRar[d.rar] || []).push(d);
    }
    return DB;
  }

  // ------------------------------------------------------------- état de jeu
  // Passifs actifs d'une carte, regroupés par type. Objets de forme fixe (tous les champs déclarés d'avance) :
  // le moteur JavaScript accède alors aux champs bien plus vite qu'avec des objets aux clés variables.
  // champs écrits en toutes lettres (et non en boucle) : c'est ce qui donne une forme fixe à ces objets
  function PF() {
    this.aoe = null; this.berserk = null; this.bomba = null; this.brut = null; this.cimetiere = null; this.coeur = null;
    this.coeurRes = null; this.coeurVital = null; this.contrecoup = null; this.disparition = null; this.erosion = null;
    this.eternite = null; this.fumee = null; this.gel = null; this.immunite = null; this.inversement = null; this.luck = null;
    this.mimetisme = null; this.multiplicateur = null; this.mystere = null; this.phoenix = null; this.poison = null;
    this.provocation = null; this.renvoi = null; this.reset = null; this.revanche = null; this.sacDeFrappe = null; this.soinPrimitif = null;
    this.spamland = null; this.temporalite = null; this.tenacite = null; this.vamp = null; this.vengeur = null;
  }
  // drapeaux de talent, eux aussi de forme fixe
  function H() {
    this.affaiblissement = 0; this.armureAmes = 0; this.bombe8 = 0; this.bouleCrit = 0; this.chanceVitale = 0; this.coeurAcier = 0;
    this.contre = 0; this.corrosion = 0; this.dernierSouffle = 0; this.erreur = 0; this.evolution = 0; this.focus = 0; this.fortune = 0;
    this.heritage = 0; this.heureFuneste = 0; this.immu8 = 0; this.incisif = 0; this.insDisp = 0; this.insEter = 0; this.life8 = 0;
    this.longueur = 0; this.mois13 = 0; this.multicolor = 0; this.oneManArmy = 0; this.plume = 0; this.racket = 0; this.reducteur = 0;
    this.resetUltime = 0; this.resilience = 0; this.revitalisation = 0; this.souffle8 = 0; this.sursaut = 0; this.transition = 0;
    this.transitionUsed = 0; this.virage = 0; this.vitalite = 0;
  }
  function refreshPF(c) {
    const pf = new PF();
    for (const p of c.passives) {
      if (!pf[p.k]) pf[p.k] = [];
      pf[p.k].push(p);
    }
    c.pf = pf;
  }
  function pval(c, k) { // somme des valeurs d'un passif (selon palier)
    const arr = c.pf[k];
    if (!arr) return 0;
    let s = 0;
    for (const p of arr) s += TIERV[k] ? TIERV[k][Math.min(3, p.tier)] : (p.v || 1);
    return s;
  }
  function has(c, k) { return !!c.pf[k]; }

  function makeCard(def, talentSlot, pos, owner) {
    const c = {
      def, pos, owner, alive: true, hp: def.hp, maxHp: def.hp, res: def.res.slice(), el: def.el,
      critAdd: 0, cmAdd: 0, accAdd: 0, baseAdd: 0, gen: def.gen, gel: 0, gelBy: -1, taunt: 0, poison: 0, poisonPct: 0,
      abil: def.abilities.map(a => ({ a, cd: 0, uses: a.uses || 0, base: 0, n: 0, off: false })),
      passives: def.skills.map(p => Object.assign({}, p)), pf: null, echoAdd: 0,
      tal: null, h: new H(), resDone: false, evo: 0, contreUsed: false, dmgDealt: 0, dmgTaken: 0, healDone: 0, bonusGen: 0,
      abDmg: 0, allyHeal: 0 // rôles : dégâts de ses propres compétences, soins donnés par ses compétences de soin
    };
    if (talentSlot > 0 && def.talents[talentSlot - 1]) c.tal = def.talents[talentSlot - 1];
    refreshPF(c);
    return c;
  }

  function makePlayer(side, deck) {
    const P = {
      side, cards: [], bonus: [0, 0, 0, 0, 0, 0], spam: 0, luck: 0, turn: 0, dead: [], smoke: 0,
      got13: false, petitPrix: false, toxChanceux: false, dmgDone: 0, healDone: 0, bonusGen: 0, bought: []
    };
    deck.forEach((d, i) => {
      const def = typeof d.card === 'object' ? d.card : DB.cards[d.card];
      P.cards.push(makeCard(def, d.talent || 0, i, side));
    });
    return P;
  }

  function alive(P) { const r = []; for (const c of P.cards) if (c.alive) r.push(c); return r; }
  function berserkOf(P) { let s = 0; for (const c of P.cards) if (c.alive && c.pf.berserk) s += pval(c, 'berserk'); return s; }
  function bonusOf(G, P, e) { return e < 0 ? 0 : P.bonus[e] + (G.terrain === e ? 5 : 0); }
  function mult(G, P, c, e) {
    let b = bonusOf(G, P, e);
    if (c.pf.multiplicateur) b *= 2;
    const m = 1 + 0.1 * b;
    return m < 0 ? 0 : m;
  }

  function addBonus(G, P, e, v) {
    if (e < 0 || !v) return;
    P.bonus[e] += v;
    if (v > 0) {
      P.bonusGen += v;
      const O = G.P[1 - P.side];
      for (const c of O.cards) if (c.alive && c.pf.mimetisme) O.bonus[e] += c.pf.mimetisme.length;
    }
  }

  function modCd(c, v) {
    if (v > 0 && (c.h.insEter || has(c, 'immunite'))) return;
    for (const s of c.abil) s.cd = Math.max(0, s.cd + v);
  }

  // ----------------------------------------------------------- métamorphose
  function metamorph(G, c, hpMode, extraHp) {
    const pool = DB.byRar[c.def.rar] || DB.cards;
    const def = pick(pool);
    const ratio = c.maxHp > 0 ? c.hp / c.maxHp : 1;
    const n = makeCard(def, 0, c.pos, c.owner);
    n.maxHp = def.hp + (extraHp || 0);
    n.hp = hpMode === 'full' ? n.maxHp : Math.max(1, Math.round(n.maxHp * ratio));
    const P = G.P[c.owner];
    // les recharges repartent comme en début de partie
    for (const s of n.abil) s.cd = Math.max(0, s.a.cd - 1);
    P.cards[c.pos] = n;
    applyStaticTalent(G, P, n);
    return n;
  }

  // --------------------------------------------------------------- dégâts
  function heal(c, amt) {
    if (!c.alive || amt <= 0) return 0;
    const before = c.hp;
    c.hp = Math.min(c.maxHp, c.hp + amt);
    checkThresholds(null, c);
    return c.hp - before;
  }

  // Gel : la cible ne peut pas agir jusqu'à la fin de son prochain tour ;
  // un dégât ou un soin d'une autre compétence, ou un nouveau Tox, brise la glace (+40 dégâts).
  function freeze(G, e) {
    if (!e || !e.alive || has(e, 'immunite')) return;
    e.gel = 1; e.gelBy = G.castId;
    if (G.opt.log) G.log.push({ t: 'gel', side: e.owner, text: `${e.def.name} est gelée` });
  }
  function breakIce(G, e) {
    if (!e.gel) return;
    e.gel = 0;
    if (G.opt.log) G.log.push({ t: 'gel', side: e.owner, text: `La glace de ${e.def.name} se brise (−${GEL_DMG})` });
    damage(G, null, e, GEL_DMG, -1, { raw: true, noHooks: true });
  }

  // Résilience et Évolution suivent les PV dans les deux sens (« tant que », « selon ses PV »)
  function checkThresholds(G, c) {
    if (!c.alive) return;
    if (c.h.resilience) {
      const low = c.hp < c.maxHp * 0.5;
      if (low !== c.resDone) {
        c.resDone = low;
        for (let i = 0; i < 6; i++) c.res[i] += low ? c.h.resilience : -c.h.resilience;
      }
    }
    if (c.h.evolution) {
      const r = c.hp / c.maxHp;
      const lvl = r <= 0.25 ? 3 : r <= 0.5 ? 2 : r <= 0.75 ? 1 : 0;
      if (lvl !== c.evo) {
        c.evo = lvl;
        for (const p of c.passives) {
          if (p.shop) continue;
          if (p.t0 == null) p.t0 = p.tier;
          p.tier = Math.min(3, p.t0 + lvl);
        }
      }
    }
  }

  // inflige des dégâts ; renvoie les dégâts réellement infligés
  function damage(G, src, tgt, amount, el, o) {
    if (!tgt.alive || amount <= 0) return 0;
    const brut = o && o.brut;
    if (el >= 0 && !brut && !(o && o.raw)) {
      let r = tgt.res[el];
      if (r > 90) r = 90; else if (r < -100) r = -100;
      amount *= (1 - r / 100);
    }
    if (amount <= 0) return 0;
    const attack = !(o && o.noHooks);
    if (attack && src && tgt.gel && tgt.gelBy !== G.castId) {
      tgt.gel = 0; amount += GEL_DMG;
      if (G.opt.log) G.log.push({ t: 'gel', side: tgt.owner, text: `La glace de ${tgt.def.name} se brise (−${GEL_DMG})` });
    }
    if (attack && tgt.h.chanceVitale && R() < 0.1) { heal(tgt, amount); return 0; }
    tgt.hp -= amount;
    tgt.dmgTaken += amount;
    const P = G.P[tgt.owner];
    if (src && src.owner !== tgt.owner) {
      G.P[src.owner].dmgDone += amount;
      src.dmgDealt += amount;
      if (src === G.casting) src.abDmg += amount; // hors Renvoi, Bomba, Revanche…
    }
    if (attack && src && src.owner !== tgt.owner) {
      if (tgt.pf.sacDeFrappe && tgt.el >= 0) { const b0 = P.bonusGen; addBonus(G, P, tgt.el, pval(tgt, 'sacDeFrappe')); tgt.bonusGen += P.bonusGen - b0; }
      if (tgt.h.coeurAcier) for (let i = 0; i < 6; i++) tgt.res[i] += 1;
      if (tgt.h.corrosion && src.alive && !has(src, 'immunite')) for (let i = 0; i < 6; i++) src.res[i] -= 1;
      if (tgt.pf.renvoi && src.alive) damage(G, tgt, src, amount * pval(tgt, 'renvoi') / 100, -1, { raw: true, noHooks: true });
    }
    if (tgt.hp <= 0) {
      if (tgt.pf.tenacite) {
        tgt.passives.splice(tgt.passives.indexOf(tgt.pf.tenacite[0]), 1); refreshPF(tgt);
        tgt.hp = 1;
      } else {
        kill(G, tgt, src);
      }
    } else {
      checkThresholds(G, tgt);
      // talent « Contre » : une fois par partie, sous 25 % de PV, la carte riposte sur son attaquant
      if (tgt.h.contre && !tgt.contreUsed && tgt.hp < tgt.maxHp * 0.25 && src && src.alive && src.owner !== tgt.owner) {
        tgt.contreUsed = true;
        unleashAll(G, tgt, src);
      }
    }
    return amount;
  }

  function kill(G, c, killer) {
    if (!c.alive) return;
    const P = G.P[c.owner], O = G.P[1 - c.owner];
    c.hp = 0;
    // Phénix
    if (c.pf.phoenix) {
      const p = c.pf.phoenix[0];
      const pct = TIERV.phoenix[Math.min(3, p.tier)];
      if (!(c.h.plume && R() < 0.5)) { c.passives.splice(c.passives.indexOf(p), 1); refreshPF(c); }
      c.hp = Math.max(1, c.maxHp * pct / 100);
      return;
    }
    // Transition : revient sous forme d'une carte aléatoire de même rareté
    if (c.h.transition && !c.h.transitionUsed) {
      c.h.transitionUsed = true;
      const n = metamorph(G, c, 'full', 0);
      n.h.transitionUsed = true;
      return;
    }
    c.alive = false;
    P.dead.push(c);
    G.deaths++;
    if (G.opt.log) G.log.push({ t: 'death', side: c.owner, text: `${c.def.name} est détruite` + (killer ? ` par ${killer.def.name}` : '') });
    if (killer && killer.owner !== c.owner) G.lastKiller = killer;
    // déclencheurs de la carte détruite
    if (c.pf.revanche) unleash(G, c, null);
    if (c.pf.bomba) { const t = alive(O); if (t.length) damage(G, c, pick(t), 500, -1, { raw: true, brut: true }); }
    if (c.h.heritage) P.spam = Math.min(250, P.spam + c.h.heritage);
    if (c.h.heureFuneste) for (const e of O.cards) if (e.alive) modCd(e, 1);
    if (c.h.dernierSouffle) for (const e of P.cards) if (e.alive) modCd(e, -1);
    if (c.h.virage) for (const e of P.cards) if (e.alive && e !== c) metamorph(G, e, 'ratio', 0);
    // déclencheurs globaux
    for (const S of G.P) {
      for (const e of S.cards) {
        if (!e.alive) continue;
        if (e.h.vitalite) { e.maxHp += e.h.vitalite; e.hp += e.h.vitalite; }
        if (e.h.armureAmes) for (let i = 0; i < 6; i++) e.res[i] += e.h.armureAmes;
        if (e.h.oneManArmy) e.baseAdd += e.h.oneManArmy;
        if (e.pf.cimetiere) { const v = pval(e, 'cimetiere'); for (let i = 0; i < 6; i++) S.bonus[i] += v; }
        if (e.pf.vengeur && e !== killer) for (const s of e.abil) s.cd = 0;
      }
    }
    if (killer && killer.alive && killer.owner !== c.owner && killer.h.resetUltime) killer.hp = killer.maxHp;
    if (!alive(P).length) { G.over = true; G.winner = 1 - c.owner; }
  }

  // Anticipation / Contre : la carte lance toutes ses compétences, sans coût ni recharge ;
  // les compétences à cible unique visent « fixed »
  function unleashAll(G, c, fixed) {
    const P = G.P[c.owner], O = G.P[1 - c.owner];
    const list = c.abil.filter(s => !s.off && !(s.a.uses && s.uses <= 0)).sort((x, y) => x.a.order - y.a.order);
    if (G.opt.log) G.log.push({ t: 'info', side: c.owner, text: `${c.def.name} lance toutes ses compétences` + (fixed ? ` sur ${fixed.def.name}` : '') });
    for (const s of list) {
      if (G.over || !c.alive) return;
      const before = G.opt.log ? snap(G) : null;
      G.lastMiss = false;
      if (cast(G, P, O, c, s, { target: fixed }) && before) logCast(G, c.owner, c, s, before);
    }
  }

  // Revanche (Tox) : une fois détruite, la carte inflige toutes ses attaques
  function unleash(G, c, fixed) {
    const P = G.P[c.owner], O = G.P[1 - c.owner];
    for (const s of c.abil) {
      if (s.off || !s.a.hasDmg) continue;
      const acts = s.a.choice ? s.a.options[0] : s.a.acts;
      for (const x of acts) {
        if (!(x.t === 'damage' || x.t === 'DamageAll' || x.t === 'DamageWithCardElement')) continue;
        const targets = s.a.dmgT === 'all' ? alive(O) : [(fixed && fixed.alive) ? fixed : pick(alive(O) || [])];
        for (const t of targets) {
          if (!t || !t.alive) continue;
          let el = x.el; if (x.t === 'DamageWithCardElement') el = c.el; if (el < 0) el = rint(0, 5);
          let amt = (rint(x.min, x.max) + s.base + c.baseAdd) * mult(G, P, c, el);
          if (R() * 100 < s.a.cc + c.critAdd) amt *= (s.a.cm + c.cmAdd);
          amt *= 1 + berserkOf(P) / 100;
          damage(G, c, t, amt, el, { brut: has(c, 'brut') });
          if (G.over) return;
        }
      }
    }
  }

  // -------------------------------------------------------------- ciblage IA
  function estDmg(G, P, c, s, acts, t, bersF) {
    let d = 0;
    for (const x of acts) {
      if (x.t === 'damage' || x.t === 'DamageAll' || x.t === 'DamageWithCardElement') {
        let el = x.el; if (x.t === 'DamageWithCardElement') el = c.el;
        const m = el >= 0 ? mult(G, P, c, el) : 1 + 0.1 * avgBonus(G, P);
        const r = el >= 0 && !has(c, 'brut') ? Math.max(-100, Math.min(90, t.res[el])) : 10;
        d += ((x.min + x.max) / 2 + s.base + c.baseAdd) * m * (1 - r / 100);
      } else if (x.t === 'DamageOpponentHPMAX') d += t.maxHp * x.min / 100;
      else if (x.t === 'DamageCasterHP') d += x.min * mult(G, P, c, x.el >= 0 ? x.el : 5) + (c.maxHp - c.hp) * 0.5;
    }
    const acc = Math.max(0, Math.min(100, s.a.acc + c.accAdd)) / 100;
    const cf = 1 + Math.min(1, (s.a.cc + c.critAdd) / 100) * (s.a.cm + c.cmAdd - 1);
    return d * acc * cf * (bersF != null ? bersF : 1 + berserkOf(P) / 100);
  }
  function avgBonus(G, P) { let s = 0; for (let i = 0; i < 6; i++) s += bonusOf(G, P, i); return s / 6; }
  function threat(c) { return c.def.power + c.baseAdd * 2 + c.critAdd * 0.3; }

  function chooseEnemy(G, P, O, c, s, acts) {
    // candidats : cartes adverses vivantes ; seulement celles qui provoquent s'il y en a (sauf Brut)
    let taunt = false;
    if (!has(c, 'brut')) for (const e of O.cards) if (e.alive && e.taunt > 0) { taunt = true; break; }
    let n = 0, only = null;
    for (const e of O.cards) if (e.alive && (!taunt || e.taunt > 0)) { n++; only = e; }
    if (!n) return null;
    if (n === 1) return only;
    const bf = 1 + berserkOf(P) / 100;
    let best = null, bs = -Infinity;
    for (const t of O.cards) {
      if (!t.alive || (taunt && !(t.taunt > 0))) continue;
      const ice = t.gel && t.gelBy !== G.castId; // frapper une carte gelée la libère (+40 dégâts)
      const e = estDmg(G, P, c, s, acts, t, bf) + (ice ? GEL_DMG : 0);
      let sc;
      if (e >= t.hp) sc = 1e6 + threat(t) * 10 - t.hp * 0.01;
      else sc = threat(t) / Math.max(1, t.hp - e) * 1000 * (ice ? 0.35 : 1) + e * 0.01;
      if (sc > bs) { bs = sc; best = t; }
    }
    return best;
  }
  function bestAttacker(P, excl) {
    let best = null, bs = -1;
    for (const c of P.cards) if (c.alive && c !== excl && !c.gel) { const t = threat(c); if (t > bs) { bs = t; best = c; } }
    return best || (excl && excl.alive ? excl : null);
  }
  function mostWounded(P) {
    let best = null, bs = -Infinity;
    for (const c of P.cards) if (c.alive) { const m = c.maxHp - c.hp - (c.gel ? 3 * GEL_DMG : 0); if (m > bs) { bs = m; best = c; } }
    return best;
  }
  function randAlive(P) { const a = alive(P); return a.length ? pick(a) : null; }
  function randField(G) { const a = alive(G.P[0]).concat(alive(G.P[1])); return a.length ? pick(a) : null; }
  function adjacent(P, t) {
    const r = [];
    for (let i = t.pos - 1; i >= 0; i--) if (P.cards[i].alive) { r.push(P.cards[i]); break; }
    for (let i = t.pos + 1; i < P.cards.length; i++) if (P.cards[i].alive) { r.push(P.cards[i]); break; }
    return r;
  }

  // valeur d'une option (pour les compétences « Choix »)
  function optionValue(G, P, O, c, s, acts, gel) {
    let v = 0;
    const t = chooseEnemy(G, P, O, c, s, acts);
    if (t) v += estDmg(G, P, c, s, acts, t) * (s.a.dmgT === 'all' ? alive(O).length : 1);
    if (t && !has(t, 'immunite')) {
      if (gel) v += t.def.pDmg * 0.8;                                            // un tour adverse perdu
      if (acts.some(x => x.t === 'AddCooldown' && x.min > 0)) v += t.def.pDmg * 0.6; // Éternité
    }
    const prof = G.prof[P.side];
    const horizon = Math.max(2, 8 - P.turn * 0.4);
    for (const x of acts) {
      if (x.t === 'AddAllPlayerAttack') v += (x.min + x.max) / 2 * 0.1 * (x.el >= 0 ? prof[x.el] : 0) * horizon;
      else if (x.t === 'AddOppCardMiss' && x.min < 0) { const b = bestAttacker(P); if (b) v += Math.min(-x.min, Math.max(0, 100 - b.accAdd - 60)) / 100 * b.def.pDmg * horizon; }
      else if (x.t === 'AddOppCardCriticChance') { const b = bestAttacker(P); if (b) v += x.min / 100 * b.def.pDmg * horizon; }
    }
    return v;
  }

  // ------------------------------------------------------------ lancer un sort
  function canPay(P, c, cost) {
    if (!cost) return true;
    if (cost.hp && c.hp <= cost.hp + c.maxHp * 0.15) return false;
    for (let i = 0; i < 6; i++) if (cost.el[i] && P.bonus[i] < cost.el[i]) return false;
    return true;
  }

  // caractéristiques d'une liste d'actions (une option de compétence), calculées une fois et gardées sur la liste
  function actFlags(acts) {
    if (acts._f) return acts._f;
    const hasT = t => acts.some(x => x.t === t);
    return (acts._f = {
      chgEl: hasT('ChangeElementTargetRandom'),
      hpMaxNeg: acts.some(x => x.t === 'AddOppHPMax' && x.min < 0),
      healPVmaxT: hasT('healPVmaxTarget'),
      gives: hasT('AddAllPlayerAttack'),
      setHP: acts.find(y => y.t === 'SetHPInPercent') || null,
      resur: hasT('Resurection'),
      remTaunt: hasT('RemoveTauntRunning'),
      dmgOrHeal: acts.some(x => DMG[x.t] || HEAL[x.t]),
      anyDmg: acts.some(x => DMG[x.t]),
      needHeal: acts.some(x => x.t === 'healTarget' || (x.t === 'AddOppCardResistance' && x.min >= 0)),
      needBuff: acts.some(x => x.t === 'AddOppCardBaseDamage' || x.t === 'AddOppCardCriticChance' || x.t === 'AddOppCardMiss' || x.t === 'AddOppCardCriticRatio'),
      needEnemy: acts.some(x => DMG[x.t] || x.t === 'destroy' || x.t === 'ResetCooldownTarget' || (x.t === 'AddCooldown' && x.min > 0) || (x.t === 'AddOppCardResistance' && x.min < 0) || (x.t === 'AddOppCardMiss' && x.min > 0))
    });
  }

  // force = { target } : lancement gratuit (Anticipation, Contre) — pas de coût, recharge inchangée.
  // Chaque lancement a son identifiant (le Gel n'est brisé que par une autre compétence) ; une riposte
  // déclenchée au milieu d'un lancement ne doit pas changer l'identifiant du lancement en cours.
  function cast(G, P, O, c, s, force) {
    const prev = G.castId, prevC = G.casting;
    G.castId = ++G.castSeq; G.casting = c;
    try { return castInner(G, P, O, c, s, force); } finally { G.castId = prev; G.casting = prevC; }
  }
  function castInner(G, P, O, c, s, force) {
    const a = s.a;
    let acts = a.acts, gel = a.gel;
    if (a.choice) {
      let bv = -Infinity, bi = 0;
      a.options.forEach((o, i) => { const v = optionValue(G, P, O, c, s, o, a.optGel && a.optGel[i]); if (v > bv) { bv = v; acts = o; bi = i; } });
      if (a.optGel && a.optGel.length === a.options.length) gel = a.optGel[bi];
    }
    // décisions IA spéciales (caractéristiques de la liste d'actions calculées une fois puis gardées en cache)
    const F = actFlags(acts);
    if (F.chgEl && c.el >= 0) return false;
    if (a.absorbAlly) {
      const w = P.cards.filter(e => e.alive && e !== c && e.hp < e.maxHp * 0.2);
      if (!w.length) return false;
    }
    if (F.hpMaxNeg) {
      if (c.maxHp - c.hp < 100 || !P.cards.some(e => e.alive && e !== c && e.maxHp > 450)) return false;
    }
    if (a.cost && !force) {
      if (!canPay(P, c, a.cost)) return false;
      if (F.healPVmaxT && c.hp > c.maxHp * 0.45) return false;
      if (a.cost.any && !F.gives && !F.healPVmaxT) {
        for (let i = 0; i < 6; i++) if (a.cost.el[i] && P.bonus[i] < a.cost.el[i] * 3 && a.cost.el[i] > 2) return false;
      }
    }
    if (F.setHP) {
      const x = F.setHP;
      const cands = alive(O).filter(e => !has(e, 'immunite') && e.hp > e.maxHp * x.min / 100 + 60);
      if (!cands.length) return false;
    }
    if (F.resur && !P.dead.length) return false;
    if (F.remTaunt && !P.cards.some(e => e.alive && e.taunt > 0)) {
      if (!F.dmgOrHeal) return false;
    }

    // paiement
    if (a.cost && !force) {
      if (a.cost.hp) c.hp -= a.cost.hp;
      for (let i = 0; i < 6; i++) if (a.cost.el[i]) P.bonus[i] -= a.cost.el[i];
    }
    s.n++;
    if (s.uses && !force) s.uses--;

    // précision : un seul jet par lancement, qui conditionne toute la compétence
    if (R() * 100 >= a.acc + c.accAdd) {
      if (!force) s.cd = c.pf.temporalite ? Math.max(1, a.cd - 1) : a.cd;
      G.P[c.owner].misses = (G.P[c.owner].misses || 0) + 1;
      G.lastMiss = true;
      return true;
    }

    const brut = has(c, 'brut');
    const bers = 1 + berserkOf(P) / 100;
    const inv = has(c, 'inversement');
    const fixed = force && force.target && force.target.alive && force.target.owner !== c.owner ? force.target : null;
    let primary = null, randOne = null;
    const needEnemy = F.needEnemy;
    if (needEnemy || gel) primary = fixed || chooseEnemy(G, P, O, c, s, acts);
    if (a.dmgT === 'randOne') randOne = fixed || randAlive(O);
    let lastCrit = false;
    const healAlly = F.needHeal ? (mostWounded(P) || c) : c;
    const buffAlly = F.needBuff ? (bestAttacker(P) || c) : c;

    const chainT = {};
    const hitList = [];      // cibles ennemies touchées
    const critCh = [];       // critique par chaîne (pour les effets « en cas de coup critique »)
    let killed = false;
    let lastHeal = null;

    const enemyTargets = (x) => {
      if (a.dmgT === 'all') return alive(O);
      if (a.dmgT === 'randOne') return randOne ? [randOne] : [];
      if (a.dmgT === 'randEach' || a.dmgT === 'randField') {
        const k = x.ch;
        if (!chainT[k] || !chainT[k].alive) chainT[k] = a.dmgT === 'randField' ? randField(G) : randAlive(O);
        return chainT[k] ? [chainT[k]] : [];
      }
      return primary && primary.alive ? [primary] : (primary ? [chooseEnemy(G, P, O, c, s, acts)].filter(Boolean) : []);
    };
    const allyTargets = (x) => {
      if (a.selfHeal) return [c];
      if (a.allyT === 'all') return alive(P);
      if (a.allyT === 'field') return alive(P).concat(alive(O));
      if (a.allyT === 'randEach') { const k = 'a' + x.ch; if (!chainT[k] || !chainT[k].alive) chainT[k] = randAlive(P); return chainT[k] ? [chainT[k]] : []; }
      return [healAlly];
    };

    for (const x of acts) {
      if (G.over) break;
      const t = x.t;
      if (a.onCrit && !DMG[t] && !HEAL[t] && !critCh[x.ch]) continue;
      if (a.critEter && t === 'AddCooldown' && !lastCrit) continue;
      if (t === 'damage' || t === 'DamageAll' || t === 'DamageWithCardElement' || t === 'DamageCasterHP') {
        let el = x.el;
        if (t === 'DamageWithCardElement') el = c.el;
        if (el < 0) el = t === 'DamageCasterHP' ? 5 : rint(0, 5);
        const tg = enemyTargets(x);
        for (const tt of tg) {
          if (!tt || !tt.alive) continue;
          // Fumée : le camp enfumé esquive 25 % des attaques
          if (tt.owner !== c.owner && G.P[tt.owner].smoke > 0 && R() < 0.25) { critCh[x.ch] = false; continue; }
          const base = rint(x.min, x.max) + s.base + c.baseAdd;
          // « dégâts bonus » (1.23) : 50 % des PV manquants, sans bonus élémentaire, mais avec Berserk et résistances
          const extra = t === 'DamageCasterHP' ? (c.maxHp - c.hp) * 0.5 : 0;
          let amt = (base * mult(G, P, c, el) + extra) * bers;
          const cr = R() * 100 < a.cc + c.critAdd;
          critCh[x.ch] = cr; lastCrit = cr;
          if (cr) amt *= (a.cm + c.cmAdd);
          if (inv) { const h = mostWounded(P); if (h) { const hh = heal(h, amt); P.healDone += hh; c.allyHeal += hh; } continue; }
          const dealt = damage(G, c, tt, amt, el, { brut });
          if (tt.owner !== c.owner) hitList.push(tt);
          if (a.gelCrit && cr && tt.owner !== c.owner) freeze(G, tt);
          if (!tt.alive) killed = true;
          afterHit(G, P, c, a, tt, dealt, el, brut);
          if (G.over) break;
        }
      } else if (t === 'DamageOpponentHPMAX') {
        const tt = primary;
        if (tt && tt.alive) {
          damage(G, c, tt, (tt.dummy ? 800 : tt.maxHp) * x.min / 100, x.el, { brut });
          hitList.push(tt);
          if (!tt.alive) killed = true;
        }
      } else if (t === 'healTarget' || t === 'healCaster' || t === 'healCasterWithoutElement' || t === 'healPVmaxTarget' || t === 'healPVmaxCaster') {
        const targets = (t === 'healTarget') ? allyTargets(x) : [c];
        for (const h of targets) {
          if (!h || !h.alive) continue;
          let amt;
          if (t === 'healPVmaxTarget' || t === 'healPVmaxCaster') amt = h.maxHp * x.min / 100;
          else if (t === 'healCasterWithoutElement') amt = x.min;
          else {
            let el = x.el; if (el < 0) el = c.el;
            amt = (rint(x.min, x.max) + s.base + c.baseAdd) * mult(G, P, c, el);
            const cr = R() * 100 < a.cc + c.critAdd;
            critCh[x.ch] = cr; lastCrit = cr;
            if (cr) amt *= (a.cm + c.cmAdd);
          }
          amt *= bers; // Berserk augmente aussi les soins (1.20)
          if (inv && t === 'healTarget') { const e = fixed || chooseEnemy(G, P, O, c, s, acts); if (e) { damage(G, c, e, amt, x.el, { brut }); hitList.push(e); } continue; }
          const hh = heal(h, amt);
          P.healDone += hh;
          if (t === 'healTarget' && !a.selfHeal) c.allyHeal += hh; // un soin sur soi-même ne fait pas un soigneur
          lastHeal = h;
          if (h.gel && h.gelBy !== G.castId) breakIce(G, h);
          const aoe = a.aoe + (c.pf.aoe ? pval(c, 'aoe') : 0);
          if (aoe && t === 'healTarget') for (const n of adjacent(P, h)) { const hn = heal(n, amt * aoe / 100); P.healDone += hn; c.allyHeal += hn; }
        }
      } else if (t === 'AddAllPlayerAttack') {
        const v = rint(x.min, x.max);
        if (x.el >= 0) addBonus(G, P, x.el, v); else for (let i = 0; i < 6; i++) addBonus(G, P, i, v);
      } else if (t === 'AddAllPlayerAttackRandomTeam') {
        // « dans un élément aléatoire » : tirage uniforme parmi les 6 éléments
        addBonus(G, P, rint(0, 5), rint(x.min, x.max));
      } else if (t === 'AddAllPlayerAttackCountActivation1') {
        addBonus(G, P, x.el >= 0 ? x.el : c.el, x.min + (s.n - 1));
      } else if (t === 'AddAllPlayerAttackWithCardType') {
        if (c.el >= 0) addBonus(G, P, c.el, rint(x.min, x.max));
      } else if (t === 'StealElement') {
        const e = x.el >= 0 ? x.el : c.el;
        if (e >= 0) { const take = Math.min(Math.max(0, O.bonus[e]), x.min); O.bonus[e] -= take; addBonus(G, P, e, x.min); }
      } else if (t === 'AddAllPlayerCritick') {
        for (const e of P.cards) if (e.alive) e.critAdd += x.min;
      } else if (t === 'AddAllPlayerMiss') {
        for (const e of P.cards) if (e.alive) e.accAdd -= x.min;
      } else if (t === 'AddAllPlayerHPMax') {
        for (const e of P.cards) if (e.alive) { e.maxHp += x.min; e.hp += x.min; }
      } else if (t === 'AddCardCriticChance') {
        c.critAdd += x.min;
      } else if (t === 'AddCardMiss') {
        c.accAdd -= x.min;
      } else if (t === 'AddCardCriticRatio') {
        c.cmAdd += x.min;
      } else if (t === 'AddCardResistance') {
        if (x.el >= 0) c.res[x.el] += x.min; else for (let i = 0; i < 6; i++) c.res[i] += x.min;
      } else if (t === 'AddCardHPMax') {
        const v = x.el >= 0 ? x.min * mult(G, P, c, x.el) : x.min;
        c.maxHp += v; c.hp += v;
      } else if (t === 'AddCardBaseDamage' || t === 'AddAbilityBaseDamage') {
        s.base += x.min;
      } else if (t === 'AddOppCardBaseDamage') {
        if (a.allyT === 'all') { for (const e of P.cards) if (e.alive) e.baseAdd += x.min; }
        else if (buffAlly) buffAlly.baseAdd += x.min;
      } else if (t === 'AddOppCardCriticChance') {
        if (a.allyT === 'all') { for (const e of P.cards) if (e.alive) e.critAdd += x.min; }
        else if (a.onCrit && lastHeal) lastHeal.critAdd += x.min;
        else if (a.allyT === 'randEach') { const e = randAlive(P); if (e) e.critAdd += x.min; }
        else if (buffAlly) buffAlly.critAdd += x.min;
      } else if (t === 'AddOppCardMiss') {
        if (x.min > 0) { // baisse de précision adverse
          const tg = hitList.length ? hitList : (primary ? [primary] : []);
          for (const e of tg) if (e.alive && !has(e, 'immunite')) e.accAdd -= x.min;
        } else if (buffAlly) buffAlly.accAdd -= x.min;
      } else if (t === 'AddOppCardCriticRatio') {
        const tg = a.allyT === 'field' ? alive(P).concat(alive(O)) : [lastHeal || buffAlly];
        for (const e of tg) if (e) e.cmAdd += x.min;
      } else if (t === 'AddOppCardResistance') {
        if (x.min < 0) {
          const tg = hitList.length ? hitList : (primary ? [primary] : []);
          for (const e of tg) if (e.alive && !has(e, 'immunite')) { if (x.el >= 0) e.res[x.el] += x.min; else for (let i = 0; i < 6; i++) e.res[i] += x.min; }
        } else {
          const tg = a.allyT === 'all' ? alive(P) : [lastHeal || healAlly || c];
          for (const e of tg) { if (!e) continue; const el = x.el >= 0 ? x.el : rint(0, 5); e.res[el] += x.min; }
        }
      } else if (t === 'AddCooldown') {
        const v = inv ? -x.min : x.min; // Inversement : Éternité <-> Temporalité
        if (v > 0) {
          let tg;
          if (a.cdAll) tg = alive(O);
          else if (hitList.length) tg = [hitList[hitList.length - 1]];
          else tg = primary ? [primary] : (inv ? [chooseEnemy(G, P, O, c, s, acts)].filter(Boolean) : []);
          for (const e of tg) if (e && e.alive) modCd(e, v);
        } else {
          let tg;
          if (a.allyT === 'all') tg = alive(P);
          else if (a.dmgT === 'randField' && chainT[x.ch]) tg = [chainT[x.ch]];
          else { // allié avec le plus de recharge
            let b = null, bs = -1;
            for (const e of P.cards) if (e.alive) { let sc = 0; for (const q of e.abil) sc += q.cd; if (sc > bs) { bs = sc; b = e; } }
            tg = b ? [b] : [];
          }
          for (const e of tg) if (e && e.alive) modCd(e, v);
        }
      } else if (t === 'AddSpamtonGenerationCaster') {
        c.gen += x.min;
      } else if (t === 'ResetCooldownTarget') {
        const tg = hitList.length ? hitList[0] : primary;
        if (tg && tg.alive && !has(tg, 'immunite')) for (const q of tg.abil) q.cd = Math.max(q.cd, q.a.cd);
      } else if (t === 'ResetSpamton') {
        O.spam = 0;
      } else if (t === 'ChangeElementTargetRandom') {
        c.el = rint(0, 5);
      } else if (t === 'Resurection') {
        const d = P.dead.pop();
        if (d) { d.alive = true; d.hp = d.maxHp * x.min / 100; d.gel = 0; }
      } else if (t === 'destroy') {
        let tg = null;
        if (a.absorbAlly) {
          let bs = Infinity;
          for (const e of P.cards) if (e.alive && e !== c && e.hp < e.maxHp * 0.2 && e.hp < bs) { bs = e.hp; tg = e; }
        } else {
          let bs = -1;
          for (const e of O.cards) if (e.alive && !has(e, 'immunite')) { const sc = e.hp + threat(e) * 5; if (sc > bs) { bs = sc; tg = e; } }
        }
        if (tg && tg.dummy) { c.maxHp += 800; c.hp += 800; G.P[c.owner].dmgDone += 800; tg = null; }
        if (tg) {
          c.maxHp += tg.maxHp; c.hp += tg.hp;
          if (tg.owner !== c.owner) { hitList.push(tg); G.P[c.owner].dmgDone += tg.hp; c.abDmg += tg.hp; }
          tg.passives = tg.passives.filter(p => p.k !== 'phoenix' && p.k !== 'tenacite'); refreshPF(tg);
          tg.h.transition = false;
          kill(G, tg, c);
          if (tg.owner !== c.owner) killed = true;
        }
      } else if (t === 'SetHPInPercent') {
        let tg = null, bs = 0;
        for (const e of O.cards) if (e.alive && !has(e, 'immunite')) { const d = e.dummy ? 800 * (1 - x.min / 100) * 0.6 : e.hp - e.maxHp * x.min / 100; if (d > bs) { bs = d; tg = e; } }
        if (tg && tg.dummy) { G.P[c.owner].dmgDone += bs; tg = null; }
        if (tg) { tg.hp = tg.maxHp * x.min / 100; G.P[c.owner].dmgDone += bs; c.abDmg += bs; checkThresholds(G, tg); }
      } else if (t === 'RemoveTauntRunning') {
        const tt = P.cards.find(e => e.alive && e.taunt > 0);
        if (tt) { tt.taunt = 0; lastHeal = tt; } else lastHeal = null;
      } else if (t === 'AddOppHPMax') {
        if (x.min < 0) {
          let d = null, bs = 0;
          for (const e of P.cards) if (e.alive && e !== c && e.maxHp > bs) { bs = e.maxHp; d = e; }
          if (d) { d.maxHp += x.min; d.hp = Math.min(d.hp, d.maxHp); if (d.hp <= 0) d.hp = 1; }
        } else if (a.breakTaunt) {
          if (lastHeal) { lastHeal.maxHp += x.min; lastHeal.hp += x.min; }
        } else for (const e of P.cards) if (e.alive && e !== c) { e.maxHp += x.min; e.hp += x.min; }
      }
    }

    // effets textuels
    if (gel && !G.over) {
      // Gel d'une compétence : sur la dernière cible ennemie touchée (ou la cible choisie pour un soin)
      const tg = hitList.length ? hitList[hitList.length - 1] : primary;
      if (!(a.choice && !a.optGel && !acts.some(x => DMG[x.t]))) freeze(G, tg);
    }
    if (a.eterText) for (const e of hitList) if (e.alive) modCd(e, 1);
    if (a.disp) for (const e of hitList) if (e.alive) disparition(e);
    if (a.taunt) {
      if (a.tauntRandAlly) { const e = randAlive(P); if (e) e.taunt = Math.max(e.taunt, a.taunt); }
      else c.taunt = Math.max(c.taunt, a.taunt);
    }
    if (a.hasDmg) {
      if (c.pf.provocation) c.taunt = Math.max(c.taunt, 1);
      if (c.h.erreur) { const e = randAlive(O); if (e && !has(e, 'immunite')) e.accAdd -= c.h.erreur; }
      if (c.h.multicolor) for (let i = 0; i < 6; i++) addBonus(G, P, i, 1);
    }
    if ((a.smoke || c.pf.fumee) && (a.hasDmg || a.hasHeal)) P.smoke = 1;

    // recharge
    if (force) return true;
    let cd = a.cd;
    if (c.pf.temporalite) cd = Math.max(1, cd - 1);
    s.cd = cd;
    if (killed && c.pf.reset) s.cd = 0;
    return true;
  }

  function disparition(e) {
    if (has(e, 'immunite') || e.h.insDisp) return;
    if (e.passives.length) { e.passives.pop(); refreshPF(e); }
    else {
      for (let i = e.abil.length - 1; i >= 0; i--) if (!e.abil[i].off) { e.abil[i].off = true; break; }
    }
  }

  function afterHit(G, P, c, a, t, dealt, el, brut) {
    if (dealt <= 0) return;
    const O = G.P[t.owner];
    const vamp = a.vamp + (c.pf.vamp ? pval(c, 'vamp') : 0);
    if (vamp) P.healDone += heal(c, dealt * vamp / 100);
    if (c.pf.contrecoup && c.alive) damage(G, null, c, dealt * 0.5, -1, { raw: true, noHooks: true });
    if (c.h.racket && t.owner !== c.owner) O.spam = Math.max(0, O.spam - c.h.racket);
    if (!t.alive) return;
    const imm = has(t, 'immunite');
    if (c.pf.erosion && !imm) { t.maxHp = Math.max(1, t.maxHp - dealt * pval(c, 'erosion') / 100); if (t.hp > t.maxHp) t.hp = t.maxHp; }
    if (c.pf.poison && !imm) { t.poison = 3; t.poisonPct = pval(c, 'poison'); }
    if (c.pf.gel && !imm) freeze(G, t);
    if (c.pf.eternite) modCd(t, 1);
    if (c.pf.disparition) disparition(t);
    const aoe = a.aoe + (c.pf.aoe ? pval(c, 'aoe') : 0);
    if (aoe && t.owner !== c.owner) for (const n of adjacent(O, t)) damage(G, c, n, dealt * aoe / 100, -1, { raw: true, noHooks: true });
  }

  // ------------------------------------------------------------- talents
  // effets appliqués à la création de la carte (ou après métamorphose)
  function applyStaticTalent(G, P, c) {
    const t = c.tal; if (!t) return;
    const id = t.id;
    const h = c.h;
    switch (id) {
      case 'Baleine bleue': { const v = tv(c, 'AddCardHPMax', 200); c.maxHp += v; c.hp += v; break; }
      case 'Blindage F/E': { const v = tv(c, 'AddCardResistance', 25); c.res[0] += v; c.res[1] += v; break; }
      case 'Blindage N/T': { const v = tv(c, 'AddCardResistance', 25); c.res[3] += v; c.res[2] += v; break; }
      case 'Blindage O/L': { const v = tv(c, 'AddCardResistance', 25); c.res[5] += v; c.res[4] += v; break; }
      case 'Durcissement': { const v = tv(c, 'AddCardResistance', 15); for (let i = 0; i < 6; i++) c.res[i] += v; break; }
      case 'Critique': c.critAdd += tv(c, 'AddCardCriticChance', 10); break;
      case 'Frappe': c.cmAdd += tv(c, 'AddCardCriticRatio', 1); break;
      case 'Revalorisation': c.gen += tv(c, 'AddSpamtonGenerationCaster', 5); break;
      case 'TRoulette': c.echoAdd += 10; break;
      case 'Paradoxe': for (let i = 0; i < 6; i++) c.res[i] = -c.res[i]; break;
      case 'Resilience': h.resilience = tv(c, 'AddCardResistance', 25); break;
      case 'Evolution': h.evolution = true; break;
      case 'Vitalite des Ames': h.vitalite = tv(c, 'AddCardHPMax', 300); break;
      case 'Armure des Ames': h.armureAmes = tv(c, 'AddCardResistance', 10); break;
      case 'OneManArmy': h.oneManArmy = tv(c, 'AddCardBaseDamage', 5); break;
      case 'Reset ultime': h.resetUltime = true; break;
      case 'TRevitalisation': h.revitalisation = true; break;
      case 'SursautVital': h.sursaut = true; break;
      case 'TChanceVitale': h.chanceVitale = true; break;
      case 'TCoeurAcier': h.coeurAcier = true; break;
      case 'Corrosion': h.corrosion = true; break;
      case 'Contre': h.contre = true; break;
      case 'Heritage': h.heritage = tv(c, 'AddSpamton', 50); break;
      case 'Heure funeste': h.heureFuneste = true; break;
      case 'Dernier souffle': h.dernierSouffle = true; break;
      case 'Virage360': h.virage = true; break;
      case 'Transition': h.transition = true; break;
      case 'TPlumePhoenix': h.plume = true; break;
      case 'Focus': h.focus = true; break;
      case 'BouleDeCrit': h.bouleCrit = tv(c, 'AddCardCriticChance', 2); break;
      case 'Incisif': h.incisif = true; break;
      case 'Affaiblissement': h.affaiblissement = true; break;
      case 'Fortune': h.fortune = tv(c, 'AddSpamtonGenerationCaster', 2); break;
      case 'Racket': h.racket = tv(c, 'AddSpamton', 5); break;
      case 'Erreur Croissante': h.erreur = tv(c, 'AddOppCardMiss', 3); break;
      case 'TAttackMulticolor': h.multicolor = true; break;
      case 'TInsensibleEternite': h.insEter = true; break;
      case 'TInsensibleDisparition': h.insDisp = true; break;
      case 'Life-8': h.life8 = true; break;
      case 'Souffle-8': h.souffle8 = true; break;
      case 'Bombe-8': h.bombe8 = true; break;
      case 'Immunite-8': h.immu8 = true; break;
      case 'Longueur': h.longueur = true; break;
      case 'Reducteur': h.reducteur = true; break;
      case '13eme mois': h.mois13 = tv(c, 'AddSpamton', 100); break;
      // passifs « Commence la partie avec le passif … »
      case 'TCoeurFeu_C': addPassive(c, { k: 'coeur', el: 0, tier: 0 }); break;
      case 'TCoeurEau_C': addPassive(c, { k: 'coeur', el: 1, tier: 0 }); break;
      case 'TCoeurTerre_C': addPassive(c, { k: 'coeur', el: 2, tier: 0 }); break;
      case 'TCoeurNature_C': addPassive(c, { k: 'coeur', el: 3, tier: 0 }); break;
      case 'TCoeurLumiere_C': addPassive(c, { k: 'coeur', el: 4, tier: 0 }); break;
      case 'TCoeurOmbre_C': addPassive(c, { k: 'coeur', el: 5, tier: 0 }); break;
      case 'TCoeurCorrompu': addPassive(c, { k: 'coeur', el: rint(0, 5), tier: 1 }); break;
      case 'TCoeurMystere': addPassive(c, randomPassive()); break;
      case 'TAoe_C': addPassive(c, { k: 'aoe', tier: 0 }); break;
      case 'TAoe_R': addPassive(c, { k: 'aoe', tier: 1 }); break;
      case 'TAoe_E': addPassive(c, { k: 'aoe', tier: 2 }); break;
      case 'TBrut': addPassive(c, { k: 'brut', tier: 1 }); break;
      case 'TErosion': addPassive(c, { k: 'erosion', tier: 0 }); break;
      case 'TInversement': addPassive(c, { k: 'inversement', tier: 1 }); break;
      case 'TMimetisme': addPassive(c, { k: 'mimetisme', tier: 1 }); break;
      case 'TPunchingBag': addPassive(c, { k: 'sacDeFrappe', tier: 0 }); break;
      case 'Nouvelle vie': addPassive(c, R() < 0.5 ? { k: 'phoenix', tier: 0 } : { k: 'cimetiere', tier: 0 }); break;
      case 'Nouveau riche': addPassive(c, R() < 0.5 ? { k: 'spamland', tier: 0 } : { k: 'luck', tier: 0 }); break;
      default: break;
    }
  }
  function addPassive(c, p) { const q = Object.assign({ tier: 0 }, p); c.passives.push(q); (c.pf[q.k] || (c.pf[q.k] = [])).push(q); }
  const MYSTERY = ['soinPrimitif', 'berserk', 'vamp', 'renvoi', 'tenacite', 'cimetiere', 'aoe', 'phoenix', 'coeurVital', 'sacDeFrappe', 'poison', 'erosion', 'coeurRes', 'luck'];
  function randomPassive() { const k = pick(MYSTERY); return { k, tier: 0 }; }

  // effets de talent appliqués une fois les deux decks posés
  function applyGameStartTalents(G, P, O) {
    for (const c of P.cards) {
      const t = c.tal; if (!t) continue;
      switch (t.id) {
        case 'Cavalerie': { const v = tv(c, 'AddOppHPMax', 150); for (const e of P.cards) if (e !== c) { e.maxHp += v; e.hp += v; } break; }
        case 'Blindage Partagé': { const v = tv(c, 'AddOppCardResistance', 10); for (const e of P.cards) for (let i = 0; i < 6; i++) e.res[i] += v; break; }
        case 'Depart multi elements': { const v = tv(c, 'AddAllPlayerAttack', 3); for (let i = 0; i < 6; i++) P.bonus[i] += v; break; }
        case 'Terrain aquatique': P.bonus[1] += tv(c, 'AddAllPlayerAttack', 7); break;
        case 'Terrain enflamée': P.bonus[0] += tv(c, 'AddAllPlayerAttack', 7); break;
        case 'Terrain terrestre': P.bonus[2] += tv(c, 'AddAllPlayerAttack', 7); break;
        case 'Terrain naturel': P.bonus[3] += tv(c, 'AddAllPlayerAttack', 7); break;
        case 'Terrain lumineux': P.bonus[4] += tv(c, 'AddAllPlayerAttack', 7); break;
        case 'Terrain sombre': P.bonus[5] += tv(c, 'AddAllPlayerAttack', 7); break;
        case 'A la caisse': P.spam += tv(c, 'AddSpamton', 25); break;
        case 'Dette': { const v = tv(c, 'SetSpamton', 20); P.spam -= v; O.spam -= v; break; }
        case 'Piece magique': P.luck += tv(c, 'AddLuck', 2); break;
        case 'TPetitPrix': P.petitPrix = true; break;
        case 'TToxChanceux': P.toxChanceux = true; break;
        case 'Imprecision': { const e = randAlive(O); if (e) e.accAdd -= tv(c, 'AddOppCardMiss', 20); break; }
        case 'Imprudent': {
          const n = metamorph(G, c, 'full', tv(c, 'AddCardHPMax', 500));
          n.hp = n.maxHp;
          break;
        }
        default: break;
      }
    }
    // Mystère (passif inné) : remplacé par un passif aléatoire
    for (const c of P.cards) {
      if (c.pf.mystere) {
        c.passives = c.passives.map(p => p.k === 'mystere' ? Object.assign({ innate: true }, randomPassive()) : p);
        refreshPF(c);
      }
    }
  }

  // ------------------------------------------------------------- boutique Tox
  // Boutique simplifiée : 4 Tox tirés au hasard (pondérés par la rareté / Chance), achat glouton.
  const SHOP = [
    // clé, palier, coût, placement
    ['berserk', 0, 30, 'any'], ['berserk', 1, 60, 'any'], ['berserk', 2, 100, 'any'], ['berserk', 3, 180, 'any'],
    ['coeurMain', 0, 15, 'any'], ['coeurMain', 1, 30, 'any'], ['coeurMain', 2, 60, 'any'], ['coeurMain', 3, 120, 'any'],
    ['soinPrimitif', 0, 20, 'tank'], ['soinPrimitif', 1, 40, 'tank'], ['soinPrimitif', 2, 60, 'tank'], ['soinPrimitif', 3, 120, 'tank'],
    ['vamp', 0, 30, 'dps'], ['vamp', 1, 70, 'dps'], ['vamp', 2, 110, 'dps'], ['vamp', 3, 160, 'dps'],
    ['coeurRes', 0, 10, 'any'], ['coeurRes', 1, 30, 'any'], ['coeurRes', 2, 70, 'any'], ['coeurRes', 3, 120, 'any'],
    ['coeurVital', 0, 10, 'tank'], ['coeurVital', 1, 30, 'tank'], ['coeurVital', 2, 70, 'tank'], ['coeurVital', 3, 150, 'tank'],
    ['renvoi', 0, 24, 'tank'], ['renvoi', 1, 48, 'tank'], ['renvoi', 2, 72, 'tank'], ['renvoi', 3, 96, 'tank'],
    ['phoenix', 0, 100, 'dps'], ['phoenix', 1, 150, 'dps'], ['phoenix', 2, 200, 'dps'], ['phoenix', 3, 250, 'dps'],
    ['cimetiere', 0, 20, 'any'], ['cimetiere', 1, 40, 'any'], ['cimetiere', 2, 60, 'any'], ['cimetiere', 3, 80, 'any'],
    ['aoe', 0, 45, 'dps'], ['aoe', 1, 90, 'dps'], ['aoe', 2, 135, 'dps'], ['aoe', 3, 180, 'dps'],
    ['spamland', 0, 6, 'any'], ['spamland', 1, 10, 'any'], ['spamland', 2, 16, 'any'], ['spamland', 3, 24, 'any'],
    ['luck', 0, 5, 'any'], ['luck', 1, 10, 'any'], ['luck', 2, 15, 'any'], ['luck', 3, 20, 'any'],
    ['poison', 0, 10, 'dps'], ['poison', 1, 50, 'dps'], ['poison', 2, 100, 'dps'], ['poison', 3, 150, 'dps'],
    ['sacDeFrappe', 0, 25, 'tank'], ['sacDeFrappe', 1, 50, 'tank'], ['sacDeFrappe', 2, 100, 'tank'], ['sacDeFrappe', 3, 150, 'tank'],
    ['tenacite', 0, 10, 'dps'], ['erosion', 0, 20, 'dps'], ['erosion', 2, 75, 'dps'],
    ['brut', 1, 65, 'dps'], ['multiplicateur', 1, 80, 'dps'], ['provocation', 1, 70, 'tank'], ['revanche', 1, 80, 'dps'],
    ['mimetisme', 1, 50, 'any'], ['fumee', 1, 50, 'dps'],
    ['immunite', 2, 90, 'dps'], ['reset', 2, 130, 'dps'], ['vengeur', 2, 80, 'dps'], ['bomba', 2, 130, 'tank'],
    ['gel', 2, 120, 'dps'], // 1.20 : Gel (épique) remplace Étourdissement (légendaire)
    ['eternite', 3, 220, 'dps'], ['temporalite', 3, 190, 'dps'], ['disparition', 3, 180, 'dps']
  ];
  const TOX_NAMES = {
    berserk: 'Berserk', coeurMain: 'Cœur élémentaire', soinPrimitif: 'Soin primitif', vamp: 'Vampirisme', coeurRes: 'Cœur résistance',
    coeurVital: 'Cœur vital', renvoi: 'Renvoi', phoenix: 'Phénix', cimetiere: 'Cimetière', aoe: 'AoE', spamland: 'Spamland', luck: 'Chanceur',
    poison: 'Poison', sacDeFrappe: 'Sac de frappe', tenacite: 'Ténacité', erosion: 'Érosion', brut: 'Brut', multiplicateur: 'Multiplicateur',
    provocation: 'Provocation', revanche: 'Revanche', mimetisme: 'Mimétisme', fumee: 'Fumée', immunite: 'Immunité', reset: 'Reset',
    vengeur: 'Vengeur', bomba: 'Bomba', gel: 'Gel', eternite: 'Éternité', temporalite: 'Temporalité', disparition: 'Disparition'
  };
  const SHOP_BY_TIER = [[], [], [], []];
  for (const s of SHOP) SHOP_BY_TIER[s[1]].push(s);

  // contexte d'évaluation des Tox : identique pour toutes les offres d'une même visite de la boutique
  function toxCtx(G, P) {
    const al = alive(P);
    const ab = avgBonus(G, P);
    return {
      al, rem: Math.max(2, 12 - P.turn * 0.5),             // tours restants estimés
      dps: al.reduce((s, c) => s + c.def.pDmg * (1 + 0.1 * ab), 0),
      hp: al.reduce((s, c) => s + c.maxHp, 0),
      main: Math.max.apply(null, G.prof[P.side])
    };
  }
  function toxValue(G, P, item, ctx) {
    const [k, tier] = item;
    const { al, rem, dps, hp, main } = ctx || toxCtx(G, P);
    if (!al.length) return 0;
    const v = TIERV[k] ? TIERV[k][tier] : 1;
    switch (k) {
      case 'berserk': return v / 100 * dps * rem;
      case 'coeurMain': return v * 0.1 * main * rem * rem / 2;
      case 'soinPrimitif': return v / 100 * (hp / al.length) * rem * 0.8;
      case 'vamp': return v / 100 * dps / al.length * 1.5 * rem * 0.7;
      case 'coeurRes': return v / 100 * hp * rem * 0.35;
      case 'coeurVital': return v * rem * 0.8;
      case 'renvoi': return v / 100 * 60 * rem;
      case 'phoenix': return v / 100 * (hp / al.length) * 1.3;
      case 'cimetiere': return v * 0.1 * dps * rem * 0.6;
      case 'aoe': return v / 100 * dps * 1.2 * rem * 0.8;
      case 'spamland': return v * rem * 1.5;
      case 'luck': return v * 6;
      case 'poison': return v / 100 * 800 * 3 * dps / 200;
      case 'sacDeFrappe': return v * 0.1 * main * rem * rem * 0.4;
      case 'tenacite': return 120;
      case 'erosion': return 0.3 * dps * rem;
      case 'brut': return 0.12 * dps * rem;
      case 'multiplicateur': return 0.1 * avgBonus(G, P) * dps / al.length * rem * 1.5 + 30;
      case 'provocation': return 90;
      case 'revanche': return dps / al.length * 4;
      case 'mimetisme': return 0.1 * main * rem * rem * 0.3;
      case 'fumee': return 0.2 * dps * rem;
      case 'immunite': return 150;
      case 'reset': return dps / al.length * 3;
      case 'vengeur': return dps / al.length * 3;
      case 'bomba': return 450;
      case 'gel': return dps * 0.25 * rem * 0.8;
      case 'eternite': return dps * 0.25 * rem * 0.8;
      case 'temporalite': return dps / al.length * 1.2 * rem * 0.8;
      case 'disparition': return 60 * rem;
      default: return 0;
    }
  }

  function shop(G, P) {
    const w = P.toxChanceux ? [25, 25, 25, 25] : (() => {
      const l = Math.min(30, P.luck);
      return [Math.max(10, 52 - l * 3), 30 + l, 13 + l * 1.2, 5 + l * 0.8];
    })();
    const tot = w[0] + w[1] + w[2] + w[3];
    const offer = [];
    for (let i = 0; i < 4; i++) {
      let r = R() * tot, t = 0;
      while (t < 3 && r >= w[t]) { r -= w[t]; t++; }
      offer.push(pick(SHOP_BY_TIER[t]));
    }
    // achat glouton (chaque Tox proposé ne peut être acheté qu'une fois)
    const bought = [false, false, false, false];
    let ctx = toxCtx(G, P);
    let guard = 0;
    while (guard++ < 4) {
      let best = -1, bv = 0;
      for (let i = 0; i < offer.length; i++) {
        const it = offer[i];
        if (!it || bought[i]) continue;
        const cost = P.petitPrix ? 0 : it[2];
        if (cost > P.spam) continue;
        const v = toxValue(G, P, it, ctx) / Math.max(5, it[2]);
        if (v > bv) { bv = v; best = i; }
      }
      if (best < 0 || bv < 0.6) break;
      bought[best] = true;
      const it = offer[best];
      if (P.petitPrix) P.petitPrix = false; else P.spam -= it[2];
      placeTox(G, P, it);
      ctx = toxCtx(G, P); // un Tox peut briser une glace (dégâts, voire une mort) : contexte à jour
    }
  }

  function placeTox(G, P, it) {
    const [k, tier, , place] = it;
    const al = alive(P);
    if (!al.length) return;
    let target;
    if (place === 'tank') target = al.reduce((a, b) => (b.maxHp > a.maxHp ? b : a));
    else if (place === 'dps') target = al.reduce((a, b) => (threat(b) > threat(a) ? b : a));
    else target = al[Math.floor(R() * al.length)];
    const p = { k: k === 'coeurMain' ? 'coeur' : k, tier, shop: true };
    if (k === 'coeurMain') { const prof = G.prof[P.side]; let m = 0; for (let i = 1; i < 6; i++) if (prof[i] > prof[m]) m = i; p.el = m; }
    target.passives.push(p);
    (target.pf[p.k] || (target.pf[p.k] = [])).push(p);
    breakIce(G, target); // un nouveau Tox brise la glace
    P.bought.push(k + tier);
    if (G.opt.log) G.log.push({ t: 'shop', side: P.side, text: `Boutique : ${TOX_NAMES[k] || k} (${['commune', 'rare', 'épique', 'légendaire'][tier]}) sur ${target.def.name}` });
  }

  // ------------------------------------------------------------- tours
  function startTurn(G, P, O) {
    P.turn++;
    for (const c of P.cards) {
      if (!c.alive) continue;
      // poison
      if (c.poison > 0) { damage(G, null, c, c.maxHp * c.poisonPct / 100, -1, { raw: true, noHooks: true }); c.poison--; if (!c.alive) continue; }
      const pf = c.pf;
      const bb0 = P.bonusGen;
      if (pf.coeur) for (const p of pf.coeur) addBonus(G, P, p.el, TIERV.coeur[Math.min(3, p.tier)]);
      c.bonusGen += P.bonusGen - bb0;
      if (pf.coeurVital) { const v = pval(c, 'coeurVital'); c.maxHp += v; c.hp += v; }
      // Cœur résistance (1.21) : au début de chacun de vos tours, résistances de toutes vos cartes (+3 / +6 / …)
      if (pf.coeurRes) { const v = pval(c, 'coeurRes'); for (const e of P.cards) if (e.alive) for (let i = 0; i < 6; i++) e.res[i] += v; }
      if (pf.soinPrimitif) { const hh = heal(c, c.maxHp * pval(c, 'soinPrimitif') / 100); P.healDone += hh; c.healDone += hh; }
      if (pf.luck) P.luck += pval(c, 'luck');
      if (pf.spamland) P.spam = Math.min(250, P.spam + pval(c, 'spamland'));
      const h = c.h;
      if (h.bouleCrit) c.critAdd += h.bouleCrit;
      if (h.incisif) for (const e of P.cards) if (e.alive) { e.critAdd += 1; e.accAdd += 1; }
      if (h.affaiblissement) for (const e of O.cards) if (e.alive && !has(e, 'immunite')) for (let i = 0; i < 6; i++) e.res[i] -= 1;
      if (h.fortune) c.gen += h.fortune;
      if (h.focus && R() < 0.25) c.taunt = Math.max(c.taunt, 1);
      if (h.revitalisation && R() < 0.05) c.hp = c.maxHp;
      if (h.sursaut && c.hp < c.maxHp * 0.1) c.hp = c.maxHp;
      if (P.turn === 1) {
        if (h.longueur) { const e = randAlive(O); if (e) modCd(e, 1); }
        if (h.reducteur) { const e = randAlive(P); if (e) modCd(e, -1); }
      }
      if (P.turn === 8) {
        if (h.life8) { c.maxHp *= 2; c.hp *= 2; }
        if (h.souffle8) {
          const sa = SOUFFLE;
          const st = { a: sa, cd: 0, uses: 0, base: 0, n: 0, off: false };
          if (c.abil.length) c.abil[c.abil.length - 1] = st; else c.abil.push(st);
        }
        if (h.bombe8) { if (c.passives.length) c.passives.pop(); addPassive(c, { k: 'bomba', tier: 2 }); }
        if (h.immu8) { if (c.passives.length) c.passives.pop(); addPassive(c, { k: 'immunite', tier: 2 }); }
      }
    }
    if (G.over) return;
    // Spamtons
    let gen = 0;
    for (const c of P.cards) if (c.alive) gen += c.gen;
    P.spam = Math.min(250, P.spam + gen);
    if (!P.got13 && P.spam >= 200 && P.cards.some(c => c.alive && c.h.mois13)) { P.got13 = true; P.spam = Math.min(250, P.spam + P.cards.find(c => c.alive && c.h.mois13).h.mois13); }
    if (G.opt.shopEvery > 0 && P.turn % G.opt.shopEvery === 0) shop(G, P);
  }

  let SOUFFLE = null;

  // ---------------------------------------------------------- journal (duel)
  const ELN = ['Feu', 'Eau', 'Terre', 'Nature', 'Lumière', 'Ombre'];
  function snap(G) {
    return { b: G.P.map(P => P.bonus.slice()), hp: G.P.map(P => P.cards.map(c => (c.alive ? c.hp : 0))), mx: G.P.map(P => P.cards.map(c => c.maxHp)), al: G.P.map(P => P.cards.map(c => c.alive)), ids: G.P.map(P => P.cards.map(c => c.def.idx)) };
  }
  function logCast(G, side, c, s, before) {
    const parts = [];
    if (G.lastMiss) parts.push('raté');
    const P = G.P[side];
    const bd = [];
    for (let i = 0; i < 6; i++) { const d = Math.round(P.bonus[i] - before.b[side][i]); if (d) bd.push((d > 0 ? '+' : '') + d + ' ' + ELN[i]); }
    if (bd.length) parts.push(bd.join(', '));
    for (let k = 0; k < 2; k++) {
      G.P[k].cards.forEach((e, i) => {
        if (before.ids[k][i] !== e.def.idx) { parts.push(`${e.def.name} apparaît`); return; }
        const d = Math.round((e.alive ? e.hp : 0) - before.hp[k][i]);
        if (!d) return;
        if (k !== side && d < 0) parts.push(`${e.def.name} −${-d}${e.alive ? '' : ' ✖'}`);
        else if (k === side && d > 0) parts.push(`soin ${e.def.name} +${d}`);
        else if (k === side && d < 0) parts.push(`${e.def.name} −${-d} (allié)`);
      });
    }
    G.log.push({ t: 'cast', side, card: c.def.name, ab: s.a.name, text: parts.join(' · ') || 'effet appliqué' });
  }

  function playTurn(G, side) {
    const P = G.P[side], O = G.P[1 - side];
    const logOn = G.opt.log;
    startTurn(G, P, O);
    if (logOn) G.log.push({ t: 'turn', side, turn: P.turn, bonus: P.bonus.map(Math.round), spam: P.spam, hp: G.P.map(S => S.cards.map(c => ({ n: c.def.name, hp: c.alive ? Math.round(c.hp) : 0, mx: Math.round(c.maxHp), idx: c.def.idx }))) });
    if (G.over) return;
    // ordre de lancement : par type de compétence (bonus, attaques, soins…), puis par emplacement.
    // Instantané des cartes vivantes en début de tour ; parcours par ordre croissant sans tableau ni tri (plus rapide).
    const cards = P.cards.slice();
    let mask = 0;
    for (let i = 0; i < cards.length; i++) if (cards[i].alive) mask |= 1 << i;
    for (let ord = 0; ord <= MAX_ORDER && !G.over; ord++) {
      for (let i = 0; i < cards.length && !G.over; i++) {
        if (!(mask & (1 << i))) continue;
        const c = cards[i], ab = c.abil;
        for (let k = 0; k < ab.length; k++) {
          const s = ab[k];
          if (s.a.order !== ord) continue;
          if (G.over) break;
          if (!c.alive || c.gel > 0 || s.off) continue;
          let n = 0;
          while (s.cd === 0 && n < 8 && c.alive && !G.over && c.gel === 0) {
            if (s.a.uses && s.uses <= 0) break;
            const before = logOn ? snap(G) : null;
            G.lastMiss = false;
            const hb = P.healDone, bb = P.bonusGen;
            if (!cast(G, P, O, c, s)) break;
            c.healDone += P.healDone - hb; c.bonusGen += P.bonusGen - bb;
            if (logOn) logCast(G, side, c, s, before);
            n++;
            const echo = s.a.echo + c.echoAdd;
            if (s.cd !== 0 && echo > 0 && R() * 100 < echo) s.cd = 0;
          }
        }
      }
    }
    // fin de tour
    for (const c of P.cards) {
      for (const s of c.abil) if (s.cd > 0) s.cd--;
      if (c.gel > 0) c.gel--;
    }
    for (const c of O.cards) if (c.taunt > 0) c.taunt--;
    O.smoke = 0;
    if (G.opt.trace) {
      G.trace.push({
        side, turn: P.turn, spam: P.spam, bonus: P.bonus.slice(), dmg: Math.round(P.dmgDone),
        cards: G.P.map(S => S.cards.map(c => `${c.def.name.slice(0, 14)}:${c.alive ? Math.round(c.hp) + '/' + Math.round(c.maxHp) : 'X'}`).join(' | '))
      });
    }
  }

  // ------------------------------------------------------------- partie
  const DEFAULT_OPT = { maxTurns: 30, shopEvery: 3, terrain: false };

  function newGame(deckA, deckB, opt) {
    const G = {
      P: [makePlayer(0, deckA), makePlayer(1, deckB)], terrain: -1, over: false, winner: -1, deaths: 0,
      lastKiller: null, opt: Object.assign({}, DEFAULT_OPT, opt || {}), prof: null, halfTurns: 0, trace: [], log: [], lastMiss: false, castId: 0, castSeq: 0, casting: null
    };
    if (G.opt.terrain) G.terrain = rint(0, 5);
    G.first = R() < 0.5 ? 0 : 1;
    for (const P of G.P) for (const c of P.cards) applyStaticTalent(G, P, c);
    G.prof = G.P.map(P => profile(P));
    applyGameStartTalents(G, G.P[0], G.P[1]);
    applyGameStartTalents(G, G.P[1], G.P[0]);
    for (const P of G.P) {
      const red = P.side === G.first ? 1 : 2;
      for (const c of P.cards) for (const s of c.abil) s.cd = Math.max(0, s.a.cd - red);
    }
    // Anticipation : toutes les compétences lancées dès le début, sur une même carte adverse aléatoire
    for (const P of G.P) for (const c of P.cards) if (c.tal && c.tal.id === 'Anticipation' && c.alive && !G.over) unleashAll(G, c, randAlive(G.P[1 - P.side]));
    return G;
  }

  function profile(P) {
    const prof = [0, 0, 0, 0, 0, 0];
    for (const c of P.cards) for (let i = 0; i < 6; i++) prof[i] += c.def.elDmg[i];
    return prof;
  }

  function hpRatio(P) {
    let s = 0, m = 0;
    for (const c of P.cards) { m += c.maxHp; if (c.alive) s += Math.max(0, c.hp); }
    return m ? s / m : 0;
  }

  function playGame(deckA, deckB, opt) {
    const G = newGame(deckA, deckB, opt);
    const maxHalf = G.opt.maxTurns * 2;
    let side = G.first;
    while (!G.over && G.halfTurns < maxHalf) {
      playTurn(G, side);
      G.halfTurns++;
      side = 1 - side;
    }
    let winner = G.winner;
    if (!G.over) {
      const a = hpRatio(G.P[0]), b = hpRatio(G.P[1]);
      winner = Math.abs(a - b) < 0.02 ? 0.5 : (a > b ? 0 : 1);
    }
    if (G.opt.log) G.log.push({ t: 'end', side: winner === 0.5 ? -1 : winner, text: G.over ? 'Toutes les cartes adverses sont détruites' : `Limite de ${G.opt.maxTurns} tours : victoire aux PV restants` });
    return {
      winner, turns: Math.ceil(G.halfTurns / 2), over: G.over,
      dmg: [G.P[0].dmgDone, G.P[1].dmgDone], heal: [G.P[0].healDone, G.P[1].healDone],
      bonus: [G.P[0].bonusGen, G.P[1].bonusGen], hp: [hpRatio(G.P[0]), hpRatio(G.P[1])],
      trace: G.trace, terrain: G.terrain, first: G.first, log: G.log,
      bought: [G.P[0].bought, G.P[1].bought],
      cardDmg: G.P.map(P => P.cards.map(c => c.dmgDealt)),
      // par carte : [dégâts infligés, bonus générés, soins, dégâts encaissés]
      cardStats: G.P.map(P => P.cards.map(c => [c.abDmg, c.bonusGen, c.allyHeal, c.dmgTaken])),
      deathsA: G.P[0].cards.filter(c => !c.alive).length, deathsB: G.P[1].cards.filter(c => !c.alive).length
    };
  }

  // ------------------------------------------------ évaluation rapide (solo)
  // Le deck joue seul contre 4 mannequins (PV infinis, 10 % de résistance) ; mesure dégâts + robustesse.
  let DUMMY = null;
  function dummyDef() {
    if (DUMMY) return DUMMY;
    DUMMY = { idx: -1, id: 'dummy', name: 'Mannequin', el: -1, rar: 'common', hp: 1e9, gen: 0, res: [10, 10, 10, 10, 10, 10], abilities: [], skills: [], talents: [], power: 30, pDmg: 30, pHeal: 0, pBonus: 0, elDmg: [0, 0, 0, 0, 0, 0] };
    return DUMMY;
  }

  function soloScore(deck, opt, turns) {
    turns = turns || 8;
    const dd = dummyDef();
    const G = newGame(deck, [{ card: dd }, { card: dd }, { card: dd }, { card: dd }], Object.assign({}, opt, { terrain: false }));
    G.terrain = -1;
    G.first = 0;
    const P = G.P[0], O = G.P[1];
    for (const c of O.cards) c.dummy = true;
    for (const c of P.cards) for (const s of c.abil) s.cd = Math.max(0, s.a.cd - 1);
    let dmgW = 0;
    for (let t = 1; t <= turns; t++) {
      const before = P.dmgDone;
      playTurn(G, 0);
      // pondération : les premiers tours comptent plus (tempo)
      dmgW += (P.dmgDone - before) * (1.15 - t * 0.03);
      for (const c of O.cards) c.hp = c.maxHp = 1e9;
      O.smoke = 0;
    }
    let ehp = 0;
    for (const c of P.cards) {
      const avgRes = c.res.reduce((s, x) => s + Math.max(-50, Math.min(80, x)), 0) / 6;
      ehp += c.maxHp / (1 - avgRes / 100);
      if (c.pf.phoenix) ehp += c.maxHp * pval(c, 'phoenix') / 100;
      if (c.pf.tenacite) ehp += 80;
      if (c.h.transition) ehp += 500;
    }
    ehp += P.healDone * 0.8;
    const off = dmgW / turns;
    return { score: off * ehp / 1000, off, ehp, bonus: P.bonusGen, spam: P.cards.reduce((s, c) => s + c.gen, 0) };
  }

  // ------------------------------------------------------ souffle élémentaire
  SOUFFLE = compileAbility({
    name: 'Souffle élémentaire', effect: 'Attaque 30 dans son élément', cooldown: 1, precision: 100, critChance: 1, critMultiplier: 2,
    uses: 0, cooldownResetChance: 0, actions: [{ effect: 'DamageWithCardElement', kind: 'damage', min: 30, max: 30, element: null, chain: 0 }]
  });

  const api = {
    ELS, EI, DB, load, seed, playGame, soloScore, compileCard, norm, TIERV, TOX_NAMES, ELN,
    get rng() { return R; }
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SpamEngine = api;
})(typeof self !== 'undefined' ? self : this);
