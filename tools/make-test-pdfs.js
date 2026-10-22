// Genera in test-files/ dei PDF di prova (con testo vero) per migliorare la conversione.
// Uso: npx electron tools/make-test-pdfs.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { PDFDocument } = require('pdf-lib');

const OUT = path.join(__dirname, '..', 'test-files');
const CSS = `body{font:11pt Arial,sans-serif;color:#222;margin:0}h1{font-size:22pt;margin:0 0 6pt}h2{font-size:15pt;margin:14pt 0 4pt}
p{margin:0 0 8pt;line-height:1.35}table{border-collapse:collapse;width:100%;margin:8pt 0 12pt}
th,td{border:1px solid #888;padding:5pt 8pt;text-align:left;vertical-align:top}th{background:#e8eef7}ul,ol{margin:0 0 8pt 18pt}`;
const LOREM = 'Il servizio di calcolo lavora bene quando ha poche richieste per volta, ma rallenta se ne riceve troppe insieme. Per questo motivo abbiamo introdotto una coda d\'attesa e limiti chiari per ogni utente, decisi dopo una serie di test di carico. ';
const long = (n) => Array(n).fill(LOREM).join('');

const docs = {
  '01-tabella-semplice': `<h1>Report vendite 2026</h1><p>Riepilogo trimestrale per area geografica.</p>
    <table><tr><th>Area</th><th>Trimestre</th><th>Vendite</th><th>Variazione</th></tr>
    <tr><td>Nord</td><td>Q1</td><td>120.500</td><td>+4,2%</td></tr><tr><td>Nord</td><td>Q2</td><td>131.900</td><td>+9,5%</td></tr>
    <tr><td>Centro</td><td>Q1</td><td>98.300</td><td>-1,1%</td></tr><tr><td>Centro</td><td>Q2</td><td>101.700</td><td>+3,5%</td></tr>
    <tr><td>Sud</td><td>Q1</td><td>76.400</td><td>+0,8%</td></tr><tr><td>Sud</td><td>Q2</td><td>82.000</td><td>+7,3%</td></tr></table>
    <p>I dati sono in euro e già al netto dei resi.</p>`,
  '02-due-colonne': `<h1>Rassegna tecnica</h1><p><i>Titolo a tutta larghezza, poi il testo scorre su due colonne.</i></p>
    <div style="column-count:2;column-gap:28pt;text-align:justify"><h2>Introduzione</h2><p>${long(3)}</p><h2>Metodo</h2><p>${long(4)}</p><h2>Risultati</h2><p>${long(4)}</p></div>`,
  '03-misto': `<h1>Verbale riunione di progetto</h1><p>Partecipanti: <b>Anna Rossi</b>, <b>Marco Bianchi</b> e <i>Sara Verdi</i>. Data: 12 ottobre 2026.</p>
    <h2>Decisioni prese</h2><ul><li>Limite di 2000 molecole per richiesta</li><li>Massimo 3 calcoli contemporanei, di tutti gli utenti</li><li>Coda d'attesa fino a 10 richieste</li></ul>
    <h2>Attività assegnate</h2><table><tr><th>Attività</th><th>Responsabile</th><th>Note</th><th>Scadenza</th></tr>
    <tr><td>Configurare la coda</td><td>Marco</td><td>Serve prima il parere del cliente sui limiti. Poi si può procedere con il test finale.</td><td>30/10</td></tr>
    <tr><td>Scrivere la documentazione</td><td>Sara</td><td>Include esempi d'uso.</td><td>05/11</td></tr>
    <tr><td>Test di carico</td><td>Anna</td><td>Ripetere con 50 modelli.</td><td>10/11</td></tr></table>
    <h2>Prossimi passi</h2><ol><li>Approvare il documento</li><li>Pubblicare le regole</li><li>Monitorare per due settimane</li></ol><p>${long(1)}</p>`,
  '04-multipagina': `<h1>Manuale operativo</h1>${[1, 2, 3].map((n) => `<h2>Capitolo ${n}</h2><p>${long(6)}</p><p>${long(4)}</p>`).join('')}
    <h2>Appendice: codici</h2><table><tr><th>Codice</th><th>Significato</th></tr>${Array.from({ length: 30 }, (_, i) => `<tr><td>E${100 + i}</td><td>Errore numero ${i + 1} del sistema</td></tr>`).join('')}</table>`,
  '06-con-immagine': `<h1>Relazione con grafico</h1><p>${long(1)}</p>
    <svg width="420" height="160" xmlns="http://www.w3.org/2000/svg"><rect width="420" height="160" fill="#eef"/><rect x="30" y="60" width="50" height="90" fill="#3b82f6"/><rect x="110" y="30" width="50" height="120" fill="#ee4b5b"/><rect x="190" y="80" width="50" height="70" fill="#22c55e"/><rect x="270" y="45" width="50" height="105" fill="#f5a623"/></svg>
    <p>Figura 1: andamento per periodo.</p><p>${long(1)}</p>`,
};

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-html-'));
let n = 0;
const load = (w, html) => { const f = path.join(tmpDir, `${n++}.html`); fs.writeFileSync(f, `<meta charset="utf-8">${html}`); return w.loadFile(f); };

async function toPdf(html, file) {
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await load(w, `<style>${CSS}</style>${html}`);
  fs.writeFileSync(file, await w.webContents.printToPDF({ pageSize: 'A4', margins: { marginType: 'default' } }));
  w.destroy();
}

app.on('window-all-closed', () => {}); // senza questo Electron esce appena chiudo la prima finestra
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, html] of Object.entries(docs)) await toPdf(html, path.join(OUT, `${name}.pdf`));
  // scansione: pagina di sola immagine, senza testo (ripiego senza OCR)
  const w = new BrowserWindow({ show: false, width: 794, height: 1000, webPreferences: { sandbox: true } });
  await load(w, `<style>${CSS}body{padding:40px}</style><h1>Documento scansionato</h1><p>${long(3)}</p>`);
  const png = (await w.webContents.capturePage()).toPNG();
  const pdf = await PDFDocument.create();
  const img = await pdf.embedPng(png);
  pdf.addPage([595, 595 * img.height / img.width]).drawImage(img, { x: 0, y: 0, width: 595, height: 595 * img.height / img.width });
  fs.writeFileSync(path.join(OUT, '05-scansione.pdf'), await pdf.save());
  console.log('creati:', fs.readdirSync(OUT).join(', '));
  app.exit(0);
});
