// Collaudo della separazione voce / musica. Genera da sé un brano di prova: una voce sintetica di Windows (SAPI) sopra una base di toni
// e rumore, poi controlla che la "voce" separata assomigli alla voce originale e la "musica" alla base. Uso: node tools/test-separate.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const { FFMPEG } = require('../src/video/ffmpeg');
const engine = require('../src/audio/separation/engine');
const { makeSong } = require('./fixture-song');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sep-'));
let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };

// PCM float mono 44,1 kHz di un file (per confrontare le forme d'onda)
function pcm(file) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-i', file, '-ac', '1', '-ar', '44100', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 29 });
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, Math.floor(r.stdout.length / 4));
}
function corr(a, b) {
  const n = Math.min(a.length, b.length); let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { ab += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i]; }
  return ab / Math.sqrt(aa * bb + 1e-12);
}
const rms = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0) / a.length);

(async () => {
  // materiale di prova
  const song = makeSong(d);
  if (!song) { console.log('Sintesi vocale di Windows non disponibile: collaudo saltato'); process.exit(0); }
  const { mix, voice, base } = song;

  // separazione
  const outputs = { vocals: path.join(d, 'brano (voce).wav'), music: path.join(d, 'brano (musica).wav') };
  const seen = []; const t0 = Date.now();
  const res = await engine.separate({ file: mix, targets: ['vocals', 'music'], outputs, format: 'wav', bitrate: 192 }, (s, p) => seen.push(p));
  ok('file creati', res.length === 2 && res.every((f) => fs.existsSync(f) && fs.statSync(f).size > 100000), `${res.length} file, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  ok('avanzamento crescente fino al 100%', seen.every((v, i) => !i || v >= seen[i - 1] - 1e-9) && seen.at(-1) === 1);

  const refVoice = pcm(voice), refBase = pcm(base), gotVoice = pcm(outputs.vocals);
  const gotMusic = pcm(outputs.music);
  const cvv = corr(gotVoice, refVoice), cvb = corr(gotVoice, refBase), cmb = corr(gotMusic, refBase), cmv = corr(gotMusic, refVoice);
  console.log(`        correlazioni: voce~voce ${cvv.toFixed(2)}, voce~base ${cvb.toFixed(2)}, musica~base ${cmb.toFixed(2)}, musica~voce ${cmv.toFixed(2)}`);
  ok('la voce separata somiglia alla voce originale più che alla base', cvv > 0.5 && cvv > Math.abs(cvb) + 0.2);
  ok('la musica separata somiglia alla base più che alla voce', cmb > 0.5 && cmb > Math.abs(cmv) + 0.2);
  ok('voce + musica ≈ brano originale', (() => { const m = pcm(mix), n = Math.min(m.length, gotVoice.length, gotMusic.length); const sum = new Float32Array(n); for (let i = 0; i < n; i++) sum[i] = gotVoice[i] + gotMusic[i]; return corr(sum, m) > 0.95; })());

  // formato MP3 con i tag del file originale
  const mp3out = { vocals: path.join(d, 'solo voce.mp3') };
  await engine.separate({ file: mix, targets: ['vocals'], outputs: mp3out, format: 'mp3', bitrate: 192 });
  const tags = spawnSync(FFMPEG, ['-i', mp3out.vocals, '-f', 'ffmetadata', '-'], { encoding: 'utf8' }).stdout;
  ok('i tag del brano (titolo, artista) restano', /title=Brano di prova/.test(tags) && /artist=Test/.test(tags));

  // annullamento
  let n = 0;
  try { await engine.separate({ file: mix, targets: ['vocals'], outputs: { vocals: path.join(d, 'x.wav') }, format: 'wav' }, () => {}, () => ++n > 3); ok('annullamento', false); }
  catch (e) { ok('annullamento', e.cancelled === true && !fs.existsSync(path.join(d, 'x.wav'))); }

  // errori
  try { await engine.separate({ file: path.join(d, 'nonesiste.mp3'), targets: ['vocals'], outputs: { vocals: path.join(d, 'y.wav') }, format: 'wav' }); ok('file inesistente', false); } catch (e) { ok('file inesistente', true, e.message.slice(0, 60)); }
  try { await engine.separate({ file: mix, targets: [], outputs: {}, format: 'wav' }); ok('nessun risultato scelto', false); } catch (e) { ok('nessun risultato scelto', true, e.message); }

  console.log(fail ? `\n${fail} FALLITI` : '\nTUTTO OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
