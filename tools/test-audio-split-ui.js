// Prova la scheda "Voce / musica" della finestra Audio con una vera separazione. Uso: npx electron tools/test-audio-split-ui.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
app.disableHardwareAcceleration();
const { openAudioTool } = require('../src/audio-tool');
const { makeSong } = require('./fixture-song');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'dw-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-splitui-'));
  const song = makeSong(d);
  if (!song) { console.log('Sintesi vocale non disponibile: collaudo saltato'); return app.exit(0); }
  let win;
  const open = async (files, preset) => { await openAudioTool(files, preset); win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle().startsWith('Audio')) || BrowserWindow.getAllWindows().slice(-1)[0]; win.webContents.on('console-message', (...a) => { const m = a[2] ?? a[0].message; if (/Uncaught|Refused/.test(String(m))) console.log('  [pagina]', m); }); await wait(1500); };
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(OUT, `split-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); while ((await ev('running')) && Date.now() - t < 180000) await wait(300); await wait(300); };
  const result = () => ev(`[...document.querySelectorAll('#result .card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim().replace(/Apri cartella.*$/, '')).join(' || ')`);
  const made = () => fs.readdirSync(d).filter((n) => /\((voce|musica|batteria|basso|altro)\)/.test(n)).sort().join(', ');

  await open([song.mix], 'aud:split');
  console.log('scheda    :', await ev(`op + ' | pulsante: ' + $('go').textContent + ' | ' + $('spNote').textContent.slice(0, 70)`));
  await shot('1');
  await run(`go()`);
  await wait(4000);
  console.log('progresso :', await ev(`$('ptxt').textContent`));
  await finish();
  console.log('risultato :', await result(), '|', made());
  await run(`$('spVoc').checked = false; $('spMus').checked = false; go()`); await wait(300);
  console.log('nulla     :', await ev(`$('msg').textContent`));
  await run(`$('spDrums').checked = true; $('spBass').checked = true; $('spOther').checked = true; $('spVoc').checked = true; $('spMus').checked = false; document.getElementById('splitFmt').value = 'wav'; go()`); await finish();
  console.log('4 parti   :', await result(), '|', made());
  // annullamento a metà
  await run(`document.getElementById('splitFmt').value = 'mp3'; $('spDrums').checked = false; $('spBass').checked = false; $('spOther').checked = false; go()`);
  await wait(4500); await run(`$('stop').click()`); await finish();
  console.log('annullato :', await result());
  console.log('file finali:', made());
  await shot('2');
  app.exit(0);
});
app.on('window-all-closed', () => {});
