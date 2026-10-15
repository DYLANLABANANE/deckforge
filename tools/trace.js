// Trace une partie tour par tour (debug)
// usage: node tools/trace.js "Carte1,Carte2,Carte3,Carte4" "Carte1,..." [graine]
const fs = require('fs');
const path = require('path');
const E = require('../src/engine.js');
E.load(JSON.parse(fs.readFileSync(path.join(__dirname, '../data/cards.fr.json'), 'utf8')));
const byName = n => {
  const [name, tal] = n.split(':');
  const i = E.DB.cards.findIndex(d => d.name.toLowerCase().includes(name.trim().toLowerCase()));
  if (i < 0) throw new Error('carte inconnue ' + name);
  return { card: i, talent: +(tal || 0) };
};
const A = (process.argv[2] || 'Roi Ombre,Codex des Maux,Moxilys,Veilleur').split(',').map(byName);
const B = (process.argv[3] || 'Esprit Feu,Esprit Eau,Esprit Terre,Esprit Nature').split(',').map(byName);
E.seed(+process.argv[4] || 7);
const r = E.playGame(A, B, { trace: true });
console.log('A =', A.map(x => E.DB.cards[x.card].name).join(' + '));
console.log('B =', B.map(x => E.DB.cards[x.card].name).join(' + '));
console.log('terrain', E.ELS[r.terrain], 'premier', r.first ? 'B' : 'A');
for (const t of r.trace) {
  console.log(`${t.side ? 'B' : 'A'} T${t.turn} spam=${t.spam} bonus=[${t.bonus.join(',')}] dmgTot=${t.dmg}`);
  console.log('   A: ' + t.cards[0]);
  console.log('   B: ' + t.cards[1]);
}
console.log('gagnant', r.winner, 'tours', r.turns);
