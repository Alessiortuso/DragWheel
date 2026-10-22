const { app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const bg = require('../src/bg/client');
const { photo } = require('./fixture-photo');
app.whenReady().then(async () => {
  const f0 = photo(7);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-')); const file = path.join(d, 'foto.png'); fs.copyFileSync(f0, file);
  const t = Date.now();
  try {
    const r = await bg.call({ type: 'analyze', sid: 1, file, model: 'fast' }, (s, p) => console.log('  progresso', s, p));
    console.log('ok', Date.now() - t, 'ms', r.width, r.height, r.workW, r.workH, 'rgb', r.rgb.length, 'base', r.base.length, r.rgb.constructor.name);
  } catch (e) { console.log('ERRORE', e.message); }
  bg.shutdown(); app.exit(0);
});
app.on('window-all-closed', () => {});
