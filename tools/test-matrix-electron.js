// Combinazioni che richiedono Electron: PDF verso immagini/DOCX/TXT, immagini verso PDF, fogli verso PDF. Uso: npx electron tools/test-matrix-electron.js
const { app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { convert, setPdfRenderer, setPdfExtractor } = require('../src/converter');
const { renderPdf, extractPdf } = require('../src/pdf-renderer');
const sheet = require('../src/sheet/ops');
const { ExcelJS } = require('../src/sheet/book');

let fail = 0, total = 0;
const ok = (n, c, extra = '') => { total++; console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };

app.whenReady().then(async () => {
  setPdfRenderer(renderPdf); setPdfExtractor(extractPdf);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-matrixe-'));
  const real = path.join(__dirname, '..', 'test-files');
  const pdfs = fs.existsSync(real) ? fs.readdirSync(real).filter((f) => /\.pdf$/i.test(f)) : [];
  const pdf = pdfs.length ? path.join(d, 'in.pdf') : null;
  if (pdf) fs.copyFileSync(path.join(real, pdfs[0]), pdf);
  const png = path.join(d, 'a.png'); await sharp({ create: { width: 120, height: 80, channels: 3, background: '#3a7bd5' } }).png().toFile(png);
  const own = (await convert(png, 'pdf'))[0];
  for (const [label, file] of [['PDF delle immagini', own], ...(pdf ? [[`PDF con testo (${pdfs[0]})`, pdf]] : [])]) {
    const src = path.join(d, label.replace(/\W+/g, '_') + '.pdf'); fs.copyFileSync(file, src);
    for (const dst of ['png', 'webp', 'jpg', 'tiff', 'avif', 'bmp', 'gif', 'docx', 'txt']) {
      try { const r = await convert(src, dst); ok(`${label} -> ${dst}`, r.length >= 1 && fs.statSync(r[0]).size > 50, `${r.length} file`); }
      catch (e) { ok(`${label} -> ${dst}`, label.startsWith('PDF delle immagini') && dst === 'txt', e.message.slice(0, 100) + (dst === 'txt' && label.startsWith('PDF delle') ? ' (atteso: nessun testo)' : '')); }
    }
  }
  if (pdf) { const t = fs.readFileSync((await convert(pdf, 'txt'))[0], 'utf8'); ok('PDF -> TXT: contiene testo leggibile', t.length > 200, `${t.length} caratteri; inizio: ${t.slice(0, 70).replace(/\s+/g, ' ')}`); }
  for (const dst of ['pdf', 'docx']) { const r = await convert(path.join(d, 'a.png'), dst); ok(`png -> ${dst}`, fs.statSync(r[0]).size > 50); }

  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet('Ordini'); ws.addRow(['ID', 'Cliente', 'Importo']); ws.addRow([1, 'Rossi', 10.5]);
  const x = path.join(d, 'dati.xlsx'); await wb.xlsx.writeFile(x);
  for (const src of ['xlsx', 'xls', 'ods', 'csv', 'tsv']) {
    const f = src === 'xlsx' ? x : (() => null)() || (await sheet.convert(x, { target: src })).outputs[0];
    const r = await sheet.convert(f, { target: 'pdf' }); const buf = fs.readFileSync(r.outputs[0]);
    ok(`foglio ${src} -> pdf`, buf.slice(0, 4).toString() === '%PDF' && buf.length > 500, `${buf.length} byte`);
  }
  console.log(`\n${total - fail}/${total} ok`); console.log(fail ? `${fail} FALLITE` : 'TUTTO OK');
  app.exit(fail ? 1 : 0);
});
app.on('window-all-closed', () => {});
