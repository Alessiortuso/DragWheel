// Processo separato (utilityProcess): esegue l'inferenza fuori dal processo principale, così l'app resta reattiva.
const engine = require('./engine');

const states = new Map(); // id sessione -> stato dell'analisi (maschera del modello, ecc.)

process.parentPort.on('message', async ({ data: msg }) => {
  const send = (m) => process.parentPort.postMessage({ id: msg.id, ...m });
  const progress = (stage, p) => send({ progress: { stage, p } });
  try {
    if (msg.type === 'analyze') {
      const st = await engine.analyze(msg.file, msg.model, progress);
      states.set(msg.sid, { file: msg.file, ...st });
      send({ result: { width: st.width, height: st.height, workW: st.workW, workH: st.workH, rgb: st.rgb, base: st.base } });
    } else if (msg.type === 'export') {
      const st = states.get(msg.sid);
      if (!st) throw new Error('sessione scaduta: riapri l’immagine');
      const out = await engine.exportPng(st.file, st, { ...msg.opts, outPath: msg.outPath }, progress);
      send({ result: { outPath: out } });
    } else if (msg.type === 'auto') { // senza ritocchi: analisi + salvataggio
      const st = await engine.analyze(msg.file, msg.model, (s, p) => progress(s, p * 0.5));
      await engine.exportPng(msg.file, st, { ...msg.output, outPath: msg.outPath }, (s, p) => progress(s, 0.5 + p * 0.5));
      send({ result: { outPath: msg.outPath } });
    } else if (msg.type === 'forget') {
      states.delete(msg.sid);
      send({ result: true });
    }
  } catch (e) {
    send({ error: e && e.message ? e.message : String(e) });
  }
});
