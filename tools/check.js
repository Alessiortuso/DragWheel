// Converte i PDF di test-files/ in DOCX (test-files/output/) e stampa un riepilogo di qualità.
// Uso: npx electron tools/check.js [filtro]
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { convert, setPdfRenderer, setPdfExtractor } = require('../src/converter');
const { renderPdf, extractPdf } = require('../src/pdf-renderer');

const SRC = path.join(__dirname, '..', 'test-files');
const OUT = path.join(SRC, 'output');
const chars = (t) => t.toLowerCase().match(/[\p{L}\p{N}]/gu) || [];

async function summarize(docx) {
  const xml = await (await JSZip.loadAsync(fs.readFileSync(docx))).file('word/document.xml').async('string');
  const paras = xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
  const text = (x) => (x.match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const tables = (xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g) || []).map((t) => `${(t.match(/<w:tr[ >]/g) || []).length}r x ${((t.match(/<w:tr[ >][\s\S]*?<\/w:tr>/) || [''])[0].match(/<w:tc>/g) || []).length}c`);
  return {
    text: text(xml), tables,
    headings: (xml.match(/w:val="Heading\d"/g) || []).length,
    bullets: (xml.match(/<w:numPr>/g) || []).length,
    images: (xml.match(/<w:drawing>/g) || []).length,
    paras: paras.length,
    outline: paras.map((p) => ((/Heading/.test(p) ? 'H ' : /<w:numPr>/.test(p) ? '• ' : '  ') + text(p)).slice(0, 78)).filter((l) => l.trim()),
  };
}

app.whenReady().then(async () => {
  setPdfRenderer(renderPdf); setPdfExtractor(extractPdf);
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const filter = process.argv[2] || '';
  for (const f of fs.readdirSync(SRC).filter((n) => n.endsWith('.pdf') && n.includes(filter))) {
    const tmp = path.join(OUT, f);
    fs.copyFileSync(path.join(SRC, f), tmp);
    const t = Date.now();
    try {
      const raw = await extractPdf(fs.readFileSync(tmp));
      const pdfWords = raw.flatMap((p) => p.items).map((i) => i.str).join(' ');
      const [docx] = await convert(tmp, 'docx');
      const s = await summarize(docx);
      // confronto sui caratteri: il testo PDF è spezzato in frammenti, non in parole
      const have = new Map();
      for (const c of chars(s.text)) have.set(c, (have.get(c) || 0) + 1);
      const want = chars(pdfWords);
      let lost = 0; const lostList = [];
      for (const c of want) { if ((have.get(c) || 0) > 0) have.set(c, have.get(c) - 1); else { lost++; lostList.push(c); } }
      console.log(`\n=== ${f}  (${Date.now() - t} ms)`);
      console.log(`caratteri PDF ${want.length}, persi ${lost}${lost ? ' [' + lostList.slice(0, 12).join('') + ']' : ''} | paragrafi ${s.paras} titoli ${s.headings} elenchi ${s.bullets} tabelle [${s.tables.join(', ')}] immagini ${s.images} | figure rilevate ${raw.reduce((n, p) => n + p.figures.length, 0)}`);
      if (process.env.OUTLINE) console.log(s.outline.slice(0, +process.env.OUTLINE).join('\n'));
    } catch (e) { console.log(`\n=== ${f}  ERRORE`, e.stack); }
  }
  app.exit(0);
});
app.on('window-all-closed', () => {});
