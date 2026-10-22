// Prova la ruota con il vetro vero: scatta la foto dello schermo sotto la ruota (su una finestra di sfondo creata qui),
// mostra la ruota e cattura il risultato finale. Uso: npx electron tools/test-wheel-glass.js <file-output.png> [png|mp4]
const { app, BrowserWindow, desktopCapturer, screen, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
const glass = require('../src/wheel-glass');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const html = (s) => 'data:text/html;charset=utf-8,' + encodeURIComponent(s);
const kind = process.argv[3] || 'png';

// Sfondo che somiglia a quello del video: sfumatura calda con alcuni dettagli (per vedere la sfocatura)
const BACK = `<body style="margin:0;background:linear-gradient(165deg,#d49a2c 0%,#e0842f 30%,#ea5a3c 62%,#e8454c 80%,#a577b8 100%);font:700 54px Segoe UI;color:#fff">
  <div style="position:absolute;top:24px;left:30px">SFONDO DI PROVA</div>
  <div style="position:absolute;top:330px;left:0;width:700px;height:10px;background:#3a1a10;opacity:.7"></div>
  <div style="position:absolute;top:150px;left:560px;width:140px;height:140px;border-radius:50%;background:#2a5bd7"></div>
  <div style="position:absolute;bottom:40px;left:60px;font-size:90px">Aa 123</div></body>`;

app.whenReady().then(async () => {
  ipcMain.on('log', () => {}); ipcMain.on('hold', () => {});
  const back = new BrowserWindow({ x: 0, y: 0, width: 700, height: 700, frame: false, show: true, skipTaskbar: true, focusable: false, webPreferences: { sandbox: true } });
  await back.loadURL(html(BACK));
  await wait(600);
  const wheel = new BrowserWindow({ width: 620, height: 620, show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, sandbox: true } });
  await wheel.loadFile(path.join(__dirname, '..', 'src', 'wheel.html'));
  const bounds = { x: 40, y: 30, width: 620, height: 620 }; // tutto nella parte sinistra dello schermo
  wheel.setBounds(bounds);
  const t0 = Date.now();
  await glass.capture();
  const shot = await glass.latest(0);
  console.log('scatto:', shot ? `${shot.image.getSize().width}x${shot.image.getSize().height}` : 'FALLITO', 'in', Date.now() - t0, 'ms | scala', screen.getPrimaryDisplay().scaleFactor);
  const url = shot ? glass.cropUnder(shot, bounds) : null;
  console.log('ritaglio:', url ? Math.round(url.length / 1024) + ' KB' : 'nessuno');
  wheel.webContents.send('reset');
  wheel.webContents.send('glass', url);
  const mime = kind === 'mp4' ? 'video/mp4' : 'image/png';
  await wheel.webContents.executeJavaScript(`(() => { const dt = new DataTransfer(); dt.items.add(new File(['x'], 'f', { type: '${mime}' })); document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
    })(); 0`);
  await wait(400);
  await wheel.webContents.executeJavaScript(`(() => { document.querySelectorAll('.seg')[3].classList.add('hot'); document.querySelectorAll('.cseg')[1].classList.add('hot'); })(); 0`);
  wheel.showInactive();
  await wait(1500);
  const sc = screen.getPrimaryDisplay(), k = sc.scaleFactor;
  const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(sc.size.width * k), height: Math.round(sc.size.height * k) } });
  const crop = src[0].thumbnail.crop({ x: Math.round(30 * k), y: Math.round(20 * k), width: Math.round(640 * k), height: Math.round(640 * k) }); // solo la zona della ruota
  fs.writeFileSync(process.argv[2], crop.toPNG());
  app.exit(0);
});
app.on('window-all-closed', () => {});
