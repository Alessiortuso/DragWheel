// Prova la finestra "Documenti Word" con file generati qui. Uso: npx electron tools/test-doc-ui.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
app.disableHardwareAcceleration();
const { makeDoc } = require('./doc-fixture');
const { openDocTool } = require('../src/doc-tool');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-dui-'));
  const f1 = await makeDoc(d, 'contratto.docx'), f2 = await makeDoc(d, 'allegato.docx', { title: 'Allegato', big: false });

  let win;
  const open = async (files, preset) => { await openDocTool(files, preset); win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle().startsWith('Documenti')) || BrowserWindow.getAllWindows().slice(-1)[0]; win.webContents.on('console-message', (...a) => { const m = a[2] ?? a[0].message; if (/Uncaught|rror/.test(String(m))) console.log('  [pagina]', m); }); await wait(1500); };
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  const shot = async (n) => { await wait(400); fs.writeFileSync(path.join(OUT, `doc-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); while ((await ev('running')) && Date.now() - t < 90000) await wait(200); await wait(300); };
  const result = () => ev(`[...document.querySelectorAll('#result .card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim().replace(/Apri cartella.*$/, '')).join(' || ')`);
  const made = (re) => fs.readdirSync(d).filter((n) => re.test(n)).sort().join(', ');

  await open([f1], 'dx:convert:pdf');
  console.log('anteprima :', await ev(`[...document.querySelectorAll('.stat')].map((s) => s.textContent).join(' | ') + ' || testo: ' + $('preview').textContent.slice(0, 40).replace(/\\n/g, ' ')`));
  console.log('preset    :', await ev(`$('cvTarget').value + ' | scheda: ' + op + ' | pulsante: ' + $('go').textContent`));
  await shot('1-converti');
  await run(`go()`); await finish();
  console.log('converti  :', await result(), '|', made(/\.pdf$/));
  await run(`$('cvTarget').value = 'md'; convPanel(); go()`); await finish();
  console.log('markdown  :', await result(), '|', made(/\.md$|immagini/));

  await run(`setOp('compress')`); await shot('2-comprimi');
  await run(`document.querySelector('[name=clevel][value=small]').checked = true; go()`); await finish();
  console.log('comprimi  :', await result(), '|', made(/compresso/));

  await run(`setOp('clean')`); await shot('3-pulisci');
  await run(`go()`); await finish();
  console.log('pulisci   :', await result(), '|', made(/pulito/));

  await run(`setOp('replace'); document.querySelector('.pf').value = 'cliente'; document.querySelector('.pr').value = 'Fornitore'; $('pAdd').click(); document.querySelectorAll('.pf')[1].value = '30%'; document.querySelectorAll('.pr')[1].value = '40%'`);
  await shot('4-sostituisci');
  await run(`go()`); await finish();
  console.log('sostituisci:', await result(), '|', made(/sostituito/));
  await run(`document.querySelectorAll('.pf').forEach((x) => x.value = 'nonc\\'è'); go()`); await finish();
  console.log('nessun match:', await result());
  await run(`document.querySelectorAll('.pf').forEach((x) => x.value = ''); go()`); await wait(300);
  console.log('vuoto     :', await ev(`$('msg').textContent`));
  win.destroy(); await wait(400);

  await open([f1, f2], 'dx:merge');
  console.log('unisci    :', await ev(`mlist.map(name).join(' > ') + ' | vista: ' + (mergeView.classList.contains('on') ? 'elenco da unire' : '?') + ' | Word: ' + hasWord`));
  await run(`document.querySelectorAll('.mrow .up')[1].click()`);
  console.log('riordino  :', await ev(`mlist.map(name).join(' > ')`));
  await shot('5-unisci');
  await run(`go()`); await finish();
  console.log('risultato :', await result(), '|', made(/unione/));
  win.destroy(); await wait(400);

  await open([f1, f2], 'dx:clean');
  console.log('più file  :', await ev(`'vista: ' + (listView.classList.contains('on') ? 'elenco' : '?')`));
  await run(`go()`); await finish();
  console.log('pulisci x2:', await result());
  await shot('6-elenco');
  app.exit(0);
});
app.on('window-all-closed', () => {});
