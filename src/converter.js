const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const { Document, Packer, Paragraph, ImageRun } = require('docx');
const { buildDocx } = require('./docx-text');
const { layoutDocument } = require('./layout');

const RASTER = new Set(['png', 'jpg', 'webp', 'avif', 'tiff', 'bmp', 'gif']);
const IMAGE_IN = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'tif', 'tiff', 'gif', 'bmp', 'svg']);

function uniquePath(dir, base, ext) {
  let p = path.join(dir, `${base}.${ext}`);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i}).${ext}`);
  return p;
}

// sharp non legge i BMP: decodifica minimale 24/32 bit non compressi
function decodeBmp(buf) {
  const off = buf.readUInt32LE(10);
  const w = buf.readInt32LE(18);
  let h = buf.readInt32LE(22);
  const bpp = buf.readUInt16LE(28);
  if (buf.readUInt32LE(30) !== 0 && buf.readUInt32LE(30) !== 3) throw new Error('BMP compresso non supportato');
  if (bpp !== 24 && bpp !== 32) throw new Error('BMP: supportati solo 24/32 bit');
  const topDown = h < 0;
  h = Math.abs(h);
  const bytes = bpp / 8;
  const stride = Math.ceil((w * bpp) / 32) * 4;
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = off + (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const s = row + x * bytes, d = (y * w + x) * 4;
      out[d] = buf[s + 2]; out[d + 1] = buf[s + 1]; out[d + 2] = buf[s];
      out[d + 3] = bpp === 32 ? buf[s + 3] : 255;
    }
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function encodeBmp(pngBuf) {
  const { data, info } = await sharp(pngBuf).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const stride = Math.ceil((w * 24) / 32) * 4;
  const size = 54 + stride * h;
  const out = Buffer.alloc(size);
  out.write('BM', 0); out.writeUInt32LE(size, 2); out.writeUInt32LE(54, 10);
  out.writeUInt32LE(40, 14); out.writeInt32LE(w, 18); out.writeInt32LE(h, 22);
  out.writeUInt16LE(1, 26); out.writeUInt16LE(24, 28); out.writeUInt32LE(stride * h, 34);
  for (let y = 0; y < h; y++) {
    const row = 54 + (h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 3, d = row + x * 3;
      out[d] = data[s + 2]; out[d + 1] = data[s + 1]; out[d + 2] = data[s];
    }
  }
  return out;
}

// Il rendering PDF è delegato a Chromium (pdfjs in una finestra nascosta): vedi pdf-renderer.js
let pdfRenderer = async () => { throw new Error('rendering PDF non disponibile'); };
const setPdfRenderer = (fn) => { pdfRenderer = fn; };
let pdfExtractor = async () => [];
const setPdfExtractor = (fn) => { pdfExtractor = fn; };

// Restituisce l'elenco di pagine/immagini PNG del file di input
async function loadAsPngs(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const buf = fs.readFileSync(file);
  if (ext === 'pdf') return pdfRenderer(buf);
  if (ext === 'bmp') return [await decodeBmp(buf)];
  if (IMAGE_IN.has(ext)) return [await sharp(buf, { density: 192 }).rotate().png().toBuffer()]; // rotate(): applica l'orientamento EXIF
  throw new Error(`formato di input non supportato: .${ext}`);
}

async function toPdf(pngs) {
  const pdf = await PDFDocument.create();
  for (const png of pngs) {
    const img = await pdf.embedPng(png);
    const page = pdf.addPage([img.width * 0.75, img.height * 0.75]);
    page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  return Buffer.from(await pdf.save());
}

async function toDocx(pngs) {
  const children = [];
  for (const png of pngs) {
    const { width, height } = await sharp(png).metadata();
    const w = Math.min(600, width), h = Math.round((height * w) / width);
    children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: h } })] }));
  }
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

// Formati di salvataggio degli strumenti e valori predefiniti di qualità (jpg/webp/avif)
const FORMATS = ['png', 'jpg', 'webp', 'avif', 'tiff', 'bmp'];
const DEFAULT_QUALITY = { jpg: 92, webp: 90, avif: 60 };

// Codifica un'immagine (istanza sharp, anche con trasparenza). JPG e BMP non hanno trasparenza: lo sfondo si riempie con `background`
async function encodeImage(input, fmt, { quality, background = '#ffffff' } = {}) {
  const q = Math.min(100, Math.max(1, Math.round(quality || DEFAULT_QUALITY[fmt] || 90)));
  switch (fmt) {
    case 'png': return input.png().toBuffer();
    case 'jpg': return input.flatten({ background }).jpeg({ quality: q }).toBuffer();
    case 'webp': return input.webp({ quality: q }).toBuffer();
    case 'avif': return input.avif({ quality: q }).toBuffer();
    case 'tiff': return input.tiff({ compression: 'lzw' }).toBuffer(); // senza perdita (il predefinito di sharp è JPEG)
    case 'gif': return input.gif().toBuffer();
    case 'bmp': return encodeBmp(await input.flatten({ background }).png().toBuffer());
    default: throw new Error(`formato sconosciuto: ${fmt}`);
  }
}

async function encodeRaster(png, fmt, opts) {
  return fmt === 'png' ? png : encodeImage(sharp(png), fmt, opts);
}

async function convert(file, fmt) {
  const dir = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  const inExt = path.extname(file).slice(1).toLowerCase().replace('jpeg', 'jpg').replace('tif', 'tiff');
  if (inExt === fmt) throw new Error('già in questo formato');
  const outputs = [];
  if (fmt === 'docx' && inExt === 'pdf') {
    const pages = await pdfExtractor(fs.readFileSync(file));
    if (pages.flatMap((p) => p.items).reduce((n, i) => n + i.str.trim().length, 0) >= 20) {
      const out = uniquePath(dir, base, 'docx');
      fs.writeFileSync(out, await buildDocx(pages));
      return [out];
    }
    // PDF scansionato (nessun testo): ripiego sulle immagini delle pagine
  }
  if (fmt === 'txt' && inExt === 'pdf') {
    const { blocks } = layoutDocument(await pdfExtractor(fs.readFileSync(file)));
    const text = blocks.map((b) => (b.type === 'table' ? b.rows.map((r) => r.map((c) => c.map((x) => x.text).join('')).join('\t')).join('\n') : b.type === 'figure' ? '' : b.runs.map((r) => r.text).join('')))
      .filter((t) => t.trim()).join('\n\n');
    if (text.trim().length < 5) throw new Error('il PDF non contiene testo (forse è una scansione)');
    const out = uniquePath(dir, base, 'txt');
    fs.writeFileSync(out, text + '\n', 'utf8');
    return [out];
  }
  const pngs = await loadAsPngs(file);
  if (fmt === 'pdf' || fmt === 'docx') {
    const data = fmt === 'pdf' ? await toPdf(pngs) : await toDocx(pngs);
    const out = uniquePath(dir, base, fmt);
    fs.writeFileSync(out, data);
    outputs.push(out);
  } else if (RASTER.has(fmt)) {
    for (let i = 0; i < pngs.length; i++) {
      const out = uniquePath(dir, pngs.length > 1 ? `${base}-${i + 1}` : base, fmt);
      fs.writeFileSync(out, await encodeRaster(pngs[i], fmt));
      outputs.push(out);
    }
  } else throw new Error(`formato di output sconosciuto: ${fmt}`);
  return outputs;
}

// Sfondo sfumato + padding + angoli arrotondati + ombra
async function addBackground(file) {
  const png = (await loadAsPngs(file))[0];
  const { width: w, height: h } = await sharp(png).metadata();
  const pad = Math.round(Math.max(w, h) * 0.12);
  const radius = Math.round(Math.min(w, h) * 0.04);
  const W = w + pad * 2, H = h + pad * 2;
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="#fff"/></svg>`);
  const rounded = await sharp(png).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const shadowSrc = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0.4 } } })
    .composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const shadow = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: shadowSrc, left: pad, top: pad + Math.round(pad / 4) }]).blur(Math.max(1, pad / 5)).png().toBuffer();
  const bg = Buffer.from(`<svg width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f5a623"/><stop offset=".5" stop-color="#ee4b5b"/><stop offset="1" stop-color="#7b61d6"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/></svg>`);
  const out = uniquePath(path.dirname(file), `${path.basename(file, path.extname(file))} With Background`, 'png');
  await sharp(bg).composite([{ input: shadow }, { input: rounded, left: pad, top: pad }]).png().toFile(out);
  return [out];
}


// ---- Ritaglio e ridimensionamento: il risultato resta nello stesso formato dell'originale (GIF/SVG -> PNG)
const SAME_FORMAT = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', tif: 'tiff', tiff: 'tiff', bmp: 'bmp' };
const fileExt = (file) => path.extname(file).slice(1).toLowerCase();

// output: { format, quality, background }; senza format resta quello dell'originale
async function saveEdited(file, png, suffix, output = {}) {
  const fmt = FORMATS.includes(output.format) ? output.format : SAME_FORMAT[fileExt(file)] || 'png';
  const out = uniquePath(path.dirname(file), `${path.basename(file, path.extname(file))} ${suffix}`, fmt);
  fs.writeFileSync(out, await encodeRaster(png, fmt, output));
  return out;
}

// Anteprima ridotta (PNG data URL) e dimensioni reali, per la finestra di ritaglio
async function previewOf(file, max = 1400) {
  const png = (await loadAsPngs(file))[0];
  const { width, height } = await sharp(png).metadata();
  const small = await sharp(png).resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  return { width, height, dataUrl: `data:image/png;base64,${small.toString('base64')}` };
}

async function sizeOf(file) {
  const { width, height } = await sharp((await loadAsPngs(file))[0]).metadata();
  return { width, height };
}

// rect in pixel dell'immagine originale
async function cropImage(file, rect, output) {
  const png = (await loadAsPngs(file))[0];
  const { width, height } = await sharp(png).metadata();
  const left = Math.max(0, Math.min(Math.round(rect.left), width - 1));
  const top = Math.max(0, Math.min(Math.round(rect.top), height - 1));
  const w = Math.max(1, Math.min(Math.round(rect.width), width - left));
  const h = Math.max(1, Math.min(Math.round(rect.height), height - top));
  return [await saveEdited(file, await sharp(png).extract({ left, top, width: w, height: h }).png().toBuffer(), 'Cropped', output)];
}

// opts: { percent } oppure { width, height, lock }. Con lock le proporzioni restano e W×H è un riquadro massimo.
async function resizeImage(file, opts, output) {
  const png = (await loadAsPngs(file))[0];
  const { width, height } = await sharp(png).metadata();
  let w, h, fit = 'fill';
  if (opts.percent) {
    w = Math.max(1, Math.round((width * opts.percent) / 100));
    h = Math.max(1, Math.round((height * opts.percent) / 100));
  } else {
    w = opts.width ? Math.max(1, Math.round(opts.width)) : undefined;
    h = opts.height ? Math.max(1, Math.round(opts.height)) : undefined;
    if (!w && !h) throw new Error('indica una dimensione');
    if (opts.lock) fit = 'inside';
    else { w = w || width; h = h || height; }
  }
  return [await saveEdited(file, await sharp(png).resize({ width: w, height: h, fit }).png().toBuffer(), 'Resized', output)];
}

// PNG dell'immagine con orientamento EXIF applicato (per gli strumenti che lavorano sui pixel)
const loadImagePng = async (file) => (await loadAsPngs(file))[0];

module.exports = { convert, addBackground, loadImagePng, uniquePath, encodeImage, FORMATS, cropImage, resizeImage, previewOf, sizeOf, setPdfRenderer, setPdfExtractor };
