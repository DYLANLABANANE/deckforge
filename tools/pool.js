// Calcul parallèle : un pool de workers (worker_threads), chacun charge le moteur, l'optimiseur et les données.
// Les tâches sont des fonctions de tools/worker.js ; chaque tâche fixe sa propre graine (résultats reproductibles).
// usage : const pool = createPool(); const res = await pool.run('optimize', input); … pool.close();
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

function createPool(size) {
  // priorité « inférieure à la normale » : le PC reste utilisable, le calcul ralentit quand on s'en sert
  // (PRIORITY=normal pour la désactiver ; sous Windows elle s'applique à tous les workers du processus)
  if (process.env.PRIORITY !== 'normal') { try { os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL); } catch (e) { /* non supporté */ } }
  const n = Math.max(1, size || +process.env.WORKERS || os.cpus().length - 2);
  const workers = [], idle = [], queue = [], pending = new Map();
  let seq = 0;
  const pump = () => {
    while (idle.length && queue.length) {
      const w = idle.pop(), t = queue.shift();
      pending.set(t.id, Object.assign(t, { w }));
      w.postMessage({ id: t.id, fn: t.fn, input: t.input });
    }
  };
  for (let i = 0; i < n; i++) {
    const w = new Worker(path.join(__dirname, 'worker.js'));
    w.on('message', m => {
      const t = pending.get(m.id);
      if (!t) return;
      pending.delete(m.id);
      idle.push(w);
      if (m.error) t.reject(new Error(m.error)); else t.resolve(m.res);
      pump();
    });
    w.on('error', e => { for (const t of pending.values()) if (t.w === w) t.reject(e); });
    workers.push(w); idle.push(w);
  }
  return {
    size: n,
    run(fn, input) { return new Promise((resolve, reject) => { queue.push({ id: ++seq, fn, input, resolve, reject }); pump(); }); },
    close() { return Promise.all(workers.map(w => w.terminate())); }
  };
}

module.exports = { createPool };
