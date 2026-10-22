// Collaudo delle operazioni audio con file generati da ffmpeg. Uso: node tools/test-audio.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const ff = require('../src/video/ffmpeg');
const jobs = require('../src/audio/jobs');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-aud-'));
const gen = (name, args) => { const f = path.join(d, name); const r = spawnSync(ff.FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args, f]); if (r.status) throw new Error(r.stderr.toString()); return f; };
const cover = gen('cover.jpg', ['-f', 'lavfi', '-i', 'color=c=red:s=300x300', '-frames:v', '1']);
// mp3 di 20 s con copertina e tag
const mp3 = gen('canzone.mp3', ['-f', 'lavfi', '-i', 'sine=frequency=440:duration=20:sample_rate=44100', '-i', cover, '-map', '0:a', '-map', '1:v', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '192k',
  '-c:v', 'copy', '-id3v2_version', '3', '-metadata', 'title=Prova', '-metadata', 'artist=Io', '-disposition:v', 'attached_pic']);
const wav = gen('b.wav', ['-f', 'lavfi', '-i', 'sine=frequency=660:duration=8:sample_rate=48000', '-ac', '1']);
const flac = gen('c.flac', ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=6:sample_rate=22050']);
const silenzi = gen('silenzi.wav', ['-f', 'lavfi', '-i', 'sine=frequency=500:duration=3,adelay=2000|2000,apad=pad_dur=2', '-ar', '44100']);

let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
async function go(op, input, options) {
  const probes = Array.isArray(input) ? await Promise.all(input.map((f) => ff.probe(f))) : await ff.probe(input);
  const pl = jobs.plan(op, input, probes, options);
  const seen = []; const t0 = Date.now();
  const out = await jobs.execute(pl, (v) => seen.push(v)).promise;
  return { out, plan: pl, mono: seen.every((v, i) => !i || v >= seen[i - 1] - 1e-9), last: seen.at(-1), ms: Date.now() - t0 };
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

(async () => {
  const P = await ff.probe(mp3);
  ok('probe audio', P.hasAudio && !P.hasVideo && P.hasCover && P.sampleRate === 44100 && P.channels === 2 && near(P.duration, 20, 0.2) && P.tags.title === 'Prova',
    `${P.acodec} ${P.sampleRate} Hz ${P.channels}ch ${P.duration.toFixed(1)}s cover=${P.hasCover} titolo=${P.tags.title}`);
  const wf = await ff.waveform(mp3, 400, P.duration);
  ok('forma d’onda', wf.buckets > 300 && Math.max(...wf.max) >= 8 && Math.min(...wf.min) <= -8, `${wf.buckets} intervalli, picco ${Math.max(...wf.max)}`);
  const wfs = await ff.waveform(silenzi, 100, 7);
  ok('forma d’onda con silenzi', wfs.max[0] <= 1 && wfs.max[99] <= 1 && Math.max(...wfs.max) > 10, `inizio ${wfs.max[0]}, fine ${wfs.max[99]}, centro ${Math.max(...wfs.max)}`);

  console.log('--- converti');
  for (const [target, extra] of [['m4a', {}], ['flac', {}], ['wav', { bitDepth: 24 }], ['ogg', { bitrate: 128 }], ['opus', { bitrate: 96 }], ['m4a', { sampleRate: 22050, channels: 1 }]]) {
    const r = await go('convert', mp3, { target, ...extra });
    const q = await ff.probe(r.out[0]);
    const coverOk = ['m4a', 'flac'].includes(target) ? q.hasCover : true;
    ok(`mp3 -> ${target} ${JSON.stringify(extra)}`, near(q.duration, 20, 0.3) && coverOk && q.tags.title === 'Prova' || target === 'wav' || target === 'ogg' || target === 'opus',
      `${q.acodec} ${q.sampleRate} Hz ${q.channels}ch ${q.duration.toFixed(1)}s ${kb(r.out[0])} copertina=${q.hasCover} titolo=${q.tags.title || '-'}`);
  }
  const rf = await go('convert', wav, { target: 'mp3', bitrate: 320 }); const qf = await ff.probe(rf.out[0]);
  ok('wav mono 48k -> mp3 (senza copertina)', qf.acodec === 'mp3' && qf.channels === 1 && !qf.hasCover, `${qf.sampleRate} Hz ${qf.channels}ch ${kb(rf.out[0])}`);

  console.log('--- taglia');
  const segs = [{ start: 1, end: 3 }, { start: 5.5, end: 9 }, { start: 15, end: 19.5 }];
  const c1 = await go('cut', mp3, { segments: segs, mode: 'separate' });
  const durs = await Promise.all(c1.out.map(async (o) => (await ff.probe(o)).duration));
  ok('3 parti separate (copia senza ricodificare)', c1.out.length === 3 && c1.plan.copy && durs.every((x, i) => near(x, segs[i].end - segs[i].start, 0.12)) && c1.mono,
    c1.out.map((o, i) => `${path.basename(o)} ${durs[i].toFixed(2)}s`).join(' | '));
  const q1 = await ff.probe(c1.out[0]); ok('la copertina resta nelle parti', q1.hasCover && q1.tags.title === 'Prova');
  const c2 = await go('cut', mp3, { segments: segs, mode: 'separate', format: 'wav' });
  const d2 = await Promise.all(c2.out.map(async (o) => (await ff.probe(o)).duration));
  ok('3 parti in WAV (ricodifica, taglio preciso)', d2.every((x, i) => near(x, segs[i].end - segs[i].start, 0.03)), d2.map((x) => x.toFixed(3)).join(' '));
  const c3 = await go('cut', mp3, { segments: segs, mode: 'join' }); const q3 = await ff.probe(c3.out[0]);
  ok('parti unite in un solo file', near(q3.duration, 2 + 3.5 + 4.5, 0.2) && c3.out.length === 1, `${q3.duration.toFixed(2)} s (attesi 10,00) ${path.basename(c3.out[0])}`);
  const c4 = await go('cut', mp3, { segments: segs, mode: 'join', crossfadeMs: 500 }); const q4 = await ff.probe(c4.out[0]);
  ok('parti unite con dissolvenza di 0,5 s', near(q4.duration, 10 - 0.5 * 2, 0.2), `${q4.duration.toFixed(2)} s (attesi 9,00)`);
  const c5 = await go('cut', mp3, { segments: segs, mode: 'remove' }); const q5 = await ff.probe(c5.out[0]);
  ok('elimina le parti scelte e tiene il resto', near(q5.duration, 20 - 10, 0.25) && /modificato/.test(c5.out[0]), `${q5.duration.toFixed(2)} s (attesi 10,00)`);
  ok('complemento con parti sovrapposte', JSON.stringify(jobs.complement([{ start: 2, end: 6 }, { start: 5, end: 8 }], 10).map((s) => [s.start, s.end])) === '[[0,2],[8,10]]');
  for (const [o, msg] of [[{ segments: [] }, 'nessuna parte'], [{ segments: [{ start: 0, end: 20 }], mode: 'remove' }, 'tutto coperto']]) {
    try { jobs.plan('cut', mp3, P, o); ok('errore ' + msg, false); } catch (e) { ok('errore ' + msg, true, e.message); }
  }

  console.log('--- unisci in sequenza');
  const files = [mp3, wav, flac];
  const m1 = await go('merge', files, { joinMode: 'gap', gap: 0 }); const qm1 = await ff.probe(m1.out[0]);
  ok('3 file (44,1k stereo + 48k mono + 22k) uno dopo l’altro', near(qm1.duration, 20 + 8 + 6, 0.5) && qm1.sampleRate === 48000 && qm1.channels === 2, `${qm1.duration.toFixed(2)} s (attesi 34,00), ${qm1.acodec} ${qm1.sampleRate} Hz ${qm1.channels}ch ${path.basename(m1.out[0])}`);
  const m2 = await go('merge', files, { joinMode: 'gap', gap: 2 }); const qm2 = await ff.probe(m2.out[0]);
  ok('con 2 secondi di pausa tra i brani', near(qm2.duration, 34 + 4, 0.4), `${qm2.duration.toFixed(2)} s (attesi 38,00)`);
  const m3 = await go('merge', files, { joinMode: 'crossfade', crossfade: 3, format: 'flac' }); const qm3 = await ff.probe(m3.out[0]);
  ok('con dissolvenza incrociata di 3 s, in FLAC', near(qm3.duration, 34 - 6, 0.4) && qm3.acodec === 'flac', `${qm3.duration.toFixed(2)} s (attesi 28,00), ${qm3.acodec}`);
  const m4 = await go('merge', [wav], { joinMode: 'gap', gap: 0 }); ok('un solo file', near((await ff.probe(m4.out[0])).duration, 8, 0.2));
  try { jobs.plan('merge', [], [], {}); ok('errore nessun file', false); } catch (e) { ok('errore nessun file', true, e.message); }

  console.log('--- volume');
  const v1 = await go('volume', mp3, { gainDb: 6 }); const qv1 = await ff.probe(v1.out[0]); ok('guadagno +6 dB', near(qv1.duration, 20, 0.3) && /modificato.*\.mp3$/.test(v1.out[0]), `${qv1.duration.toFixed(2)} s ${path.basename(v1.out[0])}`);
  const loud = spawnSync(ff.FFMPEG, ['-hide_banner', '-i', v1.out[0], '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/max_volume: (-?[\d.]+) dB/);
  const base0 = spawnSync(ff.FFMPEG, ['-hide_banner', '-i', mp3, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/max_volume: (-?[\d.]+) dB/);
  ok('il volume è davvero aumentato', loud && base0 && +loud[1] - +base0[1] > 4, `picco ${base0 && base0[1]} dB -> ${loud && loud[1]} dB`);
  const v2 = await go('volume', mp3, { normalize: true, format: 'wav' }); const qv2 = await ff.probe(v2.out[0]);
  ok('normalizzazione (loudnorm), frequenza originale mantenuta', qv2.sampleRate === 44100 && near(qv2.duration, 20, 0.3), `${qv2.sampleRate} Hz ${qv2.duration.toFixed(2)} s`);
  const v3 = await go('volume', mp3, { fadeIn: 2, fadeOut: 3 }); ok('dissolvenze', near((await ff.probe(v3.out[0])).duration, 20, 0.3));
  const v4 = await go('volume', mp3, { speed: 1.5 }); ok('velocità 1,5x', near((await ff.probe(v4.out[0])).duration, 20 / 1.5, 0.3), `${(await ff.probe(v4.out[0])).duration.toFixed(2)} s (attesi 13,33)`);
  const v5 = await go('volume', silenzi, { trimSilence: true }); const qv5 = await ff.probe(v5.out[0]);
  ok('taglia il silenzio a inizio e fine', qv5.duration > 2.7 && qv5.duration < 3.4, `${qv5.duration.toFixed(2)} s (da 7,00; attesi circa 3,00)`);
  try { jobs.plan('volume', mp3, P, {}); ok('errore nessuna modifica', false); } catch (e) { ok('errore nessuna modifica', true, e.message); }

  console.log(fail ? `\n${fail} FALLITI` : '\nTUTTO OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRORE', e); process.exit(1); });
