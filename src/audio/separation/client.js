// Lato app principale: lancia la separazione in un processo dedicato (che si chiude a fine lavoro, liberando la memoria)
// e restituisce un'operazione annullabile, come le altre operazioni audio.
const { utilityProcess } = require('electron');
const fs = require('fs');
const path = require('path');

function run(job, onProgress = () => {}) {
  const proc = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'dragwheel-separate' });
  let settled = false, cancelled = false, rejectFn;
  const promise = new Promise((resolve, reject) => {
    rejectFn = reject;
    const done = (fn, v) => { if (settled) return; settled = true; fn(v); proc.kill(); };
    proc.on('message', (m) => {
      if (m.progress) onProgress(m.progress.stage, m.progress.p);
      else if (m.error) done(reject, new Error(m.error));
      else done(resolve, m.result);
    });
    proc.on('exit', (code) => done(reject, new Error(`il processo di elaborazione si è interrotto (codice ${code})`)));
    proc.postMessage(job);
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      cancelled = true; settled = true; proc.kill();
      for (const f of Object.values(job.outputs)) fs.rmSync(f, { force: true });
      rejectFn(Object.assign(new Error('annullato'), { cancelled: true }));
    },
    get cancelled() { return cancelled; },
  };
}
module.exports = { run };
