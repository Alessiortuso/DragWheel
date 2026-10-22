// Prova il motore di rimozione sfondo su immagini della cartella Download (solo lettura). Uso: node tools/test-bg-engine.js <fast|precise> <indice...>
const fs = require('fs'), path = require('path');
const engine = require('../src/bg/engine');
const { photo } = require('./fixture-photo');
const OUT = process.env.OUT;
const files = Array.from({ length: 40 }, (_, i) => photo(i));
(async () => {
  const model = process.argv[2];
  for (const i of process.argv.slice(3).map(Number)) {
    const f = files[i];
    const t = Date.now();
    const st = await engine.analyze(f, model, (s, p) => process.env.V && console.log('  ', s, p));
    const t1 = Date.now();
    await engine.exportPng(f, st, { outPath: path.join(OUT, `i${i}-${model}-new.png`) });
    console.log(`#${i} ${st.width}x${st.height} ${model}: analisi ${t1 - t} ms, salvataggio ${Date.now() - t1} ms`);
  }
})().catch((e) => { console.error('ERRORE', e); process.exit(1); });
