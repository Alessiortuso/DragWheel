// Operazioni sull'audio: converti, taglia (più parti in una volta), unisci in sequenza, volume. Lo fa ffmpeg (src/video/ffmpeg.js).
const path = require('path');
const { uniquePath } = require('../converter');
const { execute } = require('../video/jobs');

const { TARGETS, BITRATES, codecArgs } = require('./codecs');
const COVER_OK = new Set(['mp3', 'm4a', 'flac']); // formati che possono avere la copertina
const COPY_EXT = new Set(['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus']); // formati in cui si può tagliare senza ricodificare

const dirOf = (f) => path.dirname(f);
const baseOf = (f) => path.basename(f, path.extname(f));
const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
const pad = (n, w) => String(n).padStart(w, '0');

// Formato "come l'originale" (le estensioni non scrivibili passano a MP3)
function sameFormat(file) {
  const e = extOf(file);
  if (['m4a', 'm4b', 'mp4', 'aac'].includes(e)) return 'm4a';
  if (e === 'oga') return 'ogg';
  return TARGETS.includes(e) ? e : 'mp3';
}
const pickBitrate = (p, o) => {
  if (BITRATES.includes(+o.bitrate)) return +o.bitrate;
  const src = Math.round((p?.audioBitrate || p?.bitrate || 0) / 1000);
  return BITRATES.find((b) => b >= src) || 192; // ricodificando si resta almeno al livello dell'originale
};

const rateArgs = (o) => [...(+o.sampleRate ? ['-ar', String(+o.sampleRate)] : []), ...(+o.channels ? ['-ac', String(+o.channels)] : [])];

// Audio (+ copertina, se c'è e il formato la supporta). fallback: stessi argomenti senza copertina
function maps(p, fmt, o) {
  const cover = p.hasCover && COVER_OK.has(fmt) && o.keepCover !== false;
  return {
    args: cover ? ['-map', '0:a:0', '-map', '0:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic'] : ['-map', '0:a:0'],
    plain: ['-map', '0:a:0'], cover,
  };
}

function needAudio(p) { if (!p.hasAudio) throw new Error('il file non contiene audio'); }

// ---------- converti ----------
function planConvert(file, p, o) {
  needAudio(p);
  const fmt = o.target;
  if (!TARGETS.includes(fmt)) throw new Error('scegli un formato di uscita');
  const out = uniquePath(dirOf(file), baseOf(file), fmt), br = pickBitrate(p, o);
  const m = maps(p, fmt, o);
  const tail = ['-map_metadata', '0', ...rateArgs(o), ...codecArgs(fmt, br, o), out];
  return { duration: p.duration, outputs: [out], steps: [{ weight: 1, args: ['-i', file, ...m.args, ...tail], fallbackArgs: m.cover ? ['-i', file, ...m.plain, ...tail] : undefined }] };
}

// ---------- taglia ----------
function normSegments(segs, dur) {
  const list = (segs || []).map((s) => ({ start: clamp(+s.start || 0, 0, dur), end: clamp(+s.end || 0, 0, dur) })).filter((s) => s.end - s.start >= 0.05);
  list.sort((a, b) => a.start - b.start);
  if (!list.length) throw new Error('aggiungi almeno una parte da tagliare');
  return list;
}
// Parti rimaste dopo aver tolto quelle scelte
function complement(segs, dur) {
  const merged = [];
  for (const s of segs) { const l = merged[merged.length - 1]; if (l && s.start <= l.end) l.end = Math.max(l.end, s.end); else merged.push({ ...s }); }
  const kept = []; let at = 0;
  for (const s of merged) { if (s.start - at >= 0.05) kept.push({ start: at, end: s.start }); at = s.end; }
  if (dur - at >= 0.05) kept.push({ start: at, end: dur });
  return kept;
}
// Unisce le parti con un unico filtro (ricodifica); crossfade in secondi
function joinFilter(parts, cf) {
  const f = parts.map((s, i) => `[0:a:0]atrim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},asetpts=PTS-STARTPTS[a${i}]`);
  if (parts.length === 1) return `${f[0].slice(0, -4)}[out]`;
  if (cf > 0) {
    let cur = 'a0';
    for (let i = 1; i < parts.length; i++) { const next = i === parts.length - 1 ? 'out' : `x${i}`; f.push(`[${cur}][a${i}]acrossfade=d=${cf}:c1=tri:c2=tri[${next}]`); cur = next; }
  } else f.push(`${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`);
  return f.join(';');
}

function planCut(file, p, o) {
  needAudio(p);
  let segs = normSegments(o.segments, p.duration);
  const mode = o.mode || 'separate';
  const fmt = !o.format || o.format === 'same' ? sameFormat(file) : o.format;
  const ext = !o.format || o.format === 'same' ? (COPY_EXT.has(extOf(file)) ? extOf(file) : fmt) : fmt;
  const br = pickBitrate(p, o), dir = dirOf(file), base = baseOf(file);

  if (mode === 'separate') {
    const copy = (!o.format || o.format === 'same') && o.copy !== false && COPY_EXT.has(extOf(file)) && !+o.sampleRate && !+o.channels;
    const w = Math.max(2, String(segs.length).length);
    const total = segs.reduce((n, s) => n + (s.end - s.start), 0);
    const outputs = [], steps = [];
    segs.forEach((s, i) => {
      const d = s.end - s.start, out = uniquePath(dir, `${base} - parte ${pad(i + 1, w)}`, ext);
      outputs.push(out);
      const m = maps(p, copy ? ext : fmt, o);
      const input = ['-ss', s.start.toFixed(3), '-i', file, '-t', d.toFixed(3)];
      const tail = ['-map_metadata', '0', ...(copy ? ['-c', 'copy'] : [...rateArgs(o), ...codecArgs(fmt, br, o)]), out];
      steps.push({ weight: d / total, duration: d, args: [...input, ...m.args, ...tail], fallbackArgs: m.cover ? [...input, ...m.plain, ...tail] : undefined });
    });
    return { duration: total, outputs, steps, copy };
  }

  // unione delle parti, oppure tutto tranne le parti scelte
  const parts = mode === 'remove' ? complement(segs, p.duration) : segs;
  if (!parts.length) throw new Error('non resterebbe nulla: le parti scelte coprono tutto il file');
  const minLen = Math.min(...parts.map((s) => s.end - s.start));
  const cf = clamp((+o.crossfadeMs || 0) / 1000, 0, Math.max(0, minLen / 2 - 0.01));
  const total = parts.reduce((n, s) => n + (s.end - s.start), 0) - cf * (parts.length - 1);
  const out = uniquePath(dir, mode === 'remove' ? `${base} (modificato)` : `${base} (parti unite)`, fmt); // l'unione ricodifica sempre
  return {
    duration: total, outputs: [out], keptParts: parts.length,
    steps: [{ weight: 1, args: ['-i', file, '-filter_complex', joinFilter(parts, cf), '-map', '[out]', '-map_metadata', '0', ...rateArgs(o), ...codecArgs(fmt, br, o), out] }],
  };
}

// ---------- unisci file in sequenza ----------
function planMerge(files, probes, o) {
  if (!files.length) throw new Error('aggiungi almeno un file');
  probes.forEach((p, i) => { if (!p || p.error || !p.hasAudio) throw new Error(`${path.basename(files[i])}: non contiene audio`); });
  const exts = new Set(files.map(extOf));
  const fmt = o.format && o.format !== 'same' ? o.format : exts.size === 1 && TARGETS.includes([...exts][0]) ? [...exts][0] : 'mp3';
  const sr = +o.sampleRate || clamp(Math.max(...probes.map((p) => p.sampleRate || 44100)), 22050, 48000);
  const ch = +o.channels || (probes.some((p) => p.channels >= 2) ? 2 : 1), layout = ch === 1 ? 'mono' : 'stereo';
  const durs = probes.map((p) => p.duration);
  const useFade = o.joinMode === 'crossfade' && files.length > 1;
  const cf = useFade ? clamp(+o.crossfade || 0, 0, Math.min(...durs) / 2 - 0.01) : 0;
  const gap = o.joinMode === 'gap' ? clamp(+o.gap || 0, 0, 60) : 0;

  const f = files.map((_, i) => `[${i}:a:0]aresample=${sr},aformat=sample_fmts=fltp:channel_layouts=${layout}[a${i}]`);
  let last;
  if (cf > 0) {
    let cur = 'a0';
    for (let i = 1; i < files.length; i++) { const next = i === files.length - 1 ? 'out' : `x${i}`; f.push(`[${cur}][a${i}]acrossfade=d=${cf.toFixed(3)}:c1=tri:c2=tri[${next}]`); cur = next; }
    last = 'out';
  } else {
    const seq = [];
    files.forEach((_, i) => {
      seq.push(`[a${i}]`);
      if (gap > 0 && i < files.length - 1) { f.push(`anullsrc=r=${sr}:cl=${layout},atrim=duration=${gap}[g${i}]`); seq.push(`[g${i}]`); }
    });
    f.push(`${seq.join('')}concat=n=${seq.length}:v=0:a=1[out]`);
    last = 'out';
  }
  if (files.length === 1 && cf === 0 && gap === 0) f.splice(f.length - 1, 1, '[a0]anull[out]');
  const total = durs.reduce((n, d) => n + d, 0) + gap * (files.length - 1) - cf * (files.length - 1);
  const out = uniquePath(dirOf(files[0]), `${baseOf(files[0])} (unione)`, fmt);
  const br = BITRATES.includes(+o.bitrate) ? +o.bitrate : 192;
  const meta = o.title ? ['-metadata', `title=${o.title}`] : [];
  return {
    duration: total, outputs: [out], total, sampleRate: sr, channels: ch,
    steps: [{ weight: 1, args: [...files.flatMap((x) => ['-i', x]), '-filter_complex', f.join(';'), '-map', `[${last}]`, '-map_metadata', '-1', ...meta, ...codecArgs(fmt, br, o), out] }],
  };
}

// ---------- volume, dissolvenze, velocità, silenzi ----------
function planVolume(file, p, o) {
  needAudio(p);
  const speed = clamp(+o.speed || 1, 0.5, 2);
  const trim = !!o.trimSilence && p.duration <= 2400; // il taglio in coda legge tutto l'audio in memoria: oltre 40 minuti solo l'inizio
  const f = [];
  if (o.trimSilence) {
    const sil = 'silenceremove=start_periods=1:start_duration=0.05:start_threshold=-50dB:detection=peak';
    f.push(sil); if (trim) f.push('areverse', sil, 'areverse');
  }
  if (speed !== 1) f.push(`atempo=${speed}`);
  if (o.normalize) f.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  else if (+o.gainDb) f.push(`volume=${clamp(+o.gainDb, -30, 30)}dB`);
  const fi = clamp(+o.fadeIn || 0, 0, 120), fo = clamp(+o.fadeOut || 0, 0, 120);
  if (fi > 0) f.push(`afade=t=in:st=0:d=${fi}`);
  if (fo > 0) {
    if (o.trimSilence) f.push('areverse', `afade=t=in:st=0:d=${fo}`, 'areverse'); // la durata finale non è nota: dissolvenza dal fondo
    else f.push(`afade=t=out:st=${Math.max(0, p.duration / speed - fo).toFixed(3)}:d=${fo}`);
  }
  if (!f.length) throw new Error('scegli almeno una modifica');
  const fmt = !o.format || o.format === 'same' ? sameFormat(file) : o.format, br = pickBitrate(p, o);
  const ext = fmt;
  const out = uniquePath(dirOf(file), `${baseOf(file)} (modificato)`, ext);
  const m = maps(p, fmt, o);
  const ar = +o.sampleRate || (o.normalize ? p.sampleRate || 44100 : 0); // loudnorm porta l'audio a 192 kHz: si riporta alla frequenza originale
  const tail = ['-af', f.join(','), '-map_metadata', '0', ...rateArgs({ ...o, sampleRate: ar }), ...codecArgs(fmt, br, o), out];
  return {
    duration: p.duration / speed, outputs: [out], warn: o.trimSilence && !trim ? 'File lungo: il silenzio è stato tolto solo all’inizio' : null,
    steps: [{ weight: 1, args: ['-i', file, ...m.args, ...tail], fallbackArgs: m.cover ? ['-i', file, ...m.plain, ...tail] : undefined }],
  };
}

function plan(op, input, probeInfo, options) {
  const o = options || {};
  switch (op) {
    case 'convert': return planConvert(input, probeInfo, o);
    case 'cut': return planCut(input, probeInfo, o);
    case 'merge': return planMerge(input, probeInfo, o);
    case 'volume': return planVolume(input, probeInfo, o);
    default: throw new Error(`operazione sconosciuta: ${op}`);
  }
}

module.exports = { plan, execute, TARGETS, BITRATES, sameFormat, complement, normSegments };
