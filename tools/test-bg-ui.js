// Prova la finestra "Rimuovi sfondo" con un'immagine della cartella Download (copiata in temp: l'originale non si tocca)
// Uso: npx electron tools/test-bg-ui.js <cartella-screenshot> <indice>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { openTool } = require('../src/tools');
const { photo } = require('./fixture-photo');

const OUT = process.argv[2], idx = +process.argv[3];
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const f0 = photo(idx);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const file = path.join(d, 'foto.png'); fs.copyFileSync(f0, file);
  await openTool('removebg', [file]);
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (n) => { await wait(300); fs.writeFileSync(path.join(OUT, `bg-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const t0 = Date.now();
  while (await ev(`document.getElementById('save').disabled`) && Date.now() - t0 < 120000) await wait(300);
  console.log('analisi pronta dopo', Date.now() - t0, 'ms |', await ev(`document.getElementById('status').textContent`));
  await shot('1-pronto');
  // pennello: cancella una striscia e ripristina un'altra
  const stroke = (mode, x1, y1, x2, y2) => run(`
    setTool('${mode}'); $('size').value = 60; $('size').dispatchEvent(new Event('input'));
    const r = view.getBoundingClientRect(); const P = (x, y) => ({ clientX: r.left + V.tx + x * V.s, clientY: r.top + V.ty + y * V.s, pointerId: 1, button: 0, bubbles: true });
    view.setPointerCapture = () => {};
    view.dispatchEvent(new PointerEvent('pointerdown', P(${x1}, ${y1}))); view.dispatchEvent(new PointerEvent('pointermove', P(${x2}, ${y2}))); view.dispatchEvent(new PointerEvent('pointerup', P(${x2}, ${y2})));`);
  const info = () => ev(`[edits, undoStack.length, W + 'x' + H].join(' ')`);
  await stroke('erase', 100, 200, 300, 200); console.log('dopo cancella  ', await info());
  await stroke('restore', 100, 500, 300, 500); console.log('dopo ripristina', await info());
  await run(`undo()`); console.log('dopo annulla   ', await info());
  await run(`redo()`); console.log('dopo ripeti    ', await info());
  await run(`$('edge').value = -2; $('edge').dispatchEvent(new Event('input')); $('blur').value = 1; $('blur').dispatchEvent(new Event('input'))`); await wait(500);
  await run(`document.querySelector('#sw i:nth-child(5)').click()`); await shot('2-ritoccato');
  await run(`save()`);
  const t1 = Date.now();
  while (!(await ev(`document.getElementById('reveal').style.display === ''`)) && Date.now() - t1 < 120000) await wait(300);
  console.log('salvato dopo', Date.now() - t1, 'ms |', await ev(`document.getElementById('status').textContent`));
  const out = fs.readdirSync(d).find((n) => n.includes('No Background'));
  const m = await sharp(path.join(d, out)).metadata();
  const { data } = await sharp(path.join(d, out)).raw().toBuffer({ resolveWithObject: true });
  let tr = 0; for (let i = 3; i < data.length; i += 4) if (data[i] < 10) tr++;
  console.log('file', out, `${m.width}x${m.height}`, 'canali', m.channels, '| trasparente', Math.round(100 * tr / (m.width * m.height)) + '%');
  fs.copyFileSync(path.join(d, out), path.join(OUT, 'bg-risultato.png'));
  app.exit(0);
});
app.on('window-all-closed', () => {});
