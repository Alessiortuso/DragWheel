// Prova la finestra Audio con file generati da ffmpeg, azionando l'interfaccia vera. Uso: npx electron tools/test-audio-ui.js <cartella-screenshot>
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
app.disableHardwareAcceleration();
const ff = require('../src/video/ffmpeg');
const { openAudioTool } = require('../src/audio-tool');
const OUT = process.argv[2];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-aui-'));
  const gen = (name, expr, extra = []) => { const f = path.join(d, name); const r = spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', expr, ...extra, f]); if (r.status) throw new Error(String(r.stderr)); return f; };
  const song = gen('canzone.mp3', 'sine=frequency=440:duration=30:sample_rate=44100,tremolo=f=0.5:d=0.9', ['-ac', '2', '-b:a', '192k']);
  const b = gen('brano B.wav', 'sine=frequency=660:duration=10', ['-ar', '48000']);
  const c = gen('brano C.flac', 'sine=frequency=880:duration=6');

  let win;
  const open = async (files, preset) => { await openAudioTool(files, preset); win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle().startsWith('Audio')) || BrowserWindow.getAllWindows().slice(-1)[0]; await wait(1500); };
  const ev = (code) => win.webContents.executeJavaScript(code);
  const run = (code) => ev(`(() => { ${code} })(); 0`);
  const shot = async (n) => { await wait(500); fs.writeFileSync(path.join(OUT, `audio-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); while ((await ev('running')) && Date.now() - t < 120000) await wait(200); await wait(300); };
  const result = () => ev(`[...document.querySelectorAll('#result .card')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim()).join(' || ')`);
  const dur = async (f) => (await ff.probe(f)).duration.toFixed(2);

  // ---- taglio di più parti
  await open([song], 'aud:cut');
  console.log('info      :', await ev(`$('info').textContent`));
  console.log('onda      :', await ev(`peaks ? peaks.buckets + ' intervalli' : 'NON CARICATA'`), '| parti iniziali:', await ev(`regions.length`));
  const drag = (t1, t2) => run(`const r = cv.getBoundingClientRect(); const P = (t) => ({ clientX: r.left + t2x(t), clientY: r.top + 60, pointerId: 1, bubbles: true });
    cv.setPointerCapture = () => {}; cv.dispatchEvent(new PointerEvent('pointerdown', P(${t1}))); cv.dispatchEvent(new PointerEvent('pointermove', P((${t1} + ${t2}) / 2))); cv.dispatchEvent(new PointerEvent('pointermove', P(${t2}))); cv.dispatchEvent(new PointerEvent('pointerup', P(${t2})));`);
  await run(`clearSegs.click()`);
  await drag(2, 6); await drag(10, 13.5); await drag(20, 28);
  console.log('parti     :', await ev(`regions.map((r) => r.start.toFixed(1) + '-' + r.end.toFixed(1)).join(', ')`));
  await run(`const r = regions[1]; const x = t2x(r.end); cv.dispatchEvent(new PointerEvent('pointerdown', { clientX: cv.getBoundingClientRect().left + x, clientY: cv.getBoundingClientRect().top + 60, pointerId: 1, bubbles: true }));
    cv.dispatchEvent(new PointerEvent('pointermove', { clientX: cv.getBoundingClientRect().left + t2x(15), clientY: cv.getBoundingClientRect().top + 60, pointerId: 1, bubbles: true })); cv.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));`);
  console.log('dopo bordo:', await ev(`regions.map((r) => r.start.toFixed(1) + '-' + r.end.toFixed(1)).join(', ')`), '(la seconda parte ora finisce a 15)');
  await shot('1-taglia');
  await run(`go()`); await finish();
  console.log('taglio    :', await result());
  const parts = fs.readdirSync(d).filter((n) => /parte/.test(n)).sort();
  console.log('file      :', (await Promise.all(parts.map(async (n) => `${n} ${await dur(path.join(d, n))}s`))).join(' | '));
  await run(`document.querySelector('[name=cmode][value=join]').checked = true; document.querySelector('[name=cmode][value=join]').dispatchEvent(new Event('change')); $('cutXf').value = '250'`);
  await run(`go()`); await finish();
  console.log('unito     :', await result(), '|', await dur(path.join(d, fs.readdirSync(d).find((n) => /parti unite/.test(n)))), 's (attesi 4+5+8 = 17 meno 2 x 0,25 = 16,5)');
  await run(`document.querySelector('[name=cmode][value=remove]').checked = true; document.querySelector('[name=cmode][value=remove]').dispatchEvent(new Event('change'))`);
  await run(`go()`); await finish();
  console.log('elimina   :', await result(), '|', await dur(path.join(d, fs.readdirSync(d).find((n) => /\(modificato\)/.test(n)))), 's (attesi 30 - 17 = 13)');
  win.destroy(); await wait(500);

  // ---- unione di tre file con riordino
  await open([song, b, c], 'aud:merge');
  console.log('elenco    :', await ev(`mlist.map((m) => name(m.path)).join(' > ')`));
  await run(`document.querySelectorAll('.mrow .dn')[0].click()`); // sposta il primo giù: B, canzone, C
  await run(`document.querySelectorAll('.mrow .up')[2].click()`); // sposta C su: B, C, canzone
  console.log('dopo riordino:', await ev(`mlist.map((m) => name(m.path)).join(' > ')`), '|', await ev(`$('mSum').textContent`));
  await run(`$('mGap').value = '1'; $('mGap').dispatchEvent(new Event('input')); $('mergeFmt').value = 'flac'; $('mergeFmt').dispatchEvent(new Event('change')); $('mTitle').value = 'Prova unione'`);
  await shot('2-unisci');
  await run(`go()`); await finish();
  const merged = fs.readdirSync(d).find((n) => /\(unione\)/.test(n));
  console.log('unione    :', await result(), '|', merged, await dur(path.join(d, merged)), 's (attesi 10+6+30 + 2 pause = 48)', '| titolo:', (await ff.probe(path.join(d, merged))).tags.title);
  win.destroy(); await wait(500);

  // ---- conversione di più file + volume
  await open([song, b, c], 'aud:convert:m4a');
  console.log('schede    :', await ev(`op + ' | taglia disattivato: ' + document.querySelector('#tabs [data-op=cut]').disabled + ' | vista: ' + (listView.classList.contains('on') ? 'elenco' : 'onda')`));
  await run(`go()`); await finish();
  console.log('converti 3:', await ev(`[...document.querySelectorAll('.f')].map((r) => r.querySelector('span').textContent + ' => ' + r.querySelector('.st').textContent).join(' | ')`));
  await run(`setOp('volume'); $('vNorm').checked = true; $('vNorm').dispatchEvent(new Event('change')); $('vFi').value = '1'; $('vSpeed').value = '1.25'`);
  await shot('3-volume-multi');
  await run(`go()`); await finish();
  console.log('volume    :', await ev(`[...document.querySelectorAll('.f')].map((r) => r.querySelector('span').textContent + ' => ' + r.querySelector('.st').textContent).join(' | ')`));
  console.log('creati    :', fs.readdirSync(d).filter((n) => /m4a|modificato/.test(n)).join(', '));
  app.exit(0);
});
app.on('window-all-closed', () => {});
