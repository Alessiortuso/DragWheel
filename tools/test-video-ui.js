// Prova la finestra Video con un filmato generato da ffmpeg, azionando l'interfaccia vera.
// Uso: npx electron tools/test-video-ui.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
app.disableHardwareAcceleration(); // la cattura dello schermo funziona anche col display spento/bloccato
const ff = require('../src/video/ffmpeg');
const { openVideoTool } = require('../src/video-tool');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-vui-'));
  const file = path.join(d, 'prova.mp4');
  const r = spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=20', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=20',
    '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', '-b:v', '2M', '-c:a', 'aac', '-shortest', file]);
  if (r.status) throw new Error(String(r.stderr));
  await openVideoTool([file], 'vid:convert:mkv');
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(OUT, `video-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); while ((await ev(`running`)) && Date.now() - t < 120000) await wait(200); await wait(300); };
  const result = () => ev(`[...document.querySelectorAll('#result .card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()).join(' || ')`);
  await wait(1200);
  console.log('info      :', await ev(`$('info').textContent`));
  console.log('scheda    :', await ev(`op + ' / formato ' + $('cvTarget').value + ' / nota: ' + $('cvCopyNote').textContent`));
  await shot('1-converti');

  await run(`go()`); await finish();
  console.log('converti  :', await result());

  await run(`setOp('convert'); $('cvTarget').value = 'gif'; $('cvTarget').dispatchEvent(new Event('change')); setSel(3, 6); $('useSel').checked = true; $('useSel').dispatchEvent(new Event('change'));`);
  await shot('2-gif');
  await run(`go()`); await finish();
  console.log('gif       :', await result());

  await run(`setOp('cut'); setSel(5, 12.5); seek(8);`); await shot('3-taglia');
  await run(`go()`); await finish();
  console.log('taglia    :', await result());

  await run(`setOp('frames'); document.querySelector('[name=fmode][value=interval]').checked = true; $('frEvery').value = '4'; $('frEvery').dispatchEvent(new Event('input'));`); await shot('4-fotogrammi');
  await run(`go()`); await finish();
  console.log('fotogrammi:', await result());

  await run(`setOp('compress'); document.querySelector('[name=cmode][value=size]').checked = true; $('cpMB').value = '1,2'; $('cpMB').dispatchEvent(new Event('input'));`); await shot('5-comprimi');
  await run(`go()`); await finish();
  console.log('comprimi  :', await result());

  await run(`setOp('resize'); rzSet('height', 360);`); await shot('6-ridimensiona');
  await run(`go()`); await finish();
  console.log('ridimens. :', await result());

  console.log('file creati:', fs.readdirSync(d).join(', '));
  app.exit(0);
});
app.on('window-all-closed', () => {});
