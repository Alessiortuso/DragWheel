// Collaudo delle operazioni sui video con filmati generati da ffmpeg. Uso: node tools/test-video.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const ff = require('../src/video/ffmpeg');
const jobs = require('../src/video/jobs');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-vid-'));
const gen = (name, extra) => {
  const f = path.join(d, name);
  const r = spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...extra, f]);
  if (r.status) throw new Error(r.stderr.toString());
  return f;
};
const src = gen('clip.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12',
  '-c:v', 'libx264', '-preset', 'veryfast', '-g', '30', '-b:v', '3M', '-c:a', 'aac', '-shortest']);
const odd = gen('odd.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=642x362:rate=25:duration=4', '-vf', 'crop=641:361', '-c:v', 'libx264', '-pix_fmt', 'yuv444p']); // 641x361: dimensioni dispari
const mute = gen('mute.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=25:duration=4', '-c:v', 'libx264']);

let fail = 0;
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK      ' : 'FALLITO ') + name + (extra ? ' - ' + extra : '')); if (!cond) fail++; };
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';

async function go(op, file, options) {
  const p = await ff.probe(file);
  const pl = jobs.plan(op, file, p, options);
  const seen = [];
  const t0 = Date.now();
  const h = jobs.execute(pl, (v) => seen.push(v));
  const out = await h.promise;
  const mono = seen.every((v, i) => !i || v >= seen[i - 1] - 1e-9);
  return { out, seen, mono, ms: Date.now() - t0, plan: pl };
}

(async () => {
  const P = await ff.probe(src);
  ok('probe', P.width === 1280 && P.height === 720 && Math.abs(P.duration - 12) < 0.3 && P.hasAudio && P.vcodec === 'h264',
    `${P.width}x${P.height} ${P.duration.toFixed(1)}s ${P.vcodec}/${P.acodec} ${P.fps}fps`);

  console.log('--- converti');
  const conv = [['mkv', {}], ['mov', {}], ['webm', { range: { start: 0, end: 4 } }], ['mkv', { copy: false }], ['mp3', {}], ['wav', {}], ['m4a', {}],
    ['gif', { range: { start: 2, end: 5 }, gif: { fps: 10, width: 320 } }]];
  for (const [target, extra] of conv) {
    const r = await go('convert', src, { target, quality: 'medium', ...extra });
    const q = await ff.probe(r.out[0]).catch(() => ({}));
    ok(target + (extra.copy === false ? ' (ricodifica)' : ''), fs.existsSync(r.out[0]) && r.mono,
      `${path.basename(r.out[0])} ${kb(r.out[0])} ${q.vcodec || '-'}/${q.acodec || '-'} ${q.width || ''}x${q.height || ''} ${q.duration ? q.duration.toFixed(1) + 's' : ''} ${r.plan.copy ? '[copia senza ricodifica]' : ''} in ${r.ms} ms`);
  }

  console.log('--- comprimi');
  const sizes = {};
  for (const level of ['light', 'strong']) {
    const r = await go('compress', src, { mode: 'quality', level });
    sizes[level] = fs.statSync(r.out[0]).size;
    ok('qualita ' + level, r.mono && r.seen.at(-1) === 1, kb(r.out[0]));
  }
  ok('forte < leggera', sizes.strong < sizes.light);
  const r2 = await go('compress', src, { mode: 'size', sizeMB: 1.5, maxHeight: 480 });
  const sz = fs.statSync(r2.out[0]).size / 1048576;
  ok('dimensione obiettivo 1,5 MB', sz > 1.1 && sz < 1.7 && r2.mono, `ottenuti ${sz.toFixed(2)} MB (${r2.plan.info}), ${r2.seen.length} aggiornamenti di progresso`);
  ok('file temporanei delle 2 passate rimossi', !fs.readdirSync(os.tmpdir()).some((n) => n.startsWith('dw-pass-')));
  for (const [o, label] of [[{ mode: 'size', sizeMB: 0.01 }, 'troppo piccola'], [{ mode: 'size', sizeMB: 500 }, 'gia piu piccolo']]) {
    try { jobs.plan('compress', src, P, o); ok('errore ' + label, false); } catch (e) { ok('errore ' + label, true, e.message); }
  }

  console.log('--- ridimensiona');
  const rs = [[{ height: 360 }, '640x360'], [{ percent: 50 }, '640x360'], [{ width: 320, height: 0, lock: true }, '320x180'],
    [{ width: 300, height: 300, lock: true }, '300x168'], [{ width: 400, height: 400, lock: false }, '400x400']];
  for (const [o, exp] of rs) {
    const r = await go('resize', src, o);
    const q = await ff.probe(r.out[0]);
    ok(JSON.stringify(o), `${q.width}x${q.height}` === exp && q.hasAudio, `${q.width}x${q.height} (atteso ${exp}), audio ${q.acodec}`);
  }
  const ro = await go('resize', odd, { height: 200 }).catch((e) => ({ err: e.message }));
  ok('video con dimensioni dispari', !ro.err, ro.err || '');

  console.log('--- taglia');
  const rc = await go('cut', src, { range: { start: 3.2, end: 8.2 }, precise: false });
  const qc = await ff.probe(rc.out[0]);
  ok('taglio veloce (copia)', qc.duration > 4.5 && qc.duration < 7.5, `${qc.duration.toFixed(2)} s (richiesti 5,00; parte dal fotogramma chiave precedente)`);
  const rp = await go('cut', src, { range: { start: 3.2, end: 8.2 }, precise: true });
  const qp = await ff.probe(rp.out[0]);
  ok('taglio preciso (ricodifica)', Math.abs(qp.duration - 5) < 0.15, `${qp.duration.toFixed(2)} s`);
  try { jobs.plan('cut', src, P, { range: { start: 0, end: 12 } }); ok('taglio senza selezione rifiutato', false); } catch (e) { ok('taglio senza selezione rifiutato', true, e.message); }

  console.log('--- fotogrammi');
  const f1 = await go('frames', src, { mode: 'single', time: 5.5, format: 'jpg' });
  const m = await sharp(f1.out[0]).metadata();
  ok('fotogramma singolo', m.width === 1280 && m.format === 'jpeg', `${path.basename(f1.out[0])} ${m.width}x${m.height}`);
  const fi = await go('frames', src, { mode: 'interval', every: 2, format: 'png' });
  const n1 = fs.readdirSync(fi.out[0]).length;
  ok('uno ogni 2 s su 12 s', n1 >= 6 && n1 <= 7, `${n1} file in "${path.basename(fi.out[0])}"`);
  const fc = await go('frames', src, { mode: 'count', count: 5, format: 'webp', range: { start: 2, end: 10 } });
  const n2 = fs.readdirSync(fc.out[0]).length;
  ok('5 fotogrammi totali', n2 === 5, `${n2} file`);

  console.log('--- errori e annullamento');
  try { jobs.plan('convert', mute, await ff.probe(mute), { target: 'mp3' }); ok('audio da video muto rifiutato', false); } catch (e) { ok('audio da video muto rifiutato', true, e.message); }
  try { await ff.probe(path.join(d, 'non-esiste.mp4')); ok('file inesistente', false); } catch (e) { ok('file inesistente', true, e.message.slice(0, 70)); }
  const before = fs.readdirSync(d).length;
  const pl = jobs.plan('convert', src, P, { target: 'webm', quality: 'high' });
  const h = jobs.execute(pl, () => {});
  setTimeout(() => h.cancel(), 1200);
  const res = await h.promise.then(() => 'finito', (e) => (e.cancelled ? 'annullato' : 'errore ' + e.message));
  ok('annullamento', res === 'annullato' && fs.readdirSync(d).length === before, `${res}; file parziali rimossi: ${fs.readdirSync(d).length === before}`);

  console.log(fail ? `\n${fail} FALLITI` : '\nTUTTO OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRORE', e); process.exit(1); });
