// Prova la finestra "PDF" con file generati qui: clic e tasti veri sulla pagina, salvataggi controllati con pdf.js.
// La firma con i certificati di Windows si salta con DW_SKIP_WINDOWS_SIGN=1 (l'elenco dei certificati viene simulato).
// Uso: npx electron tools/test-pdf-ui.js <cartella-screenshot>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { PDFDocument, StandardFonts, degrees } = require('pdf-lib');
app.disableHardwareAcceleration();
app.on('window-all-closed', (e) => e.preventDefault()); // tra una finestra e l'altra l'app non deve chiudersi
const { openPdfTool } = require('../src/pdf-tool');
const OUT = process.argv[2] || path.join(os.tmpdir(), 'dw-pdf-ui-shots');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };

async function fixture(file, title = 'Contratto') {
  const doc = await PDFDocument.create(), f = await doc.embedFont(StandardFonts.Helvetica), fb = await doc.embedFont(StandardFonts.TimesRomanBold);
  for (let i = 0; i < 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText(`${title} pagina ${i + 1}`, { x: 60, y: 770, size: 22, font: fb });
    p.drawText('Il cliente si impegna a pagare entro 30 giorni.', { x: 60, y: 720, size: 12, font: f });
    if (i === 2) p.setRotation(degrees(90));
  }
  if (title === 'Contratto') { const form = doc.getForm(); form.createTextField('nome').addToPage(doc.getPage(0), { x: 60, y: 650, width: 200, height: 22 }); }
  fs.writeFileSync(file, await doc.save());
  return file;
}

let pdfjs;
async function texts(file, n) {
  pdfjs ||= await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), verbosity: 0 }).promise;
  if (n === undefined) return doc;
  const page = await doc.getPage(n), vp = page.getViewport({ scale: 1 });
  return (await page.getTextContent()).items.filter((i) => i.str.trim()).map((i) => { const m = pdfjs.Util.transform(vp.transform, i.transform); return { str: i.str, x: m[4], y: m[5] }; });
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-pui-'));
  const f1 = await fixture(path.join(d, 'contratto.pdf')), f2 = await fixture(path.join(d, 'allegato.pdf'), 'Allegato');
  if (process.env.DW_SKIP_WINDOWS_SIGN) {
    ipcMain.removeHandler('pdf:certs');
    ipcMain.handle('pdf:certs', () => [{ thumbprint: 'AB12', name: 'Mario Rossi', issuer: 'Ente di prova', serial: 'TINIT-RSSMRA80A01H501U', notAfter: '2029-01-01T00:00:00Z', nonRepudiation: true, signing: true }]);
  }

  let win;
  const open = async (files, preset) => {
    await openPdfTool(files, preset);
    win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle().startsWith('PDF'));
    win.webContents.on('console-message', (...a) => { const m = a[2] ?? a[0].message; if (/Uncaught|rror/.test(String(m))) console.log('  [pagina]', m); });
    await wait(1800);
  };
  const ev = (c) => win.webContents.executeJavaScript(c);
  const E = (c) => ev(`(async () => { const E = window.__pdfEditor; ${c} })()`);
  const shot = async (n) => { await wait(400); fs.writeFileSync(path.join(OUT, `pdf-${n}.png`), (await win.webContents.capturePage()).toPNG()); };
  const finish = async () => { const t = Date.now(); await wait(150); while ((await ev('window.__pdfEditor.running')) && Date.now() - t < 90000) await wait(200); await wait(300); };
  const result = () => ev(`[...document.querySelectorAll('#result .card2')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim().replace(/Apri cartella.*$/, '')).join(' || ')`);
  const made = (re) => fs.readdirSync(d).filter((n) => re.test(n)).sort();
  // clic vero sulla pagina n (1..) nel punto (x, y) in punti PDF come la si vede
  const at = async (n, x, y) => JSON.parse(await ev(`(() => {
    const el = document.querySelectorAll('.pg')[${n - 1}], sc = document.getElementById('scroll'), z = window.__pdfEditor.zoom;
    let r = el.getBoundingClientRect(); const b = sc.getBoundingClientRect();
    sc.scrollTop += r.top + ${y} * z - (b.top + sc.clientHeight / 2); r = el.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.left + ${x} * z), y: Math.round(r.top + ${y} * z) }); })()`));
  const mouse = async (type, p) => win.webContents.sendInputEvent({ type, x: p.x, y: p.y, button: 'left', clickCount: 1 });
  const click = async (n, x, y) => { const p = await at(n, x, y); await mouse('mouseDown', p); await wait(40); await mouse('mouseUp', p); await wait(200); };
  const dragOn = async (n, x1, y1, x2, y2) => { const m = await at(n, (x1 + x2) / 2, (y1 + y2) / 2), z = await ev('window.__pdfEditor.zoom'); const a = { x: Math.round(m.x + (x1 - x2) / 2 * z), y: Math.round(m.y + (y1 - y2) / 2 * z) }, b = { x: Math.round(m.x + (x2 - x1) / 2 * z), y: Math.round(m.y + (y2 - y1) / 2 * z) }; await mouse('mouseDown', a); for (let k = 1; k <= 6; k++) { await mouse('mouseMove', { x: Math.round(a.x + ((b.x - a.x) * k) / 6), y: Math.round(a.y + ((b.y - a.y) * k) / 6) }); await wait(20); } await mouse('mouseUp', b); await wait(200); };
  const type = async (t) => { for (const ch of t) { win.webContents.sendInputEvent({ type: 'char', keyCode: ch }); await wait(15); } await wait(150); };

  // ---------- un file: modifica ----------
  await open([f1], 'pdf:edit');
  console.log('schede    :', await ev(`[...document.querySelectorAll('#tabs button')].filter((b) => !b.hidden).map((b) => b.textContent).join(', ') + ' | aperta: ' + window.__pdfEditor.op`));
  ok('pagine nell’editor', (await ev(`document.querySelectorAll('.pg').length`)) === 3);
  await shot('1-editor');

  await E(`E.setTool('text')`); await click(1, 100, 300); await type('Aggiunto à €');
  await E(`E.endEdit()`);
  ok('testo scritto sulla pagina', (await E(`return JSON.stringify(E.items(E.plan[0].id).map((i) => i.type + ':' + (i.text || '')))`)).includes('text:Aggiunto à €'));

  await E(`E.setTool('edittext')`); await wait(500); await click(1, 120, 842 - 724);
  for (let t = 0; t < 30 && !(await ev('document.activeElement.isContentEditable')); t++) await wait(100);
  await E(`if (!document.activeElement.isContentEditable) return; document.activeElement.innerText = 'Il fornitore si impegna a pagare entro 60 giorni.'; document.activeElement.dispatchEvent(new Event('input')); E.endEdit()`);
  const runEdit = JSON.parse(await E(`return JSON.stringify(E.items(E.plan[0].id).filter((i) => i.type !== 'text' || i.text.includes('60')))`));
  ok('modifica di un testo esistente: copertura + nuovo testo con corpo stimato', runEdit.some((i) => i.type === 'whiteout') && runEdit.some((i) => i.type === 'text' && Math.abs(i.size - 12) < 0.6 && i.font === 'helv'), runEdit.map((i) => i.type + (i.size ? '@' + i.size : '')).join(', '));

  await E(`E.setTool('highlight')`); await dragOn(1, 58, 842 - 785, 300, 842 - 765);
  await E(`E.setTool('ink')`); await dragOn(1, 100, 500, 250, 560);
  await E(`E.setTool('redact')`); await dragOn(2, 55, 842 - 728, 330, 842 - 715);
  await E(`E.setTool('check')`); await click(1, 80, 600);
  await E(`E.setTool('select')`);
  await shot('2-modifiche');
  const n0 = (await E(`return E.items(E.plan[0].id).length`));
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))`); await wait(100);
  ok('annulla (Ctrl+Z)', (await E(`return E.items(E.plan[0].id).length`)) === n0 - 1);
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }))`); await wait(100);
  ok('ripeti (Ctrl+Y)', (await E(`return E.items(E.plan[0].id).length`)) === n0);

  await E(`E.go()`); await finish();
  console.log('salva     :', await result());
  const mod = made(/modificato/);
  ok('PDF modificato creato', mod.length === 1, mod.join(', '));
  if (mod.length) {
    const t1 = await texts(path.join(d, mod[0]), 1), t2 = await texts(path.join(d, mod[0]), 2);
    const added = t1.find((t) => t.str.includes('Aggiunto'));
    ok('il testo aggiunto è dove è stato cliccato', added && Math.abs(added.x - 100) < 2 && Math.abs(added.y - 300) < 12, added && `${added.str} @${added.x.toFixed(0)},${added.y.toFixed(0)}`);
    const repl = t1.find((t) => t.str.includes('60 giorni'));
    ok('testo esistente riscritto alla stessa altezza', repl && Math.abs(repl.y - (842 - 720)) < 1.5 && Math.abs(repl.x - 60) < 1.5, repl && `@${repl.x.toFixed(1)},${repl.y.toFixed(1)} (originale 60,122)`);
    ok('pagina oscurata: la frase sotto il nero è sparita', !t2.some((t) => t.str.includes('impegna')) && t2.length === 0, t2.map((t) => t.str).join('|') || 'nessun testo');
  }

  // ---------- moduli ----------
  await E(`E.setOp('form')`); await wait(300);
  await ev(`(() => { const i = document.querySelector('#fields input[type=text]'); i.value = 'Giulia Bianchi'; i.dispatchEvent(new Event('input')); })()`);
  await shot('4-moduli');

  // ---------- proteggi e comprimi ----------
  await E(`E.setOp('protect')`); await wait(300);
  await ev(`document.getElementById('pwOpen').value = 'a'; document.getElementById('pwOpen2').value = 'b'`);
  await E(`E.go()`); await wait(300);
  console.log('password diverse:', await ev(`document.getElementById('msg').textContent`));
  await ev(`document.getElementById('pwOpen2').value = 'a'; document.getElementById('pmCopy').checked = false`);
  await shot('6-proteggi');
  await E(`E.go()`); await finish();
  console.log('proteggi  :', await result(), '|', await ev(`document.getElementById('msg').textContent`));
  const prot = made(/protetto/);
  try { await texts(path.join(d, prot[0])); ok('protetto: senza password non si apre', false); } catch (e) { ok('protetto: senza password non si apre', /Password/.test(e.name), e.name); }
  const unlocked = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(path.join(d, prot[0]))), password: 'a', verbosity: 0 }).promise;
  const tp = (await (await unlocked.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  ok('...con la password contiene le modifiche e il modulo compilato', /60 giorni/.test(tp) && unlocked.numPages === 3 && /Giulia/.test(JSON.stringify(await unlocked.getFieldObjects())), `${unlocked.numPages} pagine; ${tp.slice(0, 160)}; campi ${JSON.stringify(await unlocked.getFieldObjects()).slice(0, 120)}`);
  // ---------- pagine ----------
  await E(`E.setOp('pages')`); await wait(800);
  await shot('3-pagine');
  await ev(`document.querySelectorAll('.card')[1].click()`); await ev(`document.getElementById('gRotR').click()`);
  await ev(`document.querySelectorAll('.card')[0].click()`); await ev(`document.getElementById('gDel').click()`);
  ok('ruota ed elimina', (await E(`return E.plan.map((p) => p.page + '@' + p.rotate).join(',')`)) === '1@90,2@0');
  await E(`E.go()`); await finish();
  const mod2 = made(/modificato\) \(1\)/);
  const doc2 = mod2.length && await texts(path.join(d, mod2[0]));
  // la pagina 1 è quella oscurata: diventa un'immagine già girata (orizzontale, rotazione 0)
  const vp1 = doc2 && (await doc2.getPage(1)).getViewport({ scale: 1 });
  ok('PDF con pagine riordinate', doc2 && doc2.numPages === 2 && vp1.width > vp1.height && (await doc2.getPage(2)).rotate === 90, mod2.join(', ') + (doc2 ? ` ${doc2.numPages} pagine, rotazioni ${(await doc2.getPage(1)).rotate},${doc2.numPages > 1 ? (await doc2.getPage(2)).rotate : ''}` : ''));

  // ---------- firma digitale ----------
  await E(`E.setOp('sign')`); await wait(1500);
  await dragOn(1, 330, 640, 540, 720);
  ok('riquadro della firma visibile', !!(await E(`return E.sigBox && E.sigBox.w > 150`)));
  console.log('certificati:', await ev(`[...document.querySelectorAll('#cList option')].map((o) => o.textContent).join(' | ') + ' || ' + document.getElementById('cInfo').textContent`));
  await shot('5-firma');

  await E(`E.setOp('compress')`); await shot('7-comprimi');
  win.destroy(); await wait(400);

  // ---------- più file: unisci ----------
  await open([f1, f2], 'pdf:merge');
  console.log('schede    :', await ev(`[...document.querySelectorAll('#tabs button')].filter((b) => !b.hidden).map((b) => b.textContent).join(', ') + ' | aperta: ' + window.__pdfEditor.op`));
  ok('tutte le pagine dei due file', (await ev(`document.querySelectorAll('.card').length`)) === 6);
  await shot('8-unisci');
  await E(`E.go()`); await finish();
  const un = made(/unione/);
  ok('PDF unito', un.length === 1 && (await texts(path.join(d, un[0]))).numPages === 6, un.join(', '));
  await E(`E.setOp('compress')`); await E(`E.go()`); await finish();
  console.log('comprimi tutti:', await result());
  await shot('9-comprimi-tutti');
  win.destroy(); await wait(300);

  console.log(fail ? `\n${fail} prove FALLITE` : '\nTutte le prove superate', '— screenshot in', OUT);
  fs.rmSync(d, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
