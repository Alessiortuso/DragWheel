// Rimozione sfondo: inferenza (onnxruntime, locale) + affinamento dei bordi + correzione del colore.
// Va eseguito in un processo separato (vedi worker.js): l'inferenza occupa la CPU per secondi.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ort = require('onnxruntime-node');
const AO = require('./alpha-ops');
const { loadImagePng, encodeImage } = require('../converter');

const MODELS_DIR = process.env.DRAGWHEEL_MODELS || path.join(__dirname, '..', '..', 'models');
const WORK_MAX = 2048; // risoluzione di lavoro dell'editor: oltre, l'anteprima è ridotta e il salvataggio rifà tutto a piena risoluzione

const MODELS = {
  fast: { label: 'Veloce', file: 'isnet_medium.onnx', size: 1024, norm: (v) => (v - 128) / 256 },
  precise: { label: 'Preciso', file: 'birefnet_lite.onnx', size: 1024, norm: null, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
};

const sessions = new Map();
async function getSession(key) {
  if (!sessions.has(key)) {
    const file = path.join(MODELS_DIR, MODELS[key].file);
    if (!fs.existsSync(file)) throw new Error(`modello non trovato: ${MODELS[key].file} (esegui "npm run get-models")`);
    // Arena e pattern di memoria disattivati: con l'arena il modello preciso trattiene 7-10 GB di RAM anche da fermo;
    // senza, la memoria torna al sistema a fine analisi (resta un picco di ~6 GB durante i 10-15 secondi di calcolo).
    sessions.set(key, ort.InferenceSession.create(file, { executionProviders: ['cpu'], graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false }));
  }
  return sessions.get(key);
}

// Maschera del modello a risoluzione del modello (Uint8, size×size)
async function infer(modelKey, png) {
  const m = MODELS[modelKey], size = m.size, n = size * size;
  const session = await getSession(modelKey);
  const raw = await sharp(png).flatten({ background: '#fff' }).removeAlpha().resize(size, size, { fit: 'fill' }).raw().toBuffer();
  const t = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
    t[c * n + i] = m.norm ? m.norm(raw[i * 3 + c]) : (raw[i * 3 + c] / 255 - m.mean[c]) / m.std[c];
  }
  const out = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', t, [1, 3, size, size]) });
  const o = out[session.outputNames[0]].data;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < n; i++) { if (o[i] < mn) mn = o[i]; if (o[i] > mx) mx = o[i]; }
  const logits = mn < 0 || mx > 1;
  const mask = Buffer.alloc(n);
  for (let i = 0; i < n; i++) mask[i] = Math.round(255 * (logits ? 1 / (1 + Math.exp(-o[i])) : o[i]));
  return mask;
}

const luma = (rgb, n) => {
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;
  return g;
};

// Maschera di base a risoluzione w×h: ingrandita dal modello e poi fatta aderire ai bordi veri dell'immagine
async function baseMask(mask1024, size, rgb, w, h) {
  const up = await sharp(mask1024, { raw: { width: size, height: size, channels: 1 } }).resize(w, h, { fit: 'fill', kernel: 'cubic' }).extractChannel(0).raw().toBuffer(); // extractChannel: sharp altrimenti restituisce 3 canali
  const p = new Float32Array(w * h);
  for (let i = 0; i < p.length; i++) p[i] = up[i] / 255;
  const r = Math.min(6, Math.max(2, Math.round(Math.max(w, h) / 600)));
  const q = AO.guidedFilter(luma(rgb, w * h), p, w, h, r, 3e-4);
  const lo = 0.2, hi = 0.8; // livelli: stringe la sfumatura del bordo (il guidato da solo la lascia larga ~4 px)
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(Math.min(1, Math.max(0, (q[i] - lo) / (hi - lo))) * 255);
  return out;
}

// Elabora un'immagine: restituisce ciò che serve all'editor (anteprima, maschera di base) e allo stato per il salvataggio
async function analyze(file, modelKey, progress = () => {}) {
  progress('Apro l’immagine', 0.05);
  const png = await loadImagePng(file);
  const { width: W, height: H } = await sharp(png).metadata();
  const k = Math.min(1, WORK_MAX / Math.max(W, H));
  const workW = Math.max(1, Math.round(W * k)), workH = Math.max(1, Math.round(H * k));
  const rgb = await sharp(png).flatten({ background: '#fff' }).removeAlpha().resize(workW, workH, { fit: 'fill' }).raw().toBuffer();
  progress('Carico il modello', 0.15);
  await getSession(modelKey);
  progress(modelKey === 'precise' ? 'Analizzo (può richiedere 10-20 secondi)' : 'Analizzo', 0.3);
  const mask = await infer(modelKey, png);
  progress('Rifinisco i bordi', 0.85);
  const base = await baseMask(mask, MODELS[modelKey].size, rgb, workW, workH);
  progress('Fatto', 1);
  return { width: W, height: H, workW, workH, rgb, mask, base, size: MODELS[modelKey].size };
}

// Correzione colore dei bordi (Forte & Pitié, "blur fusion"): toglie il colore dello sfondo dai pixel semitrasparenti
function decontaminate(rgb, alpha, w, h) {
  const n = w * h, s = Math.max(1, Math.max(w, h) / 1500);
  const A = new Float32Array(n), inv = new Float32Array(n);
  for (let i = 0; i < n; i++) { A[i] = alpha[i] / 255; inv[i] = 1 - A[i]; }
  const I = [0, 1, 2].map((c) => { const p = new Float32Array(n); for (let i = 0; i < n; i++) p[i] = rgb[i * 3 + c] / 255; return p; });
  const pass = (F, B, r) => {
    const bA = AO.boxBlur(A, w, h, r), b1A = AO.boxBlur(inv, w, h, r), tmp = new Float32Array(n);
    const Fn = [], Bn = [];
    for (let c = 0; c < 3; c++) {
      for (let i = 0; i < n; i++) tmp[i] = F[c][i] * A[i];
      const bF = AO.boxBlur(tmp, w, h, r);
      for (let i = 0; i < n; i++) tmp[i] = B[c][i] * inv[i];
      const bB = AO.boxBlur(tmp, w, h, r);
      const f = new Float32Array(n), b = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const Fh = bF[i] / (bA[i] + 1e-5), Bh = bB[i] / (b1A[i] + 1e-5);
        f[i] = Math.min(1, Math.max(0, Fh + A[i] * (I[c][i] - A[i] * Fh - inv[i] * Bh)));
        b[i] = Bh;
      }
      Fn.push(f); Bn.push(b);
    }
    return { F: Fn, B: Bn };
  };
  let r = pass(I, I, Math.round(90 * s));
  r = pass(r.F, r.B, Math.max(1, Math.round(6 * s)));
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) out[i * 3 + c] = Math.round(r.F[c][i] * 255);
  return out;
}

// Scrive il PNG finale a piena risoluzione. edits: { keep, remove } (Uint8 a risoluzione di lavoro) e parametri edge/soft
async function exportPng(file, st, opts, progress = () => {}) {
  const { edge = 0, soft = 0, keep, remove, outPath } = opts;
  progress('Preparo l’immagine', 0.1);
  const png = await loadImagePng(file);
  const { data: rgba, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = info, n = W * H;
  const rgb = Buffer.alloc(n * 3), origA = Buffer.alloc(n);
  let hasAlpha = false;
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3];
    // sfondo trasparente dell'originale: per il guidato è come bianco
    rgb[i * 3] = Math.round((rgba[i * 4] * a + 255 * (255 - a)) / 255);
    rgb[i * 3 + 1] = Math.round((rgba[i * 4 + 1] * a + 255 * (255 - a)) / 255);
    rgb[i * 3 + 2] = Math.round((rgba[i * 4 + 2] * a + 255 * (255 - a)) / 255);
    origA[i] = a; if (a < 255) hasAlpha = true;
  }
  progress('Rifinisco i bordi', 0.3);
  const base = await baseMask(st.mask, st.size, rgb, W, H);
  const scale = W / st.workW;
  const up = async (u8) => (W === st.workW && H === st.workH)
    ? Buffer.from(u8)
    : sharp(Buffer.from(u8), { raw: { width: st.workW, height: st.workH, channels: 1 } }).resize(W, H, { fit: 'fill', kernel: 'linear' }).extractChannel(0).raw().toBuffer();
  const keepF = keep ? await up(keep) : new Uint8Array(n), removeF = remove ? await up(remove) : new Uint8Array(n);
  const alpha = AO.compose(AO.adjust(base, W, H, edge, soft, scale), keepF, removeF);
  if (hasAlpha) for (let i = 0; i < n; i++) alpha[i] = Math.round((alpha[i] * origA[i]) / 255);
  progress('Correggo i colori dei bordi', 0.6);
  const clean = decontaminate(rgb, alpha, W, H);
  const out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { out[i * 4] = clean[i * 3]; out[i * 4 + 1] = clean[i * 3 + 1]; out[i * 4 + 2] = clean[i * 3 + 2]; out[i * 4 + 3] = alpha[i]; }
  progress('Salvo', 0.9);
  const buf = await encodeImage(sharp(out, { raw: { width: W, height: H, channels: 4 } }), opts.format || 'png', { quality: opts.quality, background: opts.background });
  fs.writeFileSync(outPath, buf);
  progress('Fatto', 1);
  return outPath;
}

module.exports = { MODELS, analyze, exportPng, decontaminate, infer, baseMask };
