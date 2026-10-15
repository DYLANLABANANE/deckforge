// Test rapide du moteur : parties aléatoires, durée, vitesse.
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
const data = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8'));
E.load(data);
E.seed(42);
const N = E.DB.cards.length;
const rnd = () => Math.floor(E.rng() * N);
function randDeck() {
  const s = new Set();
  while (s.size < 4) s.add(rnd());
  return [...s].map(i => ({ card: i, talent: 1 + Math.floor(E.rng() * 3) }));
}
let t0 = Date.now(), turns = 0, over = 0, draws = 0, dmg = 0;
const G = 3000;
for (let i = 0; i < G; i++) {
  const r = E.playGame(randDeck(), randDeck(), {});
  turns += r.turns; over += r.over ? 1 : 0; draws += r.winner === 0.5 ? 1 : 0; dmg += r.dmg[0] + r.dmg[1];
}
const ms = Date.now() - t0;
console.log(`${G} parties en ${ms} ms (${(ms / G).toFixed(3)} ms/partie)`);
console.log(`tours moyens ${(turns / G).toFixed(1)}, terminées ${(100 * over / G).toFixed(1)}%, nulles ${draws}, dégâts moyens/partie ${(dmg / G).toFixed(0)}`);

t0 = Date.now();
let sc = 0;
for (let i = 0; i < 2000; i++) sc += E.soloScore(randDeck(), {}, 8).score;
console.log(`2000 soloScore en ${Date.now() - t0} ms, moyenne ${(sc / 2000).toFixed(1)}`);

// top cartes par puissance statique
const top = E.DB.cards.slice().sort((a, b) => b.power - a.power).slice(0, 15);
console.log(top.map(d => `${d.name} ${d.power.toFixed(0)}`).join(' | '));
