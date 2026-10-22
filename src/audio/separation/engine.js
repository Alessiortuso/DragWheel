// Separazione voce / musica con HT-Demucs (modello ONNX "htdemucs", MIT, Meta): gira in locale con onnxruntime.
// Il modello divide il brano in batteria, basso, altro e voce; da queste parti si ricavano "voce" e "musica" (tutto tranne la voce).
// Va eseguito in un processo separato (vedi worker.js): per qualche minuto occupa la CPU e centinaia di MB di memoria.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const ort = require('onnxruntime-node');
const { FFMPEG } = require('../../video/ffmpeg');
const { codecArgs } = require('../codecs');

const MODELS_DIR = process.env.DRAGWHEEL_MODELS || path.join(__dirname, '..', '..', '..', 'models');
const MODEL_FILE = 'htdemucs.onnx';
const SR = 44100;
const SEGMENT = 343980;               // campioni per blocco (circa 7,8 s): è la dimensione fissa del modello
const OVERLAP = Math.floor(SEGMENT / 4);
// Peso di ciascuna parte (batteria, basso, altro, voce) in ogni risultato richiesto
const TARGETS = {
  vocals: [0, 0, 0, 1], music: [1, 1, 1, 0], drums: [1, 0, 0, 0], bass: [0, 1, 0, 0], other: [0, 0, 1, 0],
};

let session = null;
async function getSession() {
  if (!session) {
    const file = path.join(MODELS_DIR, MODEL_FILE);
    if (!fs.existsSync(file)) throw new Error(`modello non trovato: ${MODEL_FILE} (esegui "npm run get-models")`);
    session = ort.InferenceSession.create(file, { executionProviders: ['cpu'], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false });
  }
  return session;
}

// Audio del file (anche di un video) come PCM float 32 bit, stereo, 44,1 kHz: Float32Array interleavato
function decode(file, isCancelled) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-i', file, '-vn', '-map', '0:a:0', '-ac', '2', '-ar', String(SR), '-f', 'f32le', 'pipe:1'], { windowsHide: true });
    const chunks = []; let err = '';
    p.stdout.on('data', (d) => chunks.push(d));
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => {
      if (isCancelled && isCancelled()) return reject(Object.assign(new Error('annullato'), { cancelled: true }));
      const buf = Buffer.concat(chunks);
      if (code !== 0 || buf.length < 8) return reject(new Error(err.trim().split('\n').pop() || 'il file non contiene audio'));
      const out = new Float32Array(Math.floor(buf.length / 8) * 2);
      Buffer.from(out.buffer).set(buf.subarray(0, out.length * 4));
      resolve(out);
    });
  });
}

// Finestra di sovrapposizione: sfuma ai bordi interni, non all'inizio e alla fine del brano
function windowFor(first, last) {
  const w = new Float32Array(SEGMENT).fill(1);
  for (let i = 0; i < OVERLAP; i++) { const f = (i + 1) / (OVERLAP + 1); if (!first) w[i] = f; if (!last) w[SEGMENT - 1 - i] = f; }
  return w;
}

// Scrive un risultato (L, R) in un file con ffmpeg; i tag del file originale (titolo, artista…) vengono riportati
function encode(left, right, original, out, { format, bitrate, bitDepth }) {
  return new Promise((resolve, reject) => {
    const args = ['-hide_banner', '-nostdin', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '2', '-i', 'pipe:0', '-i', original,
      '-map', '0:a', '-map_metadata', '1', '-map_chapters', '-1', ...codecArgs(format, bitrate || 192, { bitDepth }), out];
    const p = spawn(FFMPEG, args, { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim().split('\n').pop() || 'scrittura del file non riuscita'))));
    p.stdin.on('error', () => {});
    (async () => {
      const BLOCK = 1 << 18;
      for (let i = 0; i < left.length; i += BLOCK) {
        const n = Math.min(BLOCK, left.length - i), buf = new Float32Array(n * 2);
        for (let k = 0; k < n; k++) { buf[2 * k] = left[i + k]; buf[2 * k + 1] = right[i + k]; }
        if (!p.stdin.write(Buffer.from(buf.buffer))) await new Promise((r) => p.stdin.once('drain', r));
      }
      p.stdin.end();
    })().catch(reject);
  });
}

// job: { file, targets: ['vocals','music',…], outputs: { vocals: percorso, … }, format, bitrate, bitDepth }
async function separate(job, onProgress = () => {}, isCancelled = () => false) {
  const targets = job.targets.filter((t) => TARGETS[t]);
  if (!targets.length) throw new Error('scegli almeno un risultato');
  const check = () => { if (isCancelled()) throw Object.assign(new Error('annullato'), { cancelled: true }); };

  onProgress('Leggo il file…', 0);
  const pcm = await decode(job.file, isCancelled); check();
  const total = pcm.length / 2;
  if (total < SR / 4) throw new Error('il file è troppo corto');
  const L = new Float32Array(total), R = new Float32Array(total);
  for (let i = 0; i < total; i++) { L[i] = pcm[2 * i]; R[i] = pcm[2 * i + 1]; }

  onProgress('Carico il modello…', 0.02);
  const sess = await getSession(); check();
  const out = targets.map(() => [new Float32Array(total), new Float32Array(total)]);
  const weight = new Float32Array(total);
  const stride = SEGMENT - OVERLAP, chunks = Math.max(1, Math.ceil((total - OVERLAP) / stride));
  const input = new Float32Array(2 * SEGMENT);

  for (let c = 0; c < chunks; c++) {
    check();
    const start = c * stride, len = Math.min(SEGMENT, total - start);
    input.fill(0);
    input.set(L.subarray(start, start + len), 0);
    input.set(R.subarray(start, start + len), SEGMENT);
    const res = await sess.run({ mix: new ort.Tensor('float32', input, [1, 2, SEGMENT]) });
    const st = res.stems.data;                                   // (1, 4, 2, SEGMENT): batteria, basso, altro, voce
    const win = windowFor(c === 0, start + len >= total);
    targets.forEach((t, ti) => {
      const wts = TARGETS[t];
      for (let ch = 0; ch < 2; ch++) {
        const dst = out[ti][ch];
        for (let s = 0; s < 4; s++) {
          if (!wts[s]) continue;
          const base = (s * 2 + ch) * SEGMENT;
          for (let i = 0; i < len; i++) dst[start + i] += st[base + i] * win[i];
        }
      }
    });
    for (let i = 0; i < len; i++) weight[start + i] += win[i];
    onProgress('Separo voce e musica…', 0.05 + 0.85 * ((c + 1) / chunks));
  }
  for (const [l, r] of out) for (let i = 0; i < total; i++) { const w = weight[i] || 1; l[i] /= w; r[i] /= w; }

  const written = [];
  try {
    for (let ti = 0; ti < targets.length; ti++) {
      check();
      onProgress('Salvo i file…', 0.9 + 0.1 * (ti / targets.length));
      const file = job.outputs[targets[ti]];
      written.push(file);
      await encode(out[ti][0], out[ti][1], job.file, file, job);
    }
  } catch (e) { for (const f of written) fs.rmSync(f, { force: true }); throw e; }
  onProgress('Fatto', 1);
  return written;
}

module.exports = { separate, TARGETS, SEGMENT, SR };
