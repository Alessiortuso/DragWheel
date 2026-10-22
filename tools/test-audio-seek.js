// Prova lo spostamento del cursore e la panoramica nella finestra Audio. Uso: npx electron tools/test-audio-seek.js <cartella-screenshot>
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-seek-'));
  const f = path.join(d, 'canzone.mp3');
  spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30,tremolo=f=0.5:d=0.9', '-ac', '2', f]);
  await openAudioTool([f], 'aud:cut');
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  await wait(1800);
  const ev = (c) => win.webContents.executeJavaScript(c);
  const run = (c) => ev(`(() => { ${c} })(); 0`);
  let fail = 0;
  const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
  const st = () => ev(`({ cur: +cur.toFixed(2), n: regions.length, r: regions.map((r) => [+r.start.toFixed(2), +r.end.toFixed(2)]), sel: selId, v: [+view.t0.toFixed(2), +view.t1.toFixed(2)] })`);
  // eventi su cv: tempo t, altezza "ruler" (in alto) o "onda"
  const ptr = (type, t, where = 'onda') => run(`const r = cv.getBoundingClientRect(); cv.setPointerCapture = () => {};
    cv.dispatchEvent(new PointerEvent('${type}', { clientX: r.left + t2x(${t}), clientY: r.top + ${where === 'ruler' ? 8 : 90}, pointerId: 1, bubbles: true }));`);
  const click = async (t, where) => { await ptr('pointerdown', t, where); await ptr('pointerup', t, where); };
  const dragTo = async (t1, t2, where) => { await ptr('pointerdown', t1, where); await ptr('pointermove', (t1 + t2) / 2, where); await ptr('pointermove', t2, where); await ptr('pointerup', t2, where); };

  await run(`clearSegs.click()`);
  await dragTo(5, 15);
  let s = await st(); ok('creo una parte 5-15', s.n === 1 && Math.abs(s.r[0][0] - 5) < 0.2 && Math.abs(s.r[0][1] - 15) < 0.2, JSON.stringify(s.r));
  const region = s.r[0];

  await click(10); s = await st();
  ok('clic DENTRO la parte: sposta il cursore', Math.abs(s.cur - 10) < 0.15, `cursore a ${s.cur}`);
  ok('...senza spostare né cancellare la parte', s.n === 1 && s.r[0][0] === region[0] && s.r[0][1] === region[1], JSON.stringify(s.r));

  await click(25); s = await st();
  ok('clic in uno spazio vuoto: sposta il cursore e non crea parti', Math.abs(s.cur - 25) < 0.15 && s.n === 1, `cursore a ${s.cur}, parti ${s.n}`);

  await click(20, 'ruler'); s = await st();
  ok('clic sulla fascia dei tempi (anche sopra una parte)', Math.abs(s.cur - 20) < 0.15, `cursore a ${s.cur}`);
  await click(8, 'ruler'); s = await st();
  ok('...dentro una parte', Math.abs(s.cur - 8) < 0.15 && s.r[0][0] === region[0], `cursore a ${s.cur}`);

  await dragTo(8, 12.5); s = await st(); // il cursore è a 8: afferro la linea nera dentro la parte e la trascino
  ok('trascino la linea nera dentro la parte', Math.abs(s.cur - 12.5) < 0.2 && s.r[0][0] === region[0] && s.r[0][1] === region[1], `cursore a ${s.cur}, parte invariata ${JSON.stringify(s.r)}`);

  await dragTo(6.5, 9); s = await st(); // trascino la parte stessa (il cursore è lontano)
  ok('trascinando la parte (non la linea) la sposto', s.r[0][0] > region[0] + 1.5 && Math.abs((s.r[0][1] - s.r[0][0]) - (region[1] - region[0])) < 0.05, `parte ora ${JSON.stringify(s.r)}`);

  // panoramica
  await run(`const r = mini.getBoundingClientRect(); mini.setPointerCapture = () => {}; const M = (type, f) => mini.dispatchEvent(new PointerEvent(type, { clientX: r.left + f * mW, clientY: r.top + 20, pointerId: 1, bubbles: true }));
    window.__M = M; M('pointerdown', 0.4); M('pointerup', 0.4);`);
  s = await st(); ok('clic sulla panoramica a 40%: cursore a 12 s', Math.abs(s.cur - 12) < 0.5, `cursore a ${s.cur}`);
  await run(`zoom(10, 0.2)`); s = await st();
  ok('zoom: la vista si restringe', s.v[1] - s.v[0] < 8, `vista ${s.v[0]}–${s.v[1]} s`);
  await run(`__M('pointerdown', 0.8); __M('pointerup', 0.8)`); s = await st();
  ok('clic sulla panoramica fuori dalla zona visibile: il cursore va lì e la vista lo segue', Math.abs(s.cur - 24) < 0.5 && s.v[0] <= s.cur && s.cur <= s.v[1], `cursore ${s.cur}, vista ${s.v[0]}–${s.v[1]}`);
  const before = s.v[0];
  await run(`const mid = (view.t0 + view.t1) / 2 / dur; __M('pointerdown', mid); __M('pointermove', mid - 0.3); __M('pointerup', mid - 0.3)`); s = await st();
  ok('trascino la zona visibile nella panoramica: la vista scorre', s.v[0] < before - 3, `vista ${before} → ${s.v[0]}`);
  await run(`zAll.click()`);
  await run(`setOp('convert')`); await run(`__M('pointerdown', 0.1); __M('pointerup', 0.1)`); s = await st();
  ok('anche nelle altre schede la barra sposta il cursore', Math.abs(s.cur - 3) < 0.5, `cursore a ${s.cur}`);
  await run(`setOp('cut')`);
  await run(`zoom(15, 0.3)`);
  await wait(400);
  fs.writeFileSync(path.join(OUT, 'audio-seek.png'), (await win.webContents.capturePage()).toPNG());
  console.log(fail ? `\n${fail} FALLITI` : '\nTUTTO OK');
  app.exit(fail ? 1 : 0);
});
app.on('window-all-closed', () => {});
