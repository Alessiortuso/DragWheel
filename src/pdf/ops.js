// Lavoro sui PDF (funzioni pure, senza Electron): lettura, modifiche disegnate sulle pagine, riordino delle pagine,
// moduli, divisione, compressione delle immagini. Le coordinate delle modifiche sono in punti, sulla pagina come
// la si vede (vedi geometry.js).
const zlib = require('zlib');
const sharp = require('sharp');
const {
  PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFStream, StandardFonts, rgb, degrees, BlendMode,
  LineCapStyle, LineJoinStyle, pushGraphicsState, popGraphicsState, setLineWidth, setLineCap, setLineJoin, moveTo, lineTo,
  stroke, setStrokingRgbColor, setGraphicsState, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, PDFOptionList,
} = require('pdf-lib');
const { displaySize, rotationOf, toPdfPoint, toPdfRect } = require('./geometry');

async function load(bytes) {
  try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypt/i.test(e.message) ? 'il PDF è protetto da password' : `PDF non leggibile: ${e.message}`); }
}

// ---- lettura ---------------------------------------------------------------------------------------------
function fieldsOf(doc) {
  let form;
  try { form = doc.getForm(); } catch { return []; }
  const out = [];
  for (const f of form.getFields()) {
    const base = { name: f.getName(), readOnly: f.isReadOnly() };
    try {
      if (f instanceof PDFTextField) out.push({ ...base, type: 'text', value: f.getText() || '', multiline: f.isMultiline() });
      else if (f instanceof PDFCheckBox) out.push({ ...base, type: 'check', value: f.isChecked() });
      else if (f instanceof PDFDropdown) out.push({ ...base, type: 'choice', value: f.getSelected()[0] || '', options: f.getOptions() });
      else if (f instanceof PDFOptionList) out.push({ ...base, type: 'choice', value: f.getSelected()[0] || '', options: f.getOptions() });
      else if (f instanceof PDFRadioGroup) out.push({ ...base, type: 'radio', value: f.getSelected() || '', options: f.getOptions() });
    } catch {}
  }
  return out;
}

async function inspect(bytes) {
  const probe = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  if (probe.isEncrypted) return { encrypted: true, pages: [], fields: [], size: bytes.length };
  const doc = await load(bytes);
  const pages = doc.getPages().map((p) => ({ ...displaySize(p), rotation: rotationOf(p) }));
  const meta = { title: doc.getTitle() || '', author: doc.getAuthor() || '', subject: doc.getSubject() || '', keywords: doc.getKeywords() || '' };
  return { encrypted: false, pages, fields: fieldsOf(doc), meta, size: bytes.length };
}

// ---- modifiche disegnate --------------------------------------------------------------------------------
const FONTS = {
  helv: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  courier: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};
// i caratteri standard del PDF conoscono solo l'alfabeto latino (WinAnsi): il resto diventa "?"
const winAnsi = (s) => String(s).replace(/\t/g, '    ').replace(/[^\n\x20-\x7e -ÿ€‘’‚“”„–—•…†‡‰ŠšŒœŽžŸƒˆ˜™]/gu, '?');
const color = (hex = '#000000') => { const n = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };

// linea di base nella riga alta 1,2 volte il corpo, come la mette il browser con Arial, Times New Roman e Courier New
const BASELINE = { helv: 0.947, times: 0.9375, courier: 0.8665 };

// a capo automatico alla larghezza del riquadro (stesse metriche di Arial/Times New Roman/Courier New nell'editor)
function wrap(text, font, size, width) {
  const out = [];
  for (const para of winAnsi(text).split('\n')) {
    let line = '';
    for (const word of para.split(/(?<= )/)) {
      const tryLine = line + word;
      if (!line || font.widthOfTextAtSize(tryLine.trimEnd(), size) <= width + 0.5) { line = tryLine; continue; }
      out.push(line.trimEnd()); line = word;
      while (font.widthOfTextAtSize(line.trimEnd(), size) > width + 0.5 && line.length > 1) { // parola più lunga del riquadro
        let k = line.length - 1;
        while (k > 1 && font.widthOfTextAtSize(line.slice(0, k), size) > width) k--;
        out.push(line.slice(0, k)); line = line.slice(k);
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

async function applyEdits(doc, page, items, cache) {
  const rot = rotationOf(page);
  const font = async (fam, bold, italic) => {
    const name = (FONTS[fam] || FONTS.helv)[(bold ? 1 : 0) + (italic ? 2 : 0)];
    return (cache.fonts[name] ||= await doc.embedFont(name));
  };
  const at = (x, y) => { const [px, py] = toPdfPoint(page, x, y); return { x: px, y: py }; };
  // punto (lx, ly) nel riquadro della voce -> pagina, con la voce ruotata di it.rot gradi (orari) attorno al suo centro
  const frame = (it, h) => {
    const a = ((it.rot || 0) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), cx = it.x + it.w / 2, cy = it.y + h / 2;
    return (lx, ly) => { const dx = lx - it.w / 2, dy = ly - h / 2; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; };
  };
  const boxOpts = (it) => { const [x1, y1, x2, y2] = toPdfRect(page, it); return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }; };
  // tratti (penna, linee, frecce): un unico percorso con giunzioni arrotondate
  const strokePath = (paths, it) => {
    const gs = page.maybeEmbedGraphicsState({ borderOpacity: it.opacity ?? 1 });
    const c = color(it.color);
    const ops = [pushGraphicsState(), ...(gs ? [setGraphicsState(gs)] : []), setStrokingRgbColor(c.red, c.green, c.blue), setLineWidth(it.width || 2), setLineCap(LineCapStyle.Round), setLineJoin(LineJoinStyle.Round)];
    for (const pts of paths) pts.forEach(([x, y], i) => { const p = at(x, y); ops.push(i ? lineTo(p.x, p.y) : moveTo(p.x, p.y)); });
    ops.push(stroke(), popGraphicsState());
    page.pushOperators(...ops);
  };

  for (const it of items) {
    switch (it.type) {
      case 'text': {
        if (!String(it.text || '').trim()) break;
        const f = await font(it.font, it.bold, it.italic), size = it.size || 12, lead = size * 1.2;
        const lines = wrap(it.text, f, size, it.w), turn = frame(it, lines.length * lead);
        lines.forEach((line, i) => {
          const lw = f.widthOfTextAtSize(line, size);
          const dx = it.align === 'center' ? (it.w - lw) / 2 : it.align === 'right' ? it.w - lw : 0;
          const p = at(...turn(dx, i * lead + (BASELINE[it.font] || BASELINE.helv) * size));
          page.drawText(line, { x: p.x, y: p.y, size, font: f, color: color(it.color), rotate: degrees(rot - (it.rot || 0)), opacity: it.opacity ?? 1 });
        });
        break;
      }
      case 'whiteout':
        page.drawRectangle({ ...boxOpts(it), color: color(it.color || '#ffffff') });
        break;
      case 'redact': // la pagina è già stata sostituita dall'immagine annerita: qui resta solo il riquadro nero sopra
        page.drawRectangle({ ...boxOpts(it), color: rgb(0, 0, 0) });
        break;
      case 'highlight':
        page.drawRectangle({ ...boxOpts(it), color: color(it.color || '#ffe500'), opacity: it.opacity ?? 0.4, blendMode: BlendMode.Multiply });
        break;
      case 'rect':
      case 'ellipse': {
        const o = {
          borderColor: it.stroke ? color(it.stroke) : undefined, borderWidth: it.stroke ? it.width || 2 : 0,
          color: it.fill ? color(it.fill) : undefined, opacity: it.fill ? it.opacity ?? 1 : undefined, borderOpacity: it.opacity ?? 1,
        };
        if (it.type === 'rect') page.drawRectangle({ ...boxOpts(it), ...o });
        else { const c = at(it.x + it.w / 2, it.y + it.h / 2); page.drawEllipse({ x: c.x, y: c.y, ...(rot % 180 ? { xScale: it.h / 2, yScale: it.w / 2 } : { xScale: it.w / 2, yScale: it.h / 2 }), ...o }); }
        break;
      }
      case 'line':
      case 'arrow': {
        const paths = [[[it.x1, it.y1], [it.x2, it.y2]]];
        if (it.type === 'arrow') {
          const a = Math.atan2(it.y2 - it.y1, it.x2 - it.x1), L = Math.max(8, (it.width || 2) * 4);
          paths.push([[it.x2 - L * Math.cos(a - 0.45), it.y2 - L * Math.sin(a - 0.45)], [it.x2, it.y2], [it.x2 - L * Math.cos(a + 0.45), it.y2 - L * Math.sin(a + 0.45)]]);
        }
        strokePath(paths, it);
        break;
      }
      case 'ink':
        if (it.paths && it.paths.length) strokePath(it.paths, it);
        break;
      case 'image': {
        const key = it.data.slice(0, 64) + it.data.length;
        let img = cache.images[key];
        if (!img) {
          const buf = new Uint8Array(Buffer.from(it.data, 'base64')); // copia: pdf-lib legge male i Buffer del pool di Node
          img = cache.images[key] = buf[0] === 0xff ? await doc.embedJpg(buf) : await doc.embedPng(buf);
        }
        const p = at(...frame(it, it.h)(0, it.h)); // angolo in basso a sinistra dell'immagine
        page.drawImage(img, { x: p.x, y: p.y, width: it.w, height: it.h, rotate: degrees(rot - (it.rot || 0)), opacity: it.opacity ?? 1 });
        break;
      }
      default:
    }
  }
}

// Pagina oscurata: al posto del contenuto originale (testo compreso) un'immagine della pagina con i riquadri neri
async function rasterPage(doc, index, jpeg) {
  const old = doc.getPage(index);
  const { width, height } = displaySize(old);
  doc.removePage(index);
  const page = doc.insertPage(index, [width, height]);
  const img = await doc.embedJpg(new Uint8Array(Buffer.from(jpeg, 'base64')));
  page.drawImage(img, { x: 0, y: 0, width, height });
  return page;
}

function fillForm(doc, values, flatten) {
  const form = doc.getForm();
  for (const [name, v] of Object.entries(values || {})) {
    let f; try { f = form.getField(name); } catch { continue; }
    try {
      if (f instanceof PDFTextField) f.setText(winAnsi(v));
      else if (f instanceof PDFCheckBox) (v ? f.check() : f.uncheck());
      else if (f instanceof PDFDropdown || f instanceof PDFOptionList || f instanceof PDFRadioGroup) { if (v) f.select(v); }
    } catch {}
  }
  if (flatten) form.flatten();
}

// state: { plan: [{ id, src, page, rotate }], edits: { id: [voci] }, redactions: { id: jpeg base64 }, form, flatten, meta }
// sources: Buffer di ciascun file (indice = src). Restituisce { bytes, changed } (changed false = file originale invariato)
async function build(sources, state = {}) {
  const plan = state.plan || [];
  if (!plan.length) throw new Error('il documento non ha pagine');
  const edits = state.edits || {}, red = state.redactions || {};
  const hasEdits = plan.some((p) => (edits[p.id] || []).length || red[p.id]);
  const hasForm = Object.keys(state.form || {}).length || state.flatten;
  const src0 = await load(sources[plan[0].src]);
  const identity = plan.every((p, i) => p.src === plan[0].src && p.page === i && !(p.rotate % 360)) && src0.getPageCount() === plan.length;
  if (identity && !hasEdits && !hasForm && !state.meta) return { bytes: sources[plan[0].src], changed: false };

  let doc, pages;
  if (identity) { // stesse pagine nello stesso ordine: si modifica il documento (restano segnalibri, link, moduli)
    doc = src0;
    if (hasForm) fillForm(doc, state.form, state.flatten);
    pages = doc.getPages();
  } else {
    doc = await PDFDocument.create();
    const loaded = new Map([[plan[0].src, src0]]);
    if (hasForm) fillForm(src0, state.form, true); // le pagine copiate non portano con sé il modulo: si stampa il contenuto
    const src = async (i) => { if (!loaded.has(i)) loaded.set(i, await load(sources[i])); return loaded.get(i); };
    pages = [];
    for (const p of plan) {
      const s = await src(p.src);
      const [copy] = await doc.copyPages(s, [p.page]);
      copy.setRotation(degrees((((rotationOf(copy) + (p.rotate || 0)) % 360) + 360) % 360));
      pages.push(doc.addPage(copy));
    }
    for (const k of ['Title', 'Author', 'Subject', 'Keywords']) { const v = src0[`get${k}`](); if (v) doc[`set${k}`](k === 'Keywords' ? [v] : v); }
  }

  const cache = { fonts: {}, images: {} };
  for (let i = 0; i < plan.length; i++) {
    const id = plan[i].id;
    if (red[id]) pages[i] = await rasterPage(doc, i, red[id]);
    if ((edits[id] || []).length) await applyEdits(doc, pages[i], edits[id], cache);
  }
  if (state.meta) {
    const m = state.meta;
    doc.setTitle(m.title || ''); doc.setAuthor(m.author || ''); doc.setSubject(m.subject || '');
    doc.setKeywords(m.keywords ? [m.keywords] : []); doc.setProducer('DragWheel'); doc.setModificationDate(new Date());
    if (m.strip) { doc.setCreator(''); doc.setProducer(''); doc.catalog.delete(PDFName.of('Metadata')); }
  }
  return { bytes: Buffer.from(await doc.save()), changed: true };
}

// Pagine scelte (indici) -> nuovo PDF
async function extract(bytes, indices) {
  const src = await load(bytes), doc = await PDFDocument.create();
  for (const p of await doc.copyPages(src, indices)) doc.addPage(p);
  return Buffer.from(await doc.save());
}

// Un'immagine qualsiasi -> PDF di una pagina A4 (orientata come l'immagine), con l'immagine centrata e intera
async function imageToPdf(buf) {
  const png = await sharp(buf, { limitInputPixels: false }).rotate().png().toBuffer();
  const { width, height } = await sharp(png).metadata();
  const doc = await PDFDocument.create(), img = await doc.embedPng(png);
  const [A, B] = width > height ? [842, 595] : [595, 842];
  const s = Math.min(A / width, B / height);
  const page = doc.addPage([A, B]);
  page.drawImage(img, { x: (A - width * s) / 2, y: (B - height * s) / 2, width: width * s, height: height * s });
  return Buffer.from(await doc.save());
}

async function blankPdf(width = 595.28, height = 841.89) {
  const doc = await PDFDocument.create();
  doc.addPage([width, height]);
  return Buffer.from(await doc.save());
}

// ---- compressione -------------------------------------------------------------------------------------------
const LEVELS = { high: { max: 2400, q: 85 }, balanced: { max: 1600, q: 72 }, small: { max: 1100, q: 55 } };

// Rimuove il filtro PNG dalle righe (predittori 10-15) di un'immagine decompressa
function unpredict(data, width, colors, bpc, height) {
  const bpp = Math.max(1, (colors * bpc) >> 3), rowLen = Math.ceil((width * colors * bpc) / 8);
  const out = Buffer.alloc(rowLen * height);
  let prev = Buffer.alloc(rowLen);
  for (let y = 0; y < height; y++) {
    const ft = data[y * (rowLen + 1)], row = data.subarray(y * (rowLen + 1) + 1, (y + 1) * (rowLen + 1)), cur = out.subarray(y * rowLen, (y + 1) * rowLen);
    for (let x = 0; x < rowLen; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (ft === 1) v += a; else if (ft === 2) v += b; else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[x] = v & 255;
    }
    prev = cur;
  }
  return out;
}

// Tiene solo gli oggetti raggiungibili dal catalogo (le versioni vecchie lasciate dagli aggiornamenti spariscono)
function dropUnreachable(ctx) {
  const seen = new Set(), stack = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean);
  const visit = (o) => {
    if (o instanceof PDFRef) { if (!seen.has(o.tag)) { seen.add(o.tag); stack.push(o); } }
    else if (o instanceof PDFDict) for (const [, v] of o.entries()) visit(v);
    else if (o instanceof PDFArray) for (let i = 0; i < o.size(); i++) visit(o.get(i));
    else if (o instanceof PDFStream) visit(o.dict);
  };
  stack.forEach((r) => seen.add(r.tag));
  while (stack.length) visit(ctx.lookup(stack.pop()));
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
}

async function compress(bytes, level = 'balanced') {
  const L = LEVELS[level] || LEVELS.balanced;
  const doc = await load(bytes), ctx = doc.context;
  let images = 0, recompressed = 0;
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    const d = obj.dict, name = (k) => { const v = d.lookup(PDFName.of(k)); return v ? v.toString() : ''; };
    if (name('Subtype') !== '/Image' || d.get(PDFName.of('ImageMask')) || d.get(PDFName.of('Decode'))) continue;
    images++;
    const w = d.lookup(PDFName.of('Width')).asNumber(), h = d.lookup(PDFName.of('Height')).asNumber();
    const bpc = (d.lookup(PDFName.of('BitsPerComponent')) || { asNumber: () => 8 }).asNumber();
    let filter = d.lookup(PDFName.of('Filter'));
    if (filter instanceof PDFArray) { if (filter.size() !== 1) continue; filter = filter.lookup(0); }
    filter = filter ? filter.toString() : '';
    let cs = d.lookup(PDFName.of('ColorSpace')), channels = 0;
    if (cs && cs.toString() === '/DeviceRGB') channels = 3;
    else if (cs && cs.toString() === '/DeviceGray') channels = 1;
    else if (cs instanceof PDFArray && cs.lookup(0).toString() === '/ICCBased') { const n = cs.lookup(1).dict.lookup(PDFName.of('N')); channels = n ? n.asNumber() : 0; }
    if (channels !== 1 && channels !== 3) continue;
    const scale = Math.min(1, L.max / Math.max(w, h));
    if (w * h < 40000) continue; // icone e piccoli elementi grafici: non vale la pena
    try {
      let input;
      if (filter === '/DCTDecode') input = sharp(Buffer.from(obj.contents));
      else if (filter === '/FlateDecode' && bpc === 8) {
        if (scale === 1 && level !== 'small') continue; // grafica senza perdita già della giusta dimensione: si lascia così
        let raw = zlib.inflateSync(Buffer.from(obj.contents));
        const parms = d.lookup(PDFName.of('DecodeParms'));
        const pred = parms instanceof PDFDict && parms.lookup(PDFName.of('Predictor')) ? parms.lookup(PDFName.of('Predictor')).asNumber() : 1;
        if (pred >= 10) raw = unpredict(raw, w, channels, 8, h); else if (pred > 1) continue;
        if (raw.length < w * h * channels) continue;
        input = sharp(raw.subarray(0, w * h * channels), { raw: { width: w, height: h, channels } });
      } else continue;
      let pipe = input;
      if (scale < 1) pipe = pipe.resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
      if (channels === 1) pipe = pipe.toColourspace('b-w');
      const { data, info } = await pipe.jpeg({ quality: L.q, mozjpeg: true }).toBuffer({ resolveWithObject: true });
      if (data.length >= obj.contents.length * 0.9) continue;
      const nd = d.clone(ctx);
      nd.set(PDFName.of('Width'), ctx.obj(info.width)); nd.set(PDFName.of('Height'), ctx.obj(info.height));
      nd.set(PDFName.of('BitsPerComponent'), ctx.obj(8)); nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode'));
      nd.delete(PDFName.of('DecodeParms'));
      if (info.channels === 1 && channels === 3) nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceGray'));
      ctx.assign(ref, PDFRawStream.of(nd, data));
      recompressed++;
    } catch {}
  }
  dropUnreachable(ctx);
  return { bytes: Buffer.from(await doc.save({ useObjectStreams: true })), images, recompressed };
}

module.exports = { inspect, build, extract, imageToPdf, blankPdf, compress, applyEdits, wrap, winAnsi, load };
