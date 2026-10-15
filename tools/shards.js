// Calcul réparti (tools/cloud.sh) : réunit les fichiers de reprise écrits par chaque machine (SHARD=i/N) en un seul
// fichier de reprise ; le script de l'étape, relancé sans SHARD, trouve alors tout calculé et écrit son résultat final.
// usage: node tools/shards.js <fichier de reprise> <part0.json> <part1.json> …
const fs = require('fs');

const [dest, ...parts] = process.argv.slice(2);
if (!dest || !parts.length) { console.error('usage: node tools/shards.js <fichier de reprise> <parts…>'); process.exit(1); }
let sig = null;
const merged = {};
for (const f of parts) {
  const p = JSON.parse(fs.readFileSync(f, 'utf8'));
  // toutes les machines doivent avoir calculé la même chose (même version, mêmes réglages, mêmes adversaires)
  if (sig === null) sig = p.sig;
  else if (p.sig !== sig) throw new Error(`${f} : signature ${p.sig} différente de ${sig}`);
  for (const [k, v] of Object.entries(p)) if (k !== 'sig') Object.assign(merged[k] || (merged[k] = {}), v);
}
fs.writeFileSync(dest, JSON.stringify(Object.assign({ sig }, merged)));
console.log(`${parts.length} parts réunies dans ${dest} : ` + Object.entries(merged).map(([k, v]) => `${Object.keys(v).length} ${k}`).join(', '));
