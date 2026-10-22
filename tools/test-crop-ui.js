// Apre la finestra di ritaglio su un'immagine di prova e simula trascinamenti; salva screenshot e verifica il risultato.
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { openTool } = require('../src/tools');

const OUT = process.argv[2];
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const svg = '<svg width="1600" height="1000" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"><stop offset="0" stop-color="#f5a623"/><stop offset="1" stop-color="#7b61d6"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/><circle cx="800" cy="500" r="300" fill="#fff8"/><text x="800" y="530" font-size="120" text-anchor="middle" fill="#222">1600x1000</text></svg>';
  const file = path.join(d, 'foto.png');
  await sharp(Buffer.from(svg)).png().toFile(file);
  await openTool('crop', [file]);
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (code) => win.webContents.executeJavaScript(code);
  const run = (code) => ev(`(() => { ${code} })(); 0`); // niente valore di ritorno: potrebbe non essere clonabile
  const shot = async (n) => { await new Promise((r) => setTimeout(r, 250)); fs.writeFileSync(path.join(OUT, `crop-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const state = () => ev(`[wIn.value, hIn.value, Math.round(rect.x), Math.round(rect.y)].join(',')`);
  await new Promise((r) => setTimeout(r, 600));
  // helper: pointer su stage in coordinate immagine
  await run(`window.ptr = (type, ix, iy, target) => { const r = stage.getBoundingClientRect(); (target || stage).dispatchEvent(new PointerEvent(type, { clientX: r.left + ix * k, clientY: r.top + iy * k, pointerId: 1, bubbles: true })); };
    stage.setPointerCapture = () => {};`);
  console.log('iniziale        ', await state());
  await run(`document.querySelector('[data-r="16:9"]').click()`);
  console.log('16:9            ', await state()); await shot('1-16x9');
  // sposta il riquadro di 100 px a destra e 50 in basso
  await run(`ptr('pointerdown', 800, 500, box); ptr('pointermove', 900, 550); ptr('pointerup', 900, 550);`);
  console.log('spostato        ', await state());
  // ridimensiona dalla maniglia in basso a destra (ratio 16:9 deve restare)
  await run(`const o = rect; ptr('pointerdown', o.x + o.w, o.y + o.h, box.querySelector('.h.se')); ptr('pointermove', o.x + o.w - 400, o.y + o.h - 300); ptr('pointerup', 0, 0);`);
  const s = (await state()).split(',').map(Number);
  console.log('maniglia SE     ', s.join(','), 'rapporto', (s[0] / s[1]).toFixed(3), '(atteso 1.778)'); await shot('2-ridimensionato');
  // campo larghezza
  await run(`wIn.value = 640; wIn.dispatchEvent(new Event('input'))`);
  console.log('W=640 (16:9)    ', await state());
  // libero + oltre i bordi
  await run(`document.querySelector('[data-r="free"]').click(); const o = rect; ptr('pointerdown', o.x + o.w, o.y + o.h, box.querySelector('.h.se')); ptr('pointermove', 99999, 99999); ptr('pointerup', 0, 0);`);
  console.log('SE oltre bordo  ', await state(), '(non deve superare 1600x1000 con x,y)');
  await run(`reset.click()`);
  await run(`document.querySelector('[data-r="1:1"]').click()`);
  console.log('1:1 da reset    ', await state());
  await run(`rect = { x: 100, y: 100, w: 800, h: 600 }; draw();`);
  await shot('3-libero');
  await run(`apply()`);
  await new Promise((r) => setTimeout(r, 700));
  const out = fs.readdirSync(d).filter((f) => f.includes('Cropped'));
  const m = out[0] && await sharp(path.join(d, out[0])).metadata();
  console.log('file creato     ', out, m && `${m.width}x${m.height}`);
  app.exit(0);
});
app.on('window-all-closed', () => {});
