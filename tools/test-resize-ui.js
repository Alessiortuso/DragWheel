const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { openTool } = require('../src/tools');
const OUT = process.argv[2];
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const files = ['a.png', 'b.png'].map((n) => path.join(d, n));
  await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#3b82f6' } }).png().toFile(files[0]);
  await sharp({ create: { width: 1000, height: 1500, channels: 3, background: '#ee4b5b' } }).png().toFile(files[1]);
  await openTool('resize', [files[0]]);
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (c) => win.webContents.executeJavaScript(c);
  await new Promise((r) => setTimeout(r, 500));
  await ev(`w.value = 1920; w.dispatchEvent(new Event('input')); 0`);
  console.log('W=1920 ->', await ev(`w.value + 'x' + h.value + ' mode=' + mode`));
  fs.writeFileSync(path.join(OUT, 'resize.png'), (await win.webContents.capturePage()).toPNG());
  await ev(`apply(); 0`); await new Promise((r) => setTimeout(r, 800));
  console.log('1 file:', fs.readdirSync(d).filter((f) => f.includes('Resized')), (await sharp(path.join(d, fs.readdirSync(d).find((f) => f.includes('Resized')))).metadata()).width);
  // più immagini: percentuale 50
  await openTool('resize', files);
  const win2 = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  await new Promise((r) => setTimeout(r, 500));
  await win2.webContents.executeJavaScript(`document.querySelector('[data-p="50"]').click(); apply(); 0`);
  await new Promise((r) => setTimeout(r, 1200));
  const res = fs.readdirSync(d).filter((f) => f.includes('Resized'));
  for (const f of res) { const m = await sharp(path.join(d, f)).metadata(); console.log(' ', f, m.width + 'x' + m.height); }
  app.exit(0);
});
app.on('window-all-closed', () => {});
