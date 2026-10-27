// Firma digitale dei PDF (PAdES, ETSI.CAdES.detached) e dei file qualsiasi (CAdES, .p7m).
// Il PDF riceve un campo firma con un aggiornamento incrementale (incremental.js); la firma CMS la calcola Windows
// (sign.ps1) con il certificato scelto: quelli installati, le smart card/chiavette di firma digitale o un file .pfx.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument, PDFName, PDFNumber, PDFHexString, PDFString, PDFArray, PDFDict, PDFRef, StandardFonts } = require('pdf-lib');
const { appendUpdate, reserveNumbers } = require('./incremental');
const { toPdfRect } = require('./geometry');

// In un'app impacchettata (asar) lo script sta in app.asar.unpacked
const SCRIPT = path.join(__dirname, 'sign.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const SIG_BYTES = 16384;               // spazio riservato alla firma CMS (certificato e catena compresi)
const RANGE_PLACEHOLDER = 9999999999;  // 10 cifre: sostituite poi dai valori veri, con spazi a pareggiare

function runPs(op, cfg = null, env = {}, timeout = 180000) {
  return new Promise((resolve, reject) => {
    const json = cfg && path.join(os.tmpdir(), `dw-sign-${process.pid}-${Date.now()}.json`);
    if (json) fs.writeFileSync(json, JSON.stringify(cfg), 'utf8');
    const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Op', op, ...(json ? ['-Json', json] : [])];
    const child = spawn('powershell.exe', args, { windowsHide: true, env: { ...process.env, ...env } });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { err = 'tempo scaduto'; child.kill(); }, timeout);
    child.on('error', (e) => { clearTimeout(timer); if (json) fs.rmSync(json, { force: true }); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer); if (json) fs.rmSync(json, { force: true });
      if (code === 0) { try { return resolve(JSON.parse(out.replace(/^﻿/, '').trim() || 'null')); } catch {} }
      reject(new Error(friendly(err || out)));
    });
  });
}

function friendly(err) {
  const s = String(err);
  if (/password|mot de passe|specified network password/i.test(s)) return 'password del certificato errata';
  if (/cancel|annullat|operation was canceled/i.test(s)) return 'firma annullata';
  if (/keyset does not exist|set di chiavi non esiste|smart card|smartcard/i.test(s)) return 'chiave privata non disponibile: controlla che la smart card o la chiavetta sia inserita';
  const line = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(At |In |\+|CategoryInfo|FullyQualifiedErrorId)/.test(l))[0] || 'errore sconosciuto';
  return line.replace(/^.*?:\s*"?(.*?)"?$/, '$1').slice(0, 200);
}

// Certificati personali con chiave privata (anche quelli di smart card e token, se il loro software è installato)
async function listCertificates() {
  const list = (await runPs('list')) || [];
  return (Array.isArray(list) ? list : [list]).filter((c) => c.signing)
    .sort((a, b) => b.nonRepudiation - a.nonRepudiation || new Date(b.notAfter) - new Date(a.notAfter));
}

// Firmatario: funzione (dati) -> firma CMS DER. cert = { thumbprint } oppure { pfx, password }
function windowsSigner(cert, { attached = false, pades = true } = {}) {
  return async (data) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-sig-'));
    try {
      const input = path.join(dir, 'data.bin'), output = path.join(dir, 'sig.p7s');
      fs.writeFileSync(input, data);
      const info = await runPs('sign', { input, output, attached, pades, thumbprint: cert.thumbprint, pfx: cert.pfx },
        cert.pfx ? { DW_PFX_PASS: cert.password || '' } : {});
      return { cms: fs.readFileSync(output), signer: info };
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
}

// ---- aspetto della firma visibile -------------------------------------------------------------------------
const fmtDate = (d) => d.toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const { winAnsi } = require('./ops');

async function appearance(doc, { w, h, rotation, name, date, reason, image }) {
  const ctx = doc.context;
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let img = null;
  if (image) { const u8 = new Uint8Array(image); img = u8[1] === 0x50 ? await doc.embedPng(u8) : await doc.embedJpg(u8); }
  const lines = [['Firmato digitalmente da', font], [name, bold], [fmtDate(date), font], ...(reason ? [[reason, font]] : [])]
    .map(([t, f]) => [winAnsi(t), f]);
  // zona del testo e zona dell'immagine (firma autografa a sinistra se il riquadro è largo, sopra se è alto)
  let tb = { x: 0, y: 0, w, h }, ib = null;
  if (img) {
    if (w > 1.6 * h) { ib = { x: 0, y: 0, w: w * 0.45, h }; tb = { x: w * 0.47, y: 0, w: w * 0.53, h }; }
    else { ib = { x: 0, y: h * 0.42, w, h: h * 0.58 }; tb = { x: 0, y: 0, w, h: h * 0.42 }; }
  }
  let size = Math.min(tb.h / (lines.length * 1.25), 14);
  for (const [t, f] of lines) size = Math.min(size, (tb.w - 4) / Math.max(1, f.widthOfTextAtSize(t, 1)));
  size = Math.max(size, 3);
  let ops = 'q\n';
  if (img) {
    const s = Math.min((ib.w - 4) / img.width, (ib.h - 4) / img.height), iw = img.width * s, ih = img.height * s;
    ops += `q ${iw.toFixed(3)} 0 0 ${ih.toFixed(3)} ${(ib.x + (ib.w - iw) / 2).toFixed(3)} ${(ib.y + (ib.h - ih) / 2).toFixed(3)} cm /Im1 Do Q\n`;
  }
  const lead = size * 1.2, top = tb.y + (tb.h + lines.length * lead) / 2 - size;
  ops += '0.1 0.1 0.35 rg\n';
  lines.forEach(([t, f], i) => { ops += `BT /${f === bold ? 'F2' : 'F1'} ${size.toFixed(3)} Tf ${(tb.x + 2).toFixed(3)} ${(top - i * lead).toFixed(3)} Td ${f.encodeText(t)} Tj ET\n`; });
  ops += 'Q\n';
  const r = (rotation * Math.PI) / 180, c = Math.round(Math.cos(r)), s = Math.round(Math.sin(r));
  return ctx.register(ctx.stream(ops, {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Matrix: [c, s, -s, c, 0, 0],
    Resources: { Font: { F1: font.ref, F2: bold.ref }, ...(img ? { XObject: { Im1: img.ref } } : {}) },
  }));
}

// ---- preparazione del PDF con lo spazio per la firma ---------------------------------------------------------
// opts: { visible: { page, x, y, w, h } (punti, origine in alto a sinistra della pagina come la si vede), image, reason, location, name }
async function prepare(bytes, opts = {}) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { throw new Error(/encrypt/i.test(e.message) ? 'il PDF è protetto da password: non si può firmare' : `PDF non leggibile: ${e.message}`); }
  if (doc.isEncrypted) throw new Error('il PDF è protetto da password: non si può firmare');
  const ctx = doc.context, maxOrig = reserveNumbers(Buffer.from(bytes), ctx), changed = new Set();
  const mark = (ref) => { if (ref instanceof PDFRef) changed.add(ref.tag); };
  const now = opts.date || new Date();

  const sig = ctx.obj({
    Type: 'Sig', Filter: 'Adobe.PPKLite', SubFilter: opts.subFilter || 'ETSI.CAdES.detached',
    ByteRange: [0, RANGE_PLACEHOLDER, RANGE_PLACEHOLDER, RANGE_PLACEHOLDER],
    Contents: PDFHexString.of('0'.repeat(SIG_BYTES * 2)), M: PDFString.fromDate(now),
  });
  if (opts.name) sig.set(PDFName.of('Name'), PDFHexString.fromText(opts.name));
  if (opts.reason) sig.set(PDFName.of('Reason'), PDFHexString.fromText(opts.reason));
  if (opts.location) sig.set(PDFName.of('Location'), PDFHexString.fromText(opts.location));
  const sigRef = ctx.register(sig);

  const pages = doc.getPages();
  const v = opts.visible;
  const page = pages[Math.min(Math.max(0, v ? v.page : 0), pages.length - 1)];
  let rect = [0, 0, 0, 0], ap;
  if (v) {
    rect = toPdfRect(page, v);
    ap = await appearance(doc, { w: v.w, h: v.h, rotation: page.getRotation().angle % 360, name: opts.name || '', date: now, reason: opts.reason, image: opts.image });
  } else {
    ap = ctx.register(ctx.stream('', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 0, 0] }));
  }

  // nome del campo univoco
  const acroRaw = doc.catalog.get(PDFName.of('AcroForm'));
  let acro = acroRaw instanceof PDFRef ? ctx.lookup(acroRaw, PDFDict) : acroRaw instanceof PDFDict ? acroRaw : null;
  const taken = new Set();
  const fieldsRaw = acro && acro.get(PDFName.of('Fields'));
  const fields = fieldsRaw ? ctx.lookup(fieldsRaw, PDFArray) : null;
  if (fields) for (let i = 0; i < fields.size(); i++) { const f = ctx.lookup(fields.get(i)); const t = f instanceof PDFDict && f.get(PDFName.of('T')); if (t && t.decodeText) taken.add(t.decodeText()); }
  let n = 1; while (taken.has(`Firma${n}`)) n++;

  const widget = ctx.obj({
    Type: 'Annot', Subtype: 'Widget', FT: 'Sig', Rect: rect, V: sigRef, T: PDFHexString.fromText(`Firma${n}`),
    F: 132, P: page.ref, AP: { N: ap },   // F 132 = stampa + bloccata
  });
  const widgetRef = ctx.register(widget);

  // annotazioni della pagina
  const annotsRaw = page.node.get(PDFName.of('Annots'));
  if (annotsRaw instanceof PDFRef) { ctx.lookup(annotsRaw, PDFArray).push(widgetRef); mark(annotsRaw); }
  else if (annotsRaw instanceof PDFArray) annotsRaw.push(widgetRef);
  else page.node.set(PDFName.of('Annots'), ctx.obj([widgetRef]));
  mark(page.ref);

  // modulo del documento (AcroForm) con il nuovo campo
  if (!acro) { acro = ctx.obj({ Fields: [] }); doc.catalog.set(PDFName.of('AcroForm'), ctx.register(acro)); mark(ctx.trailerInfo.Root); }
  else if (acroRaw instanceof PDFRef) mark(acroRaw); else mark(ctx.trailerInfo.Root);
  if (fieldsRaw instanceof PDFRef) { fields.push(widgetRef); mark(fieldsRaw); }
  else if (fields) fields.push(widgetRef);
  else acro.set(PDFName.of('Fields'), ctx.obj([widgetRef]));
  acro.set(PDFName.of('SigFlags'), PDFNumber.of(3));

  await doc.flush(); // caratteri e immagine dell'aspetto visibile
  return appendUpdate(Buffer.from(bytes), doc, (ref) => ref.objectNumber > maxOrig || changed.has(ref.tag));
}

// Firma un PDF: bytes -> { pdf, signer }. signer(dati) -> { cms, signer }
async function signPdf(bytes, opts, signer) {
  const pdf = await prepare(bytes, opts);
  const from = Buffer.from(bytes).length;
  const placeholder = `${RANGE_PLACEHOLDER} ${RANGE_PLACEHOLDER} ${RANGE_PLACEHOLDER}`;
  const pr = pdf.indexOf(placeholder, from, 'latin1');
  const open = pdf.lastIndexOf('[', pr), close = pdf.indexOf(']', pr);
  const a = pdf.indexOf(`<${'0'.repeat(SIG_BYTES * 2)}>`, from, 'latin1');
  if (pr < 0 || a < 0) throw new Error('spazio per la firma non trovato');
  const b = a + SIG_BYTES * 2 + 2;
  const range = `[0 ${a} ${b} ${pdf.length - b}`;
  pdf.write(range.padEnd(close - open, ' '), open, 'latin1');
  const { cms, signer: info } = await signer(Buffer.concat([pdf.subarray(0, a), pdf.subarray(b)]));
  if (cms.length > SIG_BYTES) throw new Error('la firma è troppo grande');
  pdf.write(cms.toString('hex').padEnd(SIG_BYTES * 2, '0'), a + 1, 'latin1');
  return { pdf, signer: info };
}

// Firma CAdES "imbustata" (.p7m) di un file qualsiasi
async function signP7m(file, cert) {
  const { cms, signer } = await windowsSigner(cert, { attached: true, pades: false })(fs.readFileSync(file));
  return { data: cms, signer };
}

// ---- firme già presenti -----------------------------------------------------------------------------------
function findSignatures(bytes) {
  const buf = Buffer.from(bytes);
  return PDFDocument.load(buf, { updateMetadata: false, ignoreEncryption: true }).then((doc) => {
    const ctx = doc.context, names = new Map(), out = [];
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const v = obj.get(PDFName.of('V')), t = obj.get(PDFName.of('T'));
      if (v instanceof PDFRef && t && t.decodeText) names.set(v.tag, t.decodeText());
    }
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFDict)) continue;
      const br = obj.lookupMaybe(PDFName.of('ByteRange'), PDFArray), contents = obj.get(PDFName.of('Contents'));
      if (!br || !contents || !contents.asBytes || br.size() !== 4) continue;
      const r = br.asArray().map((x) => x.asNumber());
      const txt = (k) => { const x = obj.get(PDFName.of(k)); return x && x.decodeText ? x.decodeText() : ''; };
      let date = null; try { const m = obj.get(PDFName.of('M')); date = m && m.decodeDate ? m.decodeDate().toISOString() : null; } catch {}
      let cms = Buffer.from(contents.asBytes());
      // la firma è seguita da zeri di riempimento: la lunghezza vera è nell'intestazione DER
      if (cms[0] === 0x30 && cms[1] === 0x82) cms = cms.subarray(0, 4 + cms.readUInt16BE(2));
      else if (cms[0] === 0x30 && cms[1] === 0x83) cms = cms.subarray(0, 5 + cms.readUIntBE(2, 3));
      out.push({
        field: names.get(ref.tag) || '', name: txt('Name'), reason: txt('Reason'), location: txt('Location'), date, range: r,
        subFilter: (obj.get(PDFName.of('SubFilter')) || '').toString().replace('/', ''),
        wholeFile: r[2] + r[3] === buf.length, cms,
      });
    }
    return out.sort((x, y) => x.range[2] - y.range[2]);
  });
}

// Controlla le firme: integrità dei byte firmati e firmatario (sign.ps1 verify)
async function verifySignatures(bytes) {
  const buf = Buffer.from(bytes);
  const sigs = await findSignatures(buf);
  if (!sigs.length) return [];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-ver-'));
  try {
    const items = sigs.map((s, i) => {
      const data = path.join(dir, `d${i}.bin`), sig = path.join(dir, `s${i}.p7s`);
      const [a, b, c, d] = s.range;
      fs.writeFileSync(data, Buffer.concat([buf.subarray(a, a + b), buf.subarray(c, c + d)]));
      fs.writeFileSync(sig, s.cms);
      return { data, sig };
    });
    let checks = [];
    try { checks = await runPs('verify', { items }); checks = Array.isArray(checks) ? checks : [checks]; }
    catch (e) { checks = sigs.map(() => ({ ok: null, problem: e.message })); }
    return sigs.map((s, i) => { const { cms, ...rest } = s; return { ...rest, ...(checks[i] || {}) }; });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

module.exports = { listCertificates, windowsSigner, signPdf, signP7m, prepare, findSignatures, verifySignatures, SIG_BYTES };
