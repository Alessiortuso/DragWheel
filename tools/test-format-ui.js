// Prova il selettore di formato nelle finestre Ritaglia e Rimuovi sfondo. Uso: npx electron tools/test-format-ui.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { openTool } = require('../src/tools');
const { photo } = require('./fixture-photo');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function pick(win, fmt, extra = '') {
  await win.webContents.executeJavaScript(`(() => { const s = document.querySelector('.fp-fmt'); s.value = '${fmt}'; s.dispatchEvent(new Event('change')); ${extra} })(); 0`);
}
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const f0 = photo(33);
  const file = path.join(d, 'foto.png'); fs.copyFileSync(f0, file);
  const shot = async (win, n) => { await wait(300); fs.writeFileSync(path.join(OUT, `fmt-${n}.png`), (await win.webContents.capturePage()).toPNG()); };

  // --- Ritaglia
  await openTool('crop', [file]); await wait(800);
  let win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  await pick(win, 'jpg'); await shot(win, 'crop-jpg');
  await win.webContents.executeJavaScript(`apply(); 0`); await wait(1500);
  console.log('ritaglio  ->', fs.readdirSync(d).filter((n) => n.includes('Cropped')).join(', '));
  win.destroy(); await wait(300);

  // --- Rimuovi sfondo
  await openTool('removebg', [file]);
  win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const t0 = Date.now();
  while (await win.webContents.executeJavaScript(`document.getElementById('save').disabled`) && Date.now() - t0 < 120000) await wait(300);
  await pick(win, 'jpg', `document.querySelector('.fp-bgc').value = '#2f6fed';`); await shot(win, 'bg-jpg');
  await win.webContents.executeJavaScript(`save(); 0`);
  while (!(await win.webContents.executeJavaScript(`document.getElementById('reveal').style.display === ''`)) && Date.now() - t0 < 200000) await wait(300);
  console.log('stato     ->', await win.webContents.executeJavaScript(`document.getElementById('status').textContent`));
  const out = fs.readdirSync(d).find((n) => n.includes('No Background'));
  const { data } = await sharp(path.join(d, out)).raw().toBuffer({ resolveWithObject: true });
  console.log('file      ->', out, '| pixel (0,0) =', [...data.slice(0, 3)], '(atteso 47,111,237 = #2f6fed)');
  app.exit(0);
});
app.on('window-all-closed', () => {});
