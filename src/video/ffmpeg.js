// Accesso a ffmpeg/ffprobe: lettura dei dati del video, esecuzione con avanzamento e annullamento, anteprime.
const { spawn } = require('child_process');
const path = require('path');

// In un'app impacchettata (asar) gli eseguibili stanno in app.asar.unpacked
const unpacked = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const FFMPEG = unpacked(require('ffmpeg-static'));
const FFPROBE = unpacked(require('@ffprobe-installer/ffprobe').path);

function collect(child) {
  return new Promise((resolve, reject) => {
    const out = [], err = [];
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString('utf8') }));
  });
}

const frac = (s) => { const [a, b] = String(s || '0/1').split('/').map(Number); return b ? a / b : a; };

// Dati del file: durata, dimensioni (già con la rotazione applicata), fps, codec, presenza di audio
async function probe(file) {
  const r = await collect(spawn(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  if (r.code !== 0) throw new Error('file non leggibile come video: ' + (r.err.trim().split('\n').pop() || 'errore sconosciuto'));
  const j = JSON.parse(r.out.toString('utf8'));
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1);
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  let width = v?.width || 0, height = v?.height || 0;
  const rot = Math.abs(Number(v?.tags?.rotate || (v?.side_data_list || []).find((d) => d.rotation !== undefined)?.rotation || 0)) % 180;
  if (rot === 90) [width, height] = [height, width];
  const duration = Number(j.format?.duration || v?.duration || 0);
  return {
    duration, width, height,
    fps: v ? Math.round(frac(v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate) * 100) / 100 : 0,
    vcodec: v?.codec_name || null, acodec: a?.codec_name || null,
    hasVideo: !!v, hasAudio: !!a,
    sampleRate: Number(a?.sample_rate || 0), channels: Number(a?.channels || 0), audioBitrate: Number(a?.bit_rate || 0),
    hasCover: (j.streams || []).some((st) => st.codec_type === 'video' && st.disposition?.attached_pic === 1),
    tags: j.format?.tags || {},
    size: Number(j.format?.size || 0), bitrate: Number(j.format?.bit_rate || 0),
    container: String(j.format?.format_name || '').split(',')[0],
  };
}

// Esegue ffmpeg. onProgress(secondiElaborati). Restituisce { promise, cancel }
function run(args, { onProgress } = {}) {
  const child = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args, '-progress', 'pipe:1', '-nostats'], { windowsHide: true });
  let cancelled = false, buf = '', errTail = '';
  child.stdout.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const m = /^out_time_(?:us|ms)=(-?\d+)/.exec(line); // entrambe in microsecondi
      if (m && onProgress && +m[1] >= 0) onProgress(+m[1] / 1e6);
    }
  });
  child.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-4000); });
  const promise = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(new Error('impossibile avviare ffmpeg: ' + e.message)));
    child.on('close', (code) => {
      if (cancelled) return reject(Object.assign(new Error('annullato'), { cancelled: true }));
      if (code === 0) return resolve();
      const lines = errTail.trim().split('\n').filter(Boolean);
      reject(new Error(lines[lines.length - 1] || `ffmpeg è terminato con errore (${code})`));
    });
  });
  return { promise, cancel: () => { cancelled = true; child.kill('SIGKILL'); } };
}

// Un fotogramma come JPEG (data URL) al tempo t, per l'anteprima quando il video non è riproducibile
async function thumbnail(file, t, width = 720) {
  const r = await collect(spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-ss', String(Math.max(0, t)), '-i', file, '-frames:v', '1',
    '-vf', `scale='min(${width},iw)':-2`, '-f', 'image2pipe', '-vcodec', 'mjpeg', '-q:v', '4', 'pipe:1'], { windowsHide: true }));
  if (r.code !== 0 || !r.out.length) throw new Error('anteprima non disponibile');
  return `data:image/jpeg;base64,${r.out.toString('base64')}`;
}

// Forma d'onda: minimo e massimo (-128..127) per ciascuno dei `buckets` intervalli, leggendo l'audio a 8 kHz mono
function waveform(file, buckets, duration) {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-acodec', 'pcm_s16le', 'pipe:1'], { windowsHide: true });
    const total = Math.max(1, Math.floor(duration * 8000)), per = Math.max(1, Math.ceil(total / buckets));
    const n = Math.ceil(total / per), mn = new Int8Array(n).fill(127), mx = new Int8Array(n).fill(-128);
    let pos = 0, carry = null, err = '';
    child.stdout.on('data', (chunk) => {
      let b = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = b.length - (b.length % 2);
      carry = usable < b.length ? b.subarray(usable) : null;
      for (let i = 0; i < usable; i += 2, pos++) {
        const k = Math.min(n - 1, (pos / per) | 0), v = b.readInt16LE(i) >> 8;
        if (v < mn[k]) mn[k] = v; if (v > mx[k]) mx[k] = v;
      }
    });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0 && !pos) return reject(new Error('forma d’onda non disponibile: ' + err.trim().split(String.fromCharCode(10)).pop()));
      for (let i = 0; i < n; i++) if (mn[i] > mx[i]) { mn[i] = 0; mx[i] = 0; } // intervalli rimasti vuoti
      resolve({ min: mn, max: mx, buckets: n });
    });
  });
}

module.exports = { FFMPEG, FFPROBE, probe, run, thumbnail, waveform };
