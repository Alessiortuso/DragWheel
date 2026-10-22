// Ciclo di vita del processo di lavoro e memoria: apre Rimuovi sfondo, aspetta oltre il tempo di inattività con la finestra aperta,
// salva, chiude e verifica che il processo sparisca. Uso: npx electron tools/test-lifecycle.js <fast|precise>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { openTool } = require('../src/tools');
const { photo } = require('./fixture-photo');
const model = process.argv[2] || 'fast';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const util = () => app.getAppMetrics().filter((m) => m.type === 'Utility' && m.name !== 'Network Service' && m.memory.workingSetSize > 100 * 1024); // processi di lavoro (KB)
const mb = () => util().map((m) => Math.round(m.memory.workingSetSize / 1024) + ' MB').join(', ') || 'nessuno';

app.whenReady().then(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-')); const file = path.join(d, 'foto.png');
  fs.copyFileSync(photo(0), file);
  console.log('prima              : processi di lavoro =', mb());
  await openTool('removebg', [file]);
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (c) => win.webContents.executeJavaScript(c);
  await wait(1500);
  while (await ev(`document.getElementById('save').disabled`)) await wait(500);
  if (model === 'precise') { // passa al modello preciso a prima analisi finita
    await ev(`document.querySelector('[data-m="precise"]').click(); 0`); await wait(800);
    while (await ev(`document.getElementById('save').disabled`)) await wait(500);
    console.log('picco del processo di lavoro =', Math.max(...app.getAppMetrics().map((m) => Math.round((m.memory.peakWorkingSetSize || 0) / 1024))), 'MB');
  }
  console.log('analisi finita     : RAM =', mb());
  await wait(20000); // più dei 15 s di tolleranza: con la finestra aperta il processo deve restare
  console.log('dopo 20 s (aperta) : RAM =', mb());
  await ev(`save(); 0`);
  while (!(await ev(`document.getElementById('reveal').style.display === ''`))) await wait(500);
  console.log('salvataggio        :', await ev(`document.getElementById('status').textContent`));
  win.destroy();
  await wait(2000); console.log('2 s dopo chiusura  : RAM =', mb());
  await wait(16000); console.log('18 s dopo chiusura : RAM =', mb());
  app.exit(0);
});
app.on('window-all-closed', () => {});
