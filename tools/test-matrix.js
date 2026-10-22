// Prova TUTTE le combinazioni di conversione (ogni formato di ingresso verso ogni formato di uscita offerto) con file generati qui.
// PDF e fogli verso PDF servono Electron: vedi tools/test-matrix-electron.js. Uso: node tools/test-matrix.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const ff = require('../src/video/ffmpeg');
const audio = require('../src/audio/jobs');
const video = require('../src/video/jobs');
const { convert } = require('../src/converter');
const sheet = require('../src/sheet/ops');
const { ExcelJS } = require('../src/sheet/book');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-matrix-'));
let fail = 0, total = 0;
const ok = (n, c, extra = '') => { total++; if (!c) { fail++; console.log('FALLITO ' + n + (extra ? ' - ' + extra : '')); } };
const sub = (name) => { const p = path.join(d, name); fs.mkdirSync(p, { recursive: true }); return p; };
const gen = (dir, name, args) => { const f = path.join(dir, name); const r = spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, f]); if (r.status) throw new Error(`ffmpeg: ${r.stderr}`); return f; };

async function run(op, input, options) {
  const lib = op.startsWith('a:') ? audio : video; const o = op.slice(2);
  const pl = lib.plan(o, input, await ff.probe(input), options);
  await lib.execute(pl, () => {}).promise; return pl;
}
// Il file prodotto esiste, non è vuoto e ffprobe lo legge con la durata/le tracce attese
async function check(label, out, { audioOnly = false, video: wantVideo = false } = {}) {
  const f = Array.isArray(out) ? out[0] : out;
  if (!f || !fs.existsSync(f) || fs.statSync(f).size < 200) return ok(label, false, 'file mancante o vuoto');
  const p = await ff.probe(f);
  ok(label, (!audioOnly || p.hasAudio) && (!wantVideo || p.hasVideo) && p.duration > 0.5, `audio=${p.hasAudio} video=${p.hasVideo} durata=${p.duration}`);
}

(async () => {
  // ---------- audio: ogni formato verso ogni altro ----------
  console.log('--- audio');
  const AUD = audio.TARGETS;           // mp3 m4a wav flac ogg opus aac aiff wma
  const ad = sub('audio');
  for (const src of AUD) {
    const dir = sub('audio-' + src);
    const first = gen(ad, `base.${src === 'aac' ? 'aac' : src}`, ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=3:sample_rate=44100', '-ac', '2']);
    const input = path.join(dir, `in.${src}`); fs.copyFileSync(first, input);
    for (const dst of AUD.filter((x) => x !== src)) {
      try { await check(`audio ${src} -> ${dst}`, (await run('a:convert', input, { target: dst })).outputs, { audioOnly: true }); }
      catch (e) { ok(`audio ${src} -> ${dst}`, false, e.message.slice(0, 140)); }
    }
  }

  // ---------- video: ogni contenitore verso ogni altro, verso GIF e verso tutti gli audio ----------
  console.log('--- video');
  const VID = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'ts'];
  const vd = sub('video');
  for (const src of VID) {
    const dir = sub('video-' + src);
    const input = path.join(dir, `in.${src}`);
    const base = path.join(vd, 'base.mp4');
    if (!fs.existsSync(base)) gen(vd, 'base.mp4', ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=3', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=3', '-shortest', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-c:a', 'aac']);
    if (src === 'mp4') fs.copyFileSync(base, input);
    else { const r = await run('v:convert', base, { target: src }); fs.copyFileSync(r.outputs[0], input); }
    for (const dst of [...VID.filter((x) => x !== src), 'gif', ...audio.TARGETS]) {
      try { const r = await run('v:convert', input, { target: dst, gif: { fps: 5, width: 160 } }); await check(`video ${src} -> ${dst}`, r.outputs, dst === 'gif' ? { video: true } : audio.TARGETS.includes(dst) ? { audioOnly: true } : { video: true, audioOnly: true }); }
      catch (e) { ok(`video ${src} -> ${dst}`, false, e.message.slice(0, 140)); }
    }
  }
  // GIF -> MP4 / WEBM
  const gif = path.join(vd, 'in.gif'); const gr = await run('v:convert', path.join(vd, 'base.mp4'), { target: 'gif', gif: { fps: 5, width: 160 } }); fs.copyFileSync(gr.outputs[0], gif);
  for (const dst of ['mp4', 'webm']) { try { const r = await run('v:convert', gif, { target: dst }); await check(`gif -> ${dst}`, r.outputs, { video: true }); } catch (e) { ok(`gif -> ${dst}`, false, e.message.slice(0, 140)); } }

  // ---------- immagini ----------
  console.log('--- immagini');
  const IMG = ['png', 'jpg', 'webp', 'tiff', 'avif', 'bmp', 'gif'];
  const id = sub('img');
  const png = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3a7bd5' } }).png().toBuffer();
  for (const src of IMG) {
    const input = path.join(id, `in.${src}`);
    fs.writeFileSync(path.join(id, 'seed.png'), png);
    const out0 = src === 'png' ? path.join(id, 'seed.png') : (await convert(path.join(id, 'seed.png'), src))[0];
    fs.copyFileSync(out0, input);
    for (const dst of [...IMG.filter((x) => x !== src), 'docx']) {
      try { const r = await convert(input, dst); ok(`immagine ${src} -> ${dst}`, r.length >= 1 && fs.statSync(r[0]).size > 50, r[0]); } catch (e) { ok(`immagine ${src} -> ${dst}`, false, e.message.slice(0, 140)); }
    }
  }

  // ---------- fogli di calcolo (PDF nello script Electron) ----------
  console.log('--- fogli');
  const sd = sub('sheet');
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Ordini'); ws.addRow(['ID', 'Cliente', 'Importo']).font = { bold: true }; ws.addRow([1, 'Rossi', 10.5]); ws.addRow([2, 'Bianchi', 20]);
  const x = path.join(sd, 'dati.xlsx'); await wb.xlsx.writeFile(x);
  const SH = ['xlsx', 'xls', 'ods', 'csv', 'tsv', 'json', 'html'];
  for (const src of ['xlsx', 'xls', 'ods', 'csv', 'tsv']) {
    const dir = sub('sheet-' + src); let input = path.join(dir, `in.${src}`);
    if (src === 'xlsx') fs.copyFileSync(x, input); else { const r = await sheet.convert(x, { target: src }); fs.copyFileSync(r.outputs[0], input); }
    for (const dst of SH.filter((t) => t !== src)) {
      try { const r = await sheet.convert(input, { target: dst }); const f = r.outputs[0]; const txt = ['csv', 'tsv', 'json', 'html'].includes(dst) ? fs.readFileSync(f, 'utf8') : '';
        const good = fs.statSync(f).size > 50 && (!txt || /Rossi/.test(txt)) && (dst !== 'tsv' || /\t/.test(txt));
        // i formati binari si controllano riaprendoli
        const back = ['xlsx', 'xls', 'ods'].includes(dst) ? JSON.stringify((await sheet.inspect(f)).sheets[0].preview) : '';
        ok(`foglio ${src} -> ${dst}`, good && (!back || /Rossi/.test(back)), r.outputs[0]); }
      catch (e) { ok(`foglio ${src} -> ${dst}`, false, e.message.slice(0, 140)); }
    }
  }
  try { await sheet.convert(path.join(sd, 'dati.xlsx'), { target: 'xlsx' }); ok('stesso formato rifiutato', false); } catch { ok('stesso formato rifiutato', true); }

  console.log(`\n${total - fail}/${total} combinazioni ok`);
  console.log(fail ? `${fail} FALLITE` : 'TUTTO OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
