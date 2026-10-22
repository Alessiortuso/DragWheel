// Lato app principale: avvia il processo di lavoro quando serve e lo chiude subito dopo l'ultimo uso
// (con il modello caricato occupa memoria). Resta in vita finché c'è una finestra di ritocco aperta, perché
// la maschera dell'analisi vive lì dentro e serve al salvataggio.
const { utilityProcess } = require('electron');
const path = require('path');

const IDLE_MS = 15 * 1000; // tolleranza dopo l'ultimo utilizzo, per non ricaricare il modello se si riapre subito
let proc = null, nextId = 1, idleTimer = null, holders = 0;
const pending = new Map(); // id -> { resolve, reject, onProgress }

function ensure() {
  if (proc) return proc;
  proc = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'dragwheel-bg' });
  proc.on('message', (m) => {
    const p = pending.get(m.id);
    if (!p) return;
    if (m.progress) return p.onProgress && p.onProgress(m.progress.stage, m.progress.p);
    pending.delete(m.id);
    if (m.error) p.reject(new Error(m.error)); else p.resolve(m.result);
    armIdle();
  });
  proc.on('exit', (code) => {
    const err = new Error(`il processo di elaborazione si è interrotto (codice ${code})`);
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    proc = null;
  });
  return proc;
}

function armIdle() {
  clearTimeout(idleTimer);
  if (pending.size || holders > 0) return;
  idleTimer = setTimeout(() => { if (proc && !pending.size && holders === 0) proc.kill(); }, IDLE_MS);
}

function call(msg, onProgress) {
  if (msg.type === 'forget' && !proc) return Promise.resolve(true); // niente da dimenticare: non avviare un processo apposta
  clearTimeout(idleTimer);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    ensure().postMessage({ ...msg, id });
  });
}

// Una finestra che usa il processo lo "trattiene" finché non viene chiusa
function retain() { holders++; clearTimeout(idleTimer); }
function release() { holders = Math.max(0, holders - 1); armIdle(); }

function shutdown() { clearTimeout(idleTimer); if (proc) proc.kill(); }

module.exports = { call, retain, release, shutdown };
