// Costruisce i comandi ffmpeg per ogni operazione sui video e li esegue (con avanzamento e annullamento).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { uniquePath } = require('../converter');
const ff = require('./ffmpeg');

const { TARGETS: AUDIO_TARGETS, codecArgs: audioCodec } = require('../audio/codecs');
const VIDEO_TARGETS = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'ts'];
const MP3_KBPS = { high: 320, medium: 192, low: 128 };
const QUALITY = {
  high: { crf: 18, vp9: 24, mp3: '320k', aac: '256k' },
  medium: { crf: 23, vp9: 31, mp3: '192k', aac: '192k' },
  low: { crf: 28, vp9: 36, mp3: '128k', aac: '128k' },
};
const COMPRESS_CRF = { light: 24, medium: 28, strong: 32 };

const dirOf = (f) => path.dirname(f);
const baseOf = (f) => path.basename(f, path.extname(f));
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const fmtTime = (s) => { const t = Math.max(0, Math.round(s)); return `${Math.floor(t / 60)}m${String(t % 60).padStart(2, '0')}s`; };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Intervallo scelto (secondi): normalizzato dentro la durata
function normRange(range, duration) {
  if (!range) return { start: 0, dur: duration, full: true };
  const start = Math.min(Math.max(0, Number(range.start) || 0), Math.max(0, duration - 0.1));
  const end = Math.min(duration, Number(range.end) > start ? Number(range.end) : duration);
  if (end - start < 0.1) throw new Error('l’intervallo selezionato è troppo breve');
  return { start, dur: end - start, full: start < 0.01 && end > duration - 0.01 };
}
const inputArgs = (file, r) => (r.full ? ['-i', file] : ['-ss', r.start.toFixed(3), '-i', file, '-t', r.dur.toFixed(3)]);

// Filtro che rende pari le dimensioni (obbligatorio per H.264 yuv420p)
const evenFilter = (p) => (p.width % 2 || p.height % 2 ? 'scale=trunc(iw/2)*2:trunc(ih/2)*2' : null);

// Si può cambiare contenitore senza ricodificare?
function canCopy(p, target) {
  const v = p.vcodec, a = p.acodec;
  if (!v) return false;
  if (target === 'mkv') return true;
  if (target === 'mp4' || target === 'mov') return ['h264', 'hevc', 'mpeg4'].includes(v) && (!a || ['aac', 'mp3', 'ac3'].includes(a));
  if (target === 'webm') return ['vp8', 'vp9', 'av1'].includes(v) && (!a || ['opus', 'vorbis'].includes(a));
  return false;
}

// Argomenti di codifica video+audio per un contenitore (copyAudio: tiene l'audio com'è, non per webm)
function encodeArgs(container, crf, vp9crf, audioKbps = '160k', copyAudio = false) {
  if (container === 'webm') {
    return ['-c:v', 'libvpx-vp9', '-crf', String(vp9crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k'];
  }
  const qs = String(Math.max(2, Math.min(8, Math.round((crf - 14) / 3))));     // scala qualità dei codec più vecchi: crf 18 -> 2, 23 -> 3, 28 -> 5
  if (container === 'avi') return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-c:a', 'libmp3lame', '-b:a', '192k'];
  if (container === 'wmv') return ['-c:v', 'wmv2', '-q:v', qs, '-pix_fmt', 'yuv420p', '-c:a', 'wmav2', '-b:a', '160k'];
  if (container === 'mpg') return ['-c:v', 'mpeg2video', '-q:v', qs, '-pix_fmt', 'yuv420p', '-c:a', 'mp2', '-b:a', '192k'];
  return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p',
    ...(copyAudio ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', audioKbps]), ...(container === 'mkv' || container === 'flv' || container === 'ts' ? [] : ['-movflags', '+faststart'])];
}
const withFilter = (args, vf) => (vf ? ['-vf', vf, ...args] : args);

// ---------- piani ----------
function planConvert(file, p, o) {
  const target = o.target, q = QUALITY[o.quality] || QUALITY.medium;
  const r = normRange(o.range, p.duration);
  const base = baseOf(file), dir = dirOf(file);
  if (AUDIO_TARGETS.includes(target)) {
    if (!p.hasAudio) throw new Error('questo video non ha una traccia audio');
    const out = uniquePath(dir, base, target);
    const codec = audioCodec(target, MP3_KBPS[o.quality] || 192);
    return { duration: r.dur, outputs: [out], steps: [{ weight: 1, args: [...inputArgs(file, r), '-vn', '-map', '0:a:0', ...codec, out] }] };
  }
  if (!p.hasVideo) throw new Error('il file non contiene video');
  if (target === 'gif') {
    const g = o.gif || {};
    const fps = Math.min(30, Math.max(1, Math.round(g.fps || 12)));
    const w = g.width ? Math.min(+g.width, p.width) : p.width;
    const out = uniquePath(dir, base, 'gif');
    const vf = `fps=${fps},scale=${even(w) === p.width ? 'iw' : even(w)}:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[pal];[s1][pal]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`;
    return { duration: r.dur, outputs: [out], steps: [{ weight: 1, args: [...inputArgs(file, r), '-map', '0:v:0', '-an', '-vf', vf, '-loop', '0', out] }], warn: r.dur * fps > 900 ? 'GIF molto lunga: il file sarà molto grande' : null };
  }
  const out = uniquePath(dir, base, target);
  const copy = o.copy !== false && canCopy(p, target);
  let args;
  if (copy) args = [...inputArgs(file, r), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', ...(p.vcodec === 'hevc' && target !== 'mkv' ? ['-tag:v', 'hvc1'] : []), ...(target === 'mkv' || target === 'webm' ? [] : ['-movflags', '+faststart']), out];
  const reencode = [...inputArgs(file, r), '-map', '0:v:0', '-map', '0:a:0?', ...withFilter(encodeArgs(target, q.crf, q.vp9), evenFilter(p)), out];
  if (!copy) args = reencode;
  // se i flussi non entrano nel nuovo contenitore (es. alcuni AVI/MPG in MKV) si ricodifica
  return { duration: r.dur, outputs: [out], copy, steps: [{ weight: 1, args, fallbackArgs: copy ? reencode : undefined }] };
}

function planCompress(file, p, o) {
  if (!p.hasVideo) throw new Error('il file non contiene video');
  const out = uniquePath(dirOf(file), `${baseOf(file)} Compressed`, 'mp4');
  const filters = [];
  if (o.maxHeight && o.maxHeight < p.height) filters.push(`scale=-2:${o.maxHeight}`);
  else if (evenFilter(p)) filters.push(evenFilter(p));
  const vf = filters.join(',') || null;
  const audio = o.audio === 'remove' || !p.hasAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', '128k'];
  const maps = ['-map', '0:v:0', ...(audio[0] === '-an' ? [] : ['-map', '0:a:0?'])];
  if (o.mode !== 'size') {
    const crf = COMPRESS_CRF[o.level] || COMPRESS_CRF.medium;
    return { duration: p.duration, outputs: [out], steps: [{ weight: 1, args: ['-i', file, ...maps, ...withFilter(['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf), '-pix_fmt', 'yuv420p', ...audio, '-movflags', '+faststart'], vf), out] }] };
  }
  // dimensione obiettivo: due passate a bitrate calcolato
  const mb = Number(o.sizeMB);
  if (!(mb > 0)) throw new Error('indica la dimensione desiderata');
  if (p.size && mb * 1024 * 1024 >= p.size) throw new Error(`il video è già più piccolo di ${mb} MB (${(p.size / 1048576).toFixed(1)} MB)`);
  const audioBps = audio[0] === '-an' ? 0 : 128000;
  const vbps = Math.floor((mb * 1024 * 1024 * 8 * 0.96) / p.duration - audioBps);
  if (vbps < 60000) throw new Error(`${mb} MB sono troppo pochi per ${Math.round(p.duration)} secondi: servono almeno ${Math.ceil(((60000 + audioBps) * p.duration) / 8 / 1048576 / 0.96)} MB`);
  const log = path.join(os.tmpdir(), `dw-pass-${process.pid}-${Date.now()}`);
  const enc = ['-c:v', 'libx264', '-preset', 'medium', '-b:v', String(vbps), '-maxrate', String(Math.round(vbps * 1.6)), '-bufsize', String(vbps * 2), '-pix_fmt', 'yuv420p'];
  return {
    duration: p.duration, outputs: [out], cleanupFiles: [`${log}-0.log`, `${log}-0.log.mbtree`],
    steps: [
      { weight: 0.45, args: ['-i', file, '-map', '0:v:0', ...withFilter([...enc, '-pass', '1', '-passlogfile', log, '-an', '-f', 'null'], vf), '-'] },
      { weight: 0.55, args: ['-i', file, ...maps, ...withFilter([...enc, '-pass', '2', '-passlogfile', log, ...audio, '-movflags', '+faststart'], vf), out] },
    ],
    info: `bitrate video ≈ ${Math.round(vbps / 1000)} kbit/s`,
  };
}

function planResize(file, p, o) {
  if (!p.hasVideo) throw new Error('il file non contiene video');
  const ext = VIDEO_TARGETS.includes(extOf(file)) ? extOf(file) : 'mp4';
  let vf, label;
  if (o.percent) {
    vf = `scale=trunc(iw*${o.percent / 100}/2)*2:trunc(ih*${o.percent / 100}/2)*2`; label = `${o.percent}pct`;
  } else {
    const W = o.width ? Math.round(o.width) : 0, H = o.height ? Math.round(o.height) : 0;
    if (!W && !H) throw new Error('indica una dimensione');
    if (o.lock !== false) vf = W && H ? `scale=w=${W}:h=${H}:force_original_aspect_ratio=decrease:force_divisible_by=2` : W ? `scale=${even(W)}:-2` : `scale=-2:${even(H)}`;
    else vf = `scale=${even(W || p.width)}:${even(H || p.height)}`;
    label = H && !W ? `${H}p` : `${W || 'auto'}x${H || 'auto'}`;
  }
  const out = uniquePath(dirOf(file), `${baseOf(file)} ${label}`, ext);
  const copyAudio = p.hasAudio && ext !== 'webm' && ['aac', 'mp3', 'ac3'].includes(p.acodec);
  const args = encodeArgs(ext, 20, 28, '192k', copyAudio);
  return { duration: p.duration, outputs: [out], steps: [{ weight: 1, args: ['-i', file, '-map', '0:v:0', '-map', '0:a:0?', ...withFilter(args, vf), out] }] };
}

function planCut(file, p, o) {
  if (!p.hasVideo) throw new Error('il file non contiene video');
  const r = normRange(o.range, p.duration);
  if (r.full) throw new Error('seleziona un intervallo più breve del video intero');
  const ext = VIDEO_TARGETS.includes(extOf(file)) ? extOf(file) : 'mp4';
  const out = uniquePath(dirOf(file), `${baseOf(file)} Cut`, ext);
  const args = o.precise
    ? [...inputArgs(file, r), '-map', '0:v:0', '-map', '0:a:0?', ...withFilter(encodeArgs(ext, 18, 24, '192k'), evenFilter(p)), out]
    : [...inputArgs(file, r), '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-avoid_negative_ts', 'make_zero', out];
  return { duration: r.dur, outputs: [out], steps: [{ weight: 1, args }] };
}

const IMG_ARGS = { png: [], jpg: ['-q:v', '2'], webp: ['-c:v', 'libwebp', '-quality', '90'] };
function uniqueDir(dir, name) { let p = path.join(dir, name); for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${name} (${i})`); return p; }

function planFrames(file, p, o) {
  if (!p.hasVideo) throw new Error('il file non contiene video');
  const fmt = IMG_ARGS[o.format] ? o.format : 'png', base = baseOf(file), dir = dirOf(file);
  if (o.mode === 'single') {
    const t = Math.min(Math.max(0, Number(o.time) || 0), Math.max(0, p.duration - 0.05));
    const out = uniquePath(dir, `${base} frame ${fmtTime(t)}`, fmt);
    return { duration: 1, outputs: [out], steps: [{ weight: 1, args: ['-ss', t.toFixed(3), '-i', file, '-map', '0:v:0', '-frames:v', '1', ...IMG_ARGS[fmt], out] }] };
  }
  const r = normRange(o.range, p.duration);
  let fps, cap = [];
  if (o.mode === 'count') { const n = Math.max(1, Math.round(o.count || 10)); fps = n / r.dur; cap = ['-frames:v', String(n)]; }
  else { const every = Math.max(0.04, Number(o.every) || 1); fps = 1 / every; }
  const total = o.mode === 'count' ? Math.round(o.count || 10) : Math.floor(r.dur * fps) + 1;
  if (total > 5000) throw new Error(`verrebbero creati ${total} file: aumenta l’intervallo o riduci l’intervallo di tempo`);
  const outDir = uniqueDir(dir, `${base} Frames`);
  return {
    duration: r.dur, outputs: [outDir], isDir: true, mkdir: outDir, count: total,
    steps: [{ weight: 1, args: [...inputArgs(file, r), '-map', '0:v:0', '-vf', `fps=${fps}`, ...cap, '-start_number', '1', ...IMG_ARGS[fmt], path.join(outDir, `frame_%04d.${fmt}`)] }],
  };
}

const PLANNERS = { convert: planConvert, compress: planCompress, resize: planResize, cut: planCut, frames: planFrames };
function plan(op, file, probeInfo, options) {
  if (!PLANNERS[op]) throw new Error(`operazione sconosciuta: ${op}`);
  return PLANNERS[op](file, probeInfo, options || {});
}

// Esegue i passi in sequenza. handle.cancel() interrompe e cancella i file parziali
function execute(pl, onProgress = () => {}) {
  let current = null, cancelled = false;
  const cleanup = (removeOutputs) => {
    for (const f of pl.cleanupFiles || []) fs.rmSync(f, { force: true });
    if (removeOutputs) for (const o of pl.outputs) fs.rmSync(o, { recursive: true, force: true });
  };
  const promise = (async () => {
    if (pl.mkdir) fs.mkdirSync(pl.mkdir, { recursive: true });
    let done = 0;
    try {
      for (const step of pl.steps) {
        if (cancelled) throw Object.assign(new Error('annullato'), { cancelled: true });
        const dur = step.duration || pl.duration; // ogni passo può avere la sua durata (es. più tagli audio)
        const report = (t) => onProgress(Math.min(1, done + (step.weight * Math.min(t, dur)) / dur));
        current = ff.run(step.args, { onProgress: report });
        try { await current.promise; }
        catch (e) { // ripiego (es. copertina non copiabile): si riprova con altri argomenti
          if (e.cancelled || !step.fallbackArgs) throw e;
          current = ff.run(step.fallbackArgs, { onProgress: report });
          await current.promise;
        }
        done += step.weight; onProgress(Math.min(1, done));
      }
      cleanup(false);
      return pl.outputs;
    } catch (e) { cleanup(true); throw e; }
  })();
  return { promise, cancel: () => { cancelled = true; current && current.cancel(); } };
}

module.exports = { plan, execute, canCopy, VIDEO_TARGETS, AUDIO_TARGETS };
