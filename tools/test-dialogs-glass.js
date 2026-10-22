// Cattura le finestre di lavoro (con il vetro) sopra uno sfondo colorato creato qui. Uso: npx electron tools/test-dialogs-glass.js <cartella>
const { app, BrowserWindow, desktopCapturer, screen, nativeTheme } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const { openTool } = require('../src/tools');
const { openVideoTool } = require('../src/video-tool');
const ff = require('../src/video/ffmpeg');
const { photo } = require('./fixture-photo');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const html = (s) => 'data:text/html;charset=utf-8,' + encodeURIComponent(s);

const BACK = `<body style="margin:0;background:linear-gradient(135deg,#e8402f 0%,#f08a3a 30%,#e3b13c 50%,#c46a8c 78%,#8b6fc0 100%);font:700 70px Segoe UI;color:#fff">
  <div style="position:absolute;top:40px;left:40px">SFONDO DI PROVA</div><div style="position:absolute;top:140px;left:0;right:0;height:14px;background:#111"></div>
  <div style="position:absolute;top:300px;left:900px;width:260px;height:260px;border-radius:50%;background:#1d4ed8"></div>
  <div style="position:absolute;bottom:60px;left:60px;font-size:110px">Aa 123</div></body>`;

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const sc = screen.getPrimaryDisplay(), k = sc.scaleFactor, W = sc.size.width, H = sc.size.height;
  const small = process.env.SMALL === '1';
  const back = new BrowserWindow({ x: small ? 20 : 0, y: small ? 20 : 0, width: small ? 1300 : W, height: small ? 800 : H, frame: false, show: true, skipTaskbar: true, focusable: false, webPreferences: { sandbox: true } });
  await back.loadURL(html(BACK));
  await wait(500);

  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-dlg-'));
  const f0 = photo(33);
  const img = path.join(d, 'foto.png'); fs.copyFileSync(f0, img);
  const vid = path.join(d, 'prova.mp4');
  spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20', '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', vid]);

  const known = new Set([back.id]);
  const newest = () => BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !known.has(w.id));
  const shot = async (win, name, x, y) => {
    win.setBounds({ x, y, width: Math.min(win.getBounds().width, W - x - 10), height: Math.min(win.getBounds().height, H - y - 10) });
    win.focus(); await wait(1800);
    console.log(name, '| attiva:', win.isFocused(), '| scuro:', nativeTheme.shouldUseDarkColors);
    const src = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(W * k), height: Math.round(H * k) } });
    const full = src[0].thumbnail, sz = full.getSize();
    fs.writeFileSync(path.join(OUT, `dlg-${name}.png`), full.crop({ x: 0, y: 0, width: sz.width, height: Math.round(sz.height - 52 * k) }).toPNG()); // senza barra delle applicazioni
    known.add(win.id); win.destroy(); await wait(300);
  };

  await openTool('crop', [img]); await wait(1200); await shot(newest(), 'crop', 120, 40);
  if (process.env.ONLYCROP !== '1') {
    await openTool('resize', [img]); await wait(800); await shot(newest(), 'resize', 300, 120);
    await openVideoTool([vid], 'vid:convert:mkv'); await wait(1500); await shot(newest(), 'video', 100, 20);
    await openTool('removebg', [img]); await wait(6000); await shot(newest(), 'removebg', 100, 20);
  }
  app.exit(0);
});
app.on('window-all-closed', () => {});
