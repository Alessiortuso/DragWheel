// Collaudo degli strumenti PDF (modifiche, pagine, moduli, compressione, password, firma digitale) con file generati qui.
// I risultati si controllano rileggendoli con pdf.js; le firme anche con OpenSSL (quello di Git per Windows va bene).
// La firma con i certificati di Windows (sign.ps1) si salta con DW_SKIP_WINDOWS_SIGN=1.
// Uso: node tools/test-pdf.js
const fs = require('fs'), os = require('os'), path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');
const ops = require('../src/pdf/ops');
const { protect } = require('../src/pdf/crypt');
const sign = require('../src/pdf/sign');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-pdf-'));
let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
const kb = (b) => (b.length / 1024).toFixed(0) + ' KB';

let pdfjs;
async function openPdf(bytes, password) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjs.getDocument({ data: new Uint8Array(bytes), password, verbosity: 0, isEvalSupported: false }).promise;
}
// testo di una pagina con la posizione come la si vede (origine in alto a sinistra, rotazione applicata)
async function textOf(doc, n) {
  const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  return tc.items.filter((i) => i.str.trim()).map((i) => {
    const m = pdfjs.Util.transform(vp.transform, i.transform);
    return { str: i.str, x: m[4], y: m[5], dir: Math.round((Math.atan2(m[1], m[0]) * 180) / Math.PI) };
  });
}

async function fixture() {
  const doc = await PDFDocument.create();
  const f = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 4; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`Pagina ${i + 1} del contratto`, { x: 60, y: 780, size: 18, font: f });
    if (i === 1) p.setRotation(degrees(90));
    if (i === 2) p.setRotation(degrees(180));
    if (i === 3) p.setRotation(degrees(270));
  }
  const form = doc.getForm();
  const name = form.createTextField('nome'); name.addToPage(doc.getPage(0), { x: 60, y: 700, width: 200, height: 22 });
  const ok = form.createCheckBox('accetto'); ok.addToPage(doc.getPage(0), { x: 60, y: 660, width: 14, height: 14 });
  const dd = form.createDropdown('citta'); dd.addOptions(['Roma', 'Milano', 'Napoli']); dd.addToPage(doc.getPage(0), { x: 60, y: 620, width: 120, height: 20 });
  doc.setTitle('Contratto di prova'); doc.setAuthor('Mario Rossi');
  return Buffer.from(await doc.save());
}

async function photoPdf() {
  // una foto grande (rumore colorato sfumato) incorporata come JPEG di alta qualità
  const w = 3000, h = 2000, raw = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 3; raw[i] = (x * 255) / w; raw[i + 1] = (y * 255) / h; raw[i + 2] = (Math.sin(x / 7) * Math.cos(y / 11) * 120 + 128) | 0; }
  const jpg = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 97 }).toBuffer();
  const doc = await PDFDocument.create(), img = await doc.embedJpg(jpg), p = doc.addPage([842, 595]);
  p.drawImage(img, { x: 20, y: 20, width: 800, height: 533 });
  return Buffer.from(await doc.save());
}

function findOpenssl() {
  for (const c of ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe']) {
    const r = spawnSync(c, ['version'], { encoding: 'utf8' });
    if (r.status === 0) return c;
  }
  return null;
}

(async () => {
  const base = await fixture();
  const plan = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, src: 0, page: i, rotate: 0 }));

  console.log('--- lettura');
  const info = await ops.inspect(base);
  ok('pagine con dimensione e rotazione', info.pages.length === 4 && info.pages[1].width === 842 && info.pages[1].rotation === 90, info.pages.map((p) => `${p.width}x${p.height}@${p.rotation}`).join(' '));
  ok('campi del modulo', info.fields.map((f) => f.name + ':' + f.type).join(',') === 'nome:text,accetto:check,citta:choice', info.fields.map((f) => f.name).join(', '));
  ok('proprietà', info.meta.title === 'Contratto di prova' && info.meta.author === 'Mario Rossi');

  console.log('--- nessuna modifica');
  let r = await ops.build([base], { plan: plan(4) });
  ok('senza modifiche il file resta identico (le firme restano valide)', !r.changed && r.bytes === base);

  console.log('--- modifiche disegnate');
  const png = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 0, g: 0, b: 120, alpha: 1 } } }).png().toBuffer();
  const text = (x, y, t) => ({ type: 'text', x, y, w: 300, h: 20, text: t, size: 14, font: 'helv', color: '#c00000' });
  const edits = {
    p0: [text(100, 100, 'Testo aggiunto àèìòù €'), { type: 'whiteout', x: 50, y: 50, w: 100, h: 20 }, { type: 'highlight', x: 60, y: 55, w: 200, h: 25 },
      { type: 'rect', x: 300, y: 300, w: 100, h: 50, stroke: '#0000ff', width: 2 }, { type: 'ellipse', x: 300, y: 400, w: 100, h: 50, stroke: '#00aa00', fill: '#eeffee' },
      { type: 'arrow', x1: 100, y1: 500, x2: 300, y2: 520, color: '#ff0000', width: 3 }, { type: 'ink', paths: [[[100, 600], [120, 620], [140, 600], [160, 640]]], color: '#000080', width: 2 },
      { type: 'image', x: 350, y: 650, w: 200, h: 80, data: png.toString('base64') }, text(100, 700, 'emoji 😀 e cinese 中文')],
    p1: [text(100, 100, 'Ruotata 90')], p2: [text(100, 100, 'Ruotata 180')], p3: [text(100, 100, 'Ruotata 270')],
  };
  r = await ops.build([base], { plan: plan(4), edits });
  ok('PDF modificato', r.changed && r.bytes.length > base.length, kb(r.bytes));
  let doc = await openPdf(r.bytes);
  const t0 = await textOf(doc, 1);
  const added = t0.find((t) => t.str.startsWith('Testo aggiunto'));
  ok('testo con accenti ed euro nel punto giusto', added && added.str === 'Testo aggiunto àèìòù €' && Math.abs(added.x - 100) < 1 && added.y > 100 && added.y < 120, added && `${added.str} @${added.x.toFixed(1)},${added.y.toFixed(1)}`);
  ok('caratteri non latini sostituiti senza errori', t0.some((t) => t.str.startsWith('emoji ? e cinese ??')));
  for (const [n, label] of [[2, 'Ruotata 90'], [3, 'Ruotata 180'], [4, 'Ruotata 270']]) {
    const t = (await textOf(doc, n)).find((x) => x.str === label);
    ok(`pagina ruotata: testo dritto e al suo posto (${label})`, t && t.dir === 0 && Math.abs(t.x - 100) < 1 && t.y > 100 && t.y < 120, t && `@${t.x.toFixed(1)},${t.y.toFixed(1)} dir ${t.dir}`);
  }
  ok('i campi del modulo restano', (await ops.inspect(r.bytes)).fields.length === 3);

  console.log('--- a capo automatico');
  const lib = await PDFDocument.create(), hf = await lib.embedFont(StandardFonts.Helvetica);
  const lines = ops.wrap('Questo è un testo abbastanza lungo da andare a capo più volte\nseconda riga', hf, 12, 150);
  ok('righe entro la larghezza', lines.length >= 4 && lines.every((l) => hf.widthOfTextAtSize(l, 12) <= 150.5) && lines[lines.length - 1] === 'seconda riga', lines.join(' | '));

  console.log('--- moduli');
  r = await ops.build([base], { plan: plan(4), form: { nome: 'Giulia Bianchi', accetto: true, citta: 'Milano' } });
  let fi = (await ops.inspect(r.bytes)).fields;
  ok('compilazione', fi.find((f) => f.name === 'nome').value === 'Giulia Bianchi' && fi.find((f) => f.name === 'accetto').value === true && fi.find((f) => f.name === 'citta').value === 'Milano');
  r = await ops.build([base], { plan: plan(4), form: { nome: 'Giulia Bianchi' }, flatten: true });
  doc = await openPdf(r.bytes);
  ok('modulo appiattito: niente più campi, il testo resta sulla pagina', (await ops.inspect(r.bytes)).fields.length === 0 && (await textOf(doc, 1)).some((t) => t.str.includes('Giulia')));

  console.log('--- pagine');
  const other = await ops.imageToPdf(png);
  const blank = await ops.blankPdf();
  r = await ops.build([base, other, blank], { plan: [{ id: 'a', src: 0, page: 3, rotate: 90 }, { id: 'b', src: 1, page: 0, rotate: 0 }, { id: 'c', src: 0, page: 0, rotate: 0 }, { id: 'e', src: 2, page: 0, rotate: 0 }], edits: { e: [text(50, 50, 'Su pagina vuota')] } });
  let out = await PDFDocument.load(r.bytes);
  ok('riordino, rotazione, immagine e pagina vuota', out.getPageCount() === 4 && out.getPage(0).getRotation().angle === 0 && out.getPage(1).getWidth() === 842, `${out.getPageCount()} pagine, rotazioni ${out.getPages().map((p) => p.getRotation().angle).join(',')}`);
  doc = await openPdf(r.bytes);
  ok('le pagine sono quelle scelte', (await textOf(doc, 1))[0].str === 'Pagina 4 del contratto' && (await textOf(doc, 3))[0].str === 'Pagina 1 del contratto' && (await textOf(doc, 4)).some((t) => t.str === 'Su pagina vuota'));
  ok('le proprietà del documento restano', out.getTitle() === 'Contratto di prova');
  r = await ops.extract(base, [1, 2]);
  ok('estrai pagine', (await PDFDocument.load(r)).getPageCount() === 2);
  r = await ops.build([base], { plan: plan(4), meta: { title: 'Nuovo titolo', author: '', subject: 'Oggetto', keywords: 'a, b' } });
  out = await PDFDocument.load(r.bytes);
  ok('proprietà modificate', out.getTitle() === 'Nuovo titolo' && !out.getAuthor() && out.getSubject() === 'Oggetto');

  console.log('--- oscuramento');
  const black = await sharp({ create: { width: 1190, height: 1684, channels: 3, background: '#fff' } }).composite([{ input: { create: { width: 400, height: 60, channels: 3, background: '#000' } }, left: 100, top: 100 }]).jpeg().toBuffer();
  r = await ops.build([base], { plan: plan(4), redactions: { p0: black.toString('base64') }, edits: { p0: [{ type: 'redact', x: 50, y: 50, w: 200, h: 30 }, text(100, 300, 'Dopo')] } });
  doc = await openPdf(r.bytes);
  const red = await textOf(doc, 1);
  ok('pagina oscurata: il testo originale non c’è più', !red.some((t) => t.str.includes('contratto')) && red.some((t) => t.str === 'Dopo') && (await textOf(doc, 2)).length > 0, red.map((t) => t.str).join(','));

  console.log('--- compressione');
  const photo = await photoPdf();
  r = await ops.compress(photo, 'balanced');
  ok('foto ricompressa', r.bytes.length < photo.length * 0.6 && r.recompressed === 1, `${kb(photo)} -> ${kb(r.bytes)}`);
  doc = await openPdf(r.bytes);
  ok('...e il PDF si apre', doc.numPages === 1);
  r = await ops.compress(base, 'small');
  ok('PDF senza immagini: nessun danno', (await ops.inspect(r.bytes)).pages.length === 4, `${kb(base)} -> ${kb(r.bytes)}`);

  console.log('--- password');
  const locked = await protect(base, { userPassword: 'apriti', ownerPassword: 'padrone', perms: { print: true } });
  try { await openPdf(locked); ok('senza password non si apre', false); } catch (e) { ok('senza password non si apre', /password/i.test(e.name + e.message), e.name); }
  doc = await openPdf(locked, 'apriti');
  ok('con la password giusta si apre e si legge', (await textOf(doc, 1))[0].str === 'Pagina 1 del contratto');
  const perms = await doc.getPermissions();
  ok('permessi: stampa sì, copia no', perms && perms.includes(pdfjs.PermissionFlag.PRINT) && !perms.includes(pdfjs.PermissionFlag.COPY), JSON.stringify(perms));
  doc = await openPdf(locked, 'padrone');
  ok('si apre anche con la password del proprietario', doc.numPages === 4);
  const own = await protect(base, { ownerPassword: 'padrone', perms: {} });
  doc = await openPdf(own);
  ok('solo restrizioni: si apre senza password', doc.numPages === 4 && (await textOf(doc, 1))[0].str === 'Pagina 1 del contratto');
  ok('il modulo cifrato si legge', (await doc.getFieldObjects()).nome !== undefined);

  console.log('--- firma digitale');
  const openssl = findOpenssl();
  if (!openssl) console.log('SALTATO  OpenSSL non trovato: firma non provata');
  else {
    const cdir = path.join(d, 'cert');
    fs.mkdirSync(cdir);
    const ssl = (args) => { const x = spawnSync(openssl, args, { cwd: cdir, encoding: 'latin1', env: { ...process.env, MSYS_NO_PATHCONV: '1' } }); if (x.status) throw new Error(x.stderr); return x; };
    ssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', 'k.pem', '-out', 'c.pem', '-days', '30', '-subj', '/CN=Mario Rossi/O=Prova DragWheel']);
    ssl(['pkcs12', '-export', '-inkey', 'k.pem', '-in', 'c.pem', '-out', 'test.pfx', '-passout', 'pass:segreta', '-certpbe', 'AES-256-CBC', '-keypbe', 'AES-256-CBC', '-macalg', 'sha256']);
    // firmatario di prova: OpenSSL al posto di Windows
    const sslSigner = async (data) => {
      fs.writeFileSync(path.join(cdir, 'data.bin'), data);
      ssl(['cms', '-sign', '-binary', '-in', 'data.bin', '-signer', 'c.pem', '-inkey', 'k.pem', '-outform', 'DER', '-out', 'sig.der', '-md', 'sha256', '-nosmimecap']);
      return { cms: fs.readFileSync(path.join(cdir, 'sig.der')), signer: { name: 'Mario Rossi' } };
    };
    const checkAll = async (pdf) => {
      const sigs = await sign.findSignatures(pdf);
      return sigs.map((s) => {
        const [a, b, c, e] = s.range;
        fs.writeFileSync(path.join(cdir, 'v.bin'), Buffer.concat([pdf.subarray(a, a + b), pdf.subarray(c, c + e)]));
        fs.writeFileSync(path.join(cdir, 'v.der'), s.cms);
        return spawnSync(openssl, ['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'v.der', '-content', 'v.bin', '-noverify', '-purpose', 'any', '-out', process.platform === 'win32' ? 'NUL' : '/dev/null'], { cwd: cdir, env: { ...process.env, MSYS_NO_PATHCONV: '1' } }).status === 0;
      });
    };
    const signature = await sharp({ create: { width: 300, height: 100, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: Buffer.from('<svg width="300" height="100"><path d="M10 80 C 60 0, 120 100, 290 30" stroke="#123" stroke-width="5" fill="none"/></svg>') }]).png().toBuffer();
    let s1 = await sign.signPdf(base, { name: 'Mario Rossi', reason: 'Approvazione', location: 'Roma', visible: { page: 0, x: 330, y: 700, w: 220, h: 80 }, image: signature }, sslSigner);
    ok('PDF firmato (firma visibile con immagine)', s1.pdf.length > base.length && s1.pdf.subarray(0, base.length).equals(base), kb(s1.pdf));
    let v = await checkAll(s1.pdf);
    ok('la firma è valida e copre tutto il file', v.length === 1 && v[0] && (await sign.findSignatures(s1.pdf))[0].wholeFile);
    doc = await openPdf(s1.pdf);
    ok('il PDF firmato si apre ed è integro', doc.numPages === 4 && (await doc.getPage(1).then((p) => p.getAnnotations())).some((a) => a.fieldType === 'Sig'));
    const s2 = await sign.signPdf(s1.pdf, { name: 'Luca Verdi', reason: 'Controfirma', visible: { page: 1, x: 50, y: 50, w: 200, h: 60 } }, sslSigner);
    v = await checkAll(s2.pdf);
    const found = await sign.findSignatures(s2.pdf);
    ok('seconda firma: anche la prima resta valida', v.length === 2 && v.every(Boolean) && !found[0].wholeFile && found[1].wholeFile, found.map((f) => `${f.field}=${f.name}`).join(', '));
    // un PDF salvato con i flussi di riferimenti (PDF 1.5) e uno con la tabella classica
    const classic = Buffer.from(await (await PDFDocument.load(base)).save({ useObjectStreams: false }));
    for (const [label, pdf] of [['tabella classica', classic], ['flusso di riferimenti', base]]) {
      const s = await sign.signPdf(pdf, { name: 'Mario Rossi' }, sslSigner);
      const re = await PDFDocument.load(s.pdf);
      ok(`firma invisibile su PDF con ${label}`, (await checkAll(s.pdf))[0] && re.getPageCount() === 4 && (await openPdf(s.pdf)).numPages === 4);
    }
    // si può ancora modificare dopo la firma? Il file rifatto perde la firma: lo strumento lo deve dire (non è un errore)
    const tampered = Buffer.from(s1.pdf); tampered[200] ^= 1;
    ok('una modifica ai byte firmati si scopre', !(await checkAll(tampered))[0]);

    if (process.env.DW_SKIP_WINDOWS_SIGN) console.log('SALTATO  firma con le API di Windows (DW_SKIP_WINDOWS_SIGN)');
    else {
      const signer = sign.windowsSigner({ pfx: path.join(cdir, 'test.pfx'), password: 'segreta' });
      const w = await sign.signPdf(base, { name: 'Mario Rossi', visible: { page: 0, x: 330, y: 700, w: 220, h: 80 } }, signer);
      ok('firma con le API di Windows (file .pfx)', (await checkAll(w.pdf))[0] && w.signer.name === 'Mario Rossi', w.signer.name);
      const ver = await sign.verifySignatures(w.pdf);
      ok('verifica con Windows: integra, firmatario riconosciuto', ver.length === 1 && ver[0].ok === true && ver[0].name === 'Mario Rossi' && ver[0].wholeFile, JSON.stringify({ ok: ver[0].ok, name: ver[0].name, trusted: ver[0].trusted }));
      const bad = Buffer.from(w.pdf); bad[300] ^= 1;
      ok('verifica con Windows: modifica scoperta', (await sign.verifySignatures(bad))[0].ok === false);
      try { await sign.windowsSigner({ pfx: path.join(cdir, 'test.pfx'), password: 'sbagliata' })(Buffer.from('x')); ok('password del certificato errata', false); }
      catch (e) { ok('password del certificato errata', /password/i.test(e.message), e.message); }
      fs.writeFileSync(path.join(d, 'doc.pdf'), base);
      const p7 = await sign.signP7m(path.join(d, 'doc.pdf'), { pfx: path.join(cdir, 'test.pfx'), password: 'segreta' });
      fs.writeFileSync(path.join(cdir, 'f.p7m'), p7.data);
      const x = spawnSync(openssl, ['cms', '-verify', '-binary', '-inform', 'DER', '-in', 'f.p7m', '-noverify', '-purpose', 'any', '-out', 'f.pdf'], { cwd: cdir, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
      ok('firma CAdES (.p7m) con il PDF dentro', x.status === 0 && fs.readFileSync(path.join(cdir, 'f.pdf')).equals(base));
      const certs = await sign.listCertificates();
      ok('elenco dei certificati di Windows', Array.isArray(certs), `${certs.length} certificati per firmare`);
    }
  }

  console.log(fail ? `\n${fail} prove FALLITE` : '\nTutte le prove superate');
  fs.rmSync(d, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
