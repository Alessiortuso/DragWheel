// Prova la finestra "Fogli di calcolo" con file generati qui. Uso: npx electron tools/test-sheet-ui.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
app.disableHardwareAcceleration();
const { ExcelJS } = require('../src/sheet/book');
const { openSheetTool } = require('../src/sheet-tool');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sui-'));
  const mk = async (name, rows, extra = (wb) => {}) => {
    const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Ordini');
    ws.addRow(['ID', 'Cliente', 'Regione', 'Importo']).font = { bold: true };
    rows.forEach((r) => ws.addRow(r)); extra(wb);
    const f = path.join(d, name); await wb.xlsx.writeFile(f); return f;
  };
  const v1 = await mk('vendite.xlsx', [[1, 'Rossi', 'Nord', 100], [2, 'Bianchi', 'Sud', 200], [3, 'Verdi', 'Nord', 300], [4, 'Neri', 'Centro', 50], [4, 'Neri', 'Centro', 50], [], [5, '  Gialli ', 'Sud', 75]],
    (wb) => { wb.addWorksheet('Note').addRow(['x', 'y']); });
  const v2 = await mk('vendite v2.xlsx', [[1, 'Rossi', 'Nord', 100], [2, 'Bianchi', 'Sud', 250], [3, 'Verdi', 'Nord', 300], [6, 'Blu', 'Nord', 10]]);
  const c1 = path.join(d, 'gen.csv'), c2 = path.join(d, 'feb.csv');
  fs.writeFileSync(c1, 'Nome;Importo\r\nAnna;10,5\r\nBruno;20\r\n'); fs.writeFileSync(c2, 'Nome;Importo\r\nCarla;30\r\n');

  let win;
  const open = async (files, preset) => { await openSheetTool(files, preset); win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle().startsWith('Fogli')) || BrowserWindow.getAllWindows().slice(-1)[0]; await wait(2500); };
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  const shot = async (n) => { await wait(400); fs.writeFileSync(path.join(OUT, `sheet-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); while ((await ev('running')) && Date.now() - t < 60000) await wait(200); await wait(300); };
  const result = () => ev(`[...document.querySelectorAll('#result .card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim().replace(/Apri cartella.*$/, '')).join(' || ')`);
  const made = (re) => fs.readdirSync(d).filter((n) => re.test(n)).sort().join(', ');

  await open([v1], 'xl:convert:csv');
  console.log('anteprima :', await ev(`info.sheets.map((s) => s.name + ' ' + s.rows + 'x' + s.cols).join(', ') + ' | celle visibili: ' + document.querySelectorAll('#gridBox td').length + ' | formati: ' + [...$('cvTarget').options].map((o) => o.value).join('/') + ' | scelto: ' + $('cvTarget').value`));
  await shot('1-converti');
  await run(`go()`); await finish();
  console.log('converti  :', await result(), '|', made(/\.csv$/));
  await run(`$('cvTarget').value = 'json'; $('cvTarget').dispatchEvent(new Event('change')); go()`); await finish();
  console.log('json      :', await result());

  await run(`setOp('split'); document.querySelector('[name=smode][value=column]').checked = true; splitPanel()`);
  console.log('dividi    :', await ev(`'colonne: ' + [...$('spCol').options].map((o) => o.value).join(', ') + ' | fogli: ' + [...$('spSheet').options].map((o) => o.value).join(', ')`));
  await run(`$('spCol').value = 'Regione'`); await shot('2-dividi');
  await run(`go()`); await finish();
  console.log('per regione:', await result(), '|', made(/ - (Nord|Sud|Centro)\.xlsx/));
  await run(`document.querySelector('[name=smode][value=sheet]').checked = true; splitPanel(); go()`); await finish();
  console.log('per foglio:', await result());

  await run(`setOp('clean'); $('clDup').checked = true; $('clHidden').checked = true`); await shot('3-pulisci');
  await run(`go()`); await finish();
  console.log('pulisci   :', await result(), '|', made(/pulito/));
  win.destroy(); await wait(400);

  await open([c1, c2], 'xl:merge');
  console.log('unisci    :', await ev(`mlist.map(name).join(' > ') + ' | vista: ' + (mergeView.classList.contains('on') ? 'elenco da unire' : '?')`));
  await run(`document.querySelectorAll('.mrow .up')[1].click()`);
  console.log('riordino  :', await ev(`mlist.map(name).join(' > ')`));
  await shot('4-unisci');
  await run(`go()`); await finish();
  console.log('risultato :', await result(), '|', made(/unione/));
  win.destroy(); await wait(400);

  await open([v1, v2], 'xl:diff');
  console.log('confronta :', await ev(`'A=' + name(dA) + ' B=' + name(dB) + ' | chiavi: ' + [...$('dKey').options].map((o) => o.value).join(', ')`));
  await run(`document.querySelector('[name=dmode][value=key]').checked = true; document.querySelector('[name=dmode][value=key]').dispatchEvent(new Event('change')); $('dKey').value = 'ID'`);
  await shot('5-confronta');
  await run(`go()`); await finish();
  console.log('differenze:', await result());
  app.exit(0);
});
app.on('window-all-closed', () => {});
