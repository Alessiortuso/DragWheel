// Processo separato (utilityProcess): esegue la separazione fuori dal processo principale, così l'app resta reattiva.
const engine = require('./engine');

process.parentPort.on('message', async ({ data: job }) => {
  const send = (m) => process.parentPort.postMessage(m);
  try {
    const files = await engine.separate(job, (stage, p) => send({ progress: { stage, p } }));
    send({ result: files });
  } catch (e) {
    send({ error: e && e.message ? e.message : String(e) });
  }
});
