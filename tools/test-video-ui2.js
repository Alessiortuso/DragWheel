// Più video insieme + interruzione di un'operazione lunga. Uso: npx electron tools/test-video-ui2.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
app.disableHardwareAcceleration();
const ff = require('../src/video/ffmpeg');
const { openVideoTool } = require('../src/video-tool');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-vui-'));
  const mk = (name, size, dur) => { const f = path.join(d, name); const r = spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=30:duration=${dur}`, '-f', 'lavfi', '-i', `sine=frequency=330:duration=${dur}`, '-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-shortest', f]); if (r.status) throw new Error(String(r.stderr)); return f; };
  const files = [mk('uno.mp4', '1280x720', 8), mk('due.mp4', '854x480', 6), path.join(d, 'rotto.mp4')];
  fs.writeFileSync(files[2], 'questo non è un video');
  await openVideoTool(files, 'vid:resize');
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(OUT, `video2-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); while ((await ev(`running`)) && Date.now() - t < 120000) await wait(200); await wait(300); };
  await wait(1200);
  console.log('tab attiva:', await ev(`op`), '| Taglia e Fotogrammi disattivate:', await ev(`document.querySelector('#tabs [data-op=cut]').disabled && document.querySelector('#tabs [data-op=frames]').disabled`));
  await run(`rzSet('height', 360)`); await shot('1-lista');
  await run(`go()`); await finish(); await shot('2-fine');
  console.log('righe     :', await ev(`[...document.querySelectorAll('.f')].map((r) => r.querySelector('span').textContent + ' => ' + r.querySelector('.st').textContent).join(' | ')`));
  console.log('creati    :', fs.readdirSync(d).filter((n) => n.includes('360p')).join(', '));
  // interruzione: converti in WEBM alta qualità e premi Interrompi
  await run(`setOp('convert'); $('cvTarget').value = 'webm'; $('cvTarget').dispatchEvent(new Event('change')); $('cvQuality').value = 'high'; $('cvCopy').checked = false; go()`);
  await wait(1500); await shot('3-in-corso');
  console.log('durante   :', await ev(`running + ' | ' + $('ptxt').textContent + ' | Interrompi visibile: ' + ($('stop').style.display !== 'none')`));
  await run(`$('stop').click()`); await finish();
  console.log('dopo stop :', await ev(`[...document.querySelectorAll('#result .card')].map((c) => c.textContent.trim().slice(0, 70)).join(' || ')`));
  console.log('webm rimasti:', fs.readdirSync(d).filter((n) => n.endsWith('.webm')).length);
  app.exit(0);
});
app.on('window-all-closed', () => {});
