// Operazioni sui fogli di calcolo. Ogni funzione crea file nuovi accanto all'originale (che non viene mai toccato)
// e restituisce { outputs: [percorsi], notes: [frasi da mostrare] }.
const fs = require('fs');
const path = require('path');
const { uniquePath } = require('../converter');
const XLSX = require('xlsx');
const B = require('./book');
const { ExcelJS, load, plain, matrix, visibleSheets, headerRowOf, isEmptyVal, safeName, sheetName, dateText, colLetter, csvValue } = B;

const dirOf = (f) => path.dirname(f);
const keyOf = (v) => (v instanceof Date ? dateText(v) : isEmptyVal(v) ? '' : String(v).trim());
const forCopy = (v) => (v && typeof v === 'object' && v.hyperlink ? v : plain(v)); // i collegamenti restano, le formule diventano valori

// Copia una riga con il suo aspetto (valori, stili, altezza)
function copyRow(src, dst, cols) {
  for (let c = 1; c <= cols; c++) {
    const s = src.getCell(c), d = dst.getCell(c);
    d.value = forCopy(s.value);
    if (s.style && Object.keys(s.style).length) d.style = s.style;
  }
  if (src.height) dst.height = src.height;
}
function copyColumns(src, dst) { for (let c = 1; c <= src.columnCount; c++) { const w = src.getColumn(c).width; if (w) dst.getColumn(c).width = w; } }
function copySheet(src, dst) { copyColumns(src, dst); for (let r = 1; r <= src.rowCount; r++) copyRow(src.getRow(r), dst.getRow(r), src.columnCount); }
function uniqueSheet(wb, wanted) { let n = sheetName(wanted), i = 2; while (wb.getWorksheet(n)) n = sheetName(`${wanted} (${i++})`.slice(-31)); return n; }

// ---------- converti ----------
async function convert(file, o = {}) {
  const wb = await load(file), kind = wb.__kind, base = B.baseOf(file), dir = dirOf(file), t = o.target;
  const sheets = visibleSheets(wb);
  if (!sheets.length) throw new Error('il file non contiene fogli visibili');
  const outputs = [], notes = [];
  const ext = B.extOf(file), own = ext === 'xlsm' ? 'xlsm' : kind === 'csv' ? (ext === 'tsv' ? 'tsv' : 'csv') : kind;
  if (t === own) throw new Error(`il file è già in formato ${t.toUpperCase()}`);
  if (t === 'xlsx') {
    if (kind === 'csv') sheets.forEach(B.tidy);
    const out = uniquePath(dir, base, 'xlsx'); await wb.xlsx.writeFile(out); outputs.push(out);
    if (kind === 'xls') notes.push('Il formato XLS non conserva tutti gli stili: colori e formattazione possono essere semplificati.');
  } else if (t === 'xls' || t === 'ods') {
    // exceljs scrive solo xlsx: si passa da SheetJS (gli stili si semplificano)
    const book = XLSX.read(await wb.xlsx.writeBuffer(), { type: 'buffer', cellDates: true });
    const out = uniquePath(dir, base, t); XLSX.writeFile(book, out, { bookType: t === 'xls' ? 'biff8' : 'ods' }); outputs.push(out);
    notes.push(`Il formato ${t.toUpperCase()} non conserva tutti gli stili: colori e formattazione possono essere semplificati.`);
  } else if (t === 'pdf') {
    const out = uniquePath(dir, base, 'pdf');
    await require('../print-pdf').htmlToPdf(B.htmlText(wb, base), out, { landscape: true }); outputs.push(out);
    notes.push('PDF con il contenuto delle celle in forma di tabella: colori e larghezze delle colonne non sono riprodotti.');
  } else if (t === 'csv' || t === 'tsv') {
    const delimiter = t === 'tsv' ? '\t' : o.delimiter || ';';
    for (const ws of sheets) {
      const out = uniquePath(dir, sheets.length === 1 ? base : `${base} - ${safeName(ws.name)}`, t);
      fs.writeFileSync(out, B.csvText(ws, { delimiter, decimalComma: o.decimalComma ?? delimiter === ';', bom: o.bom !== false }), 'utf8'); outputs.push(out);
    }
    if (sheets.length > 1) notes.push(`${sheets.length} fogli: un file ${t.toUpperCase()} per ciascuno.`);
  } else if (t === 'json') {
    const one = o.oneFile !== false || sheets.length === 1;
    if (one) {
      const out = uniquePath(dir, base, 'json');
      fs.writeFileSync(out, JSON.stringify(sheets.length === 1 ? B.jsonRows(sheets[0]) : Object.fromEntries(sheets.map((ws) => [ws.name, B.jsonRows(ws)])), null, 2), 'utf8'); outputs.push(out);
    } else for (const ws of sheets) { const out = uniquePath(dir, `${base} - ${safeName(ws.name)}`, 'json'); fs.writeFileSync(out, JSON.stringify(B.jsonRows(ws), null, 2), 'utf8'); outputs.push(out); }
  } else if (t === 'html') {
    const out = uniquePath(dir, base, 'html'); fs.writeFileSync(out, B.htmlText(wb, base), 'utf8'); outputs.push(out);
  } else throw new Error(`formato di uscita sconosciuto: ${t}`);
  return { outputs, notes };
}

// ---------- dividi ----------
async function split(file, o = {}) {
  const wb0 = await load(file), base = B.baseOf(file), dir = dirOf(file), outputs = [], notes = [];
  if (o.mode === 'column') {
    const ws = (o.sheet && wb0.getWorksheet(o.sheet)) || visibleSheets(wb0)[0];
    const m = matrix(ws), h = headerRowOf(m), head = (m[h] || []).map(keyOf);
    const col = typeof o.column === 'number' ? o.column : head.indexOf(String(o.column).trim());
    if (col < 0 || col >= head.length) throw new Error('scegli la colonna in base alla quale dividere');
    const groups = new Map();
    for (let r = h + 1; r < m.length; r++) { if (m[r].every(isEmptyVal)) continue; const k = keyOf(m[r][col]); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r + 1); }
    if (!groups.size) throw new Error('non ci sono righe da dividere');
    if (groups.size > 300) throw new Error(`la colonna “${head[col]}” ha ${groups.size} valori diversi: troppi per creare un file ciascuno (massimo 300)`);
    for (const [key, rows] of groups) {
      const wb = new ExcelJS.Workbook(), w2 = wb.addWorksheet(sheetName(ws.name));
      copyColumns(ws, w2);
      for (let r = 1; r <= h + 1; r++) copyRow(ws.getRow(r), w2.getRow(r), ws.columnCount); // righe sopra e intestazione
      rows.forEach((r, i) => copyRow(ws.getRow(r), w2.getRow(h + 2 + i), ws.columnCount));
      w2.views = [{ state: 'frozen', ySplit: h + 1 }];
      const out = uniquePath(dir, `${base} - ${safeName(key || '(vuoto)')}`, 'xlsx'); await wb.xlsx.writeFile(out); outputs.push(out);
    }
    notes.push(`Foglio “${ws.name}” diviso per “${head[col]}”: ${groups.size} file. Le formule sono state sostituite dai loro valori.`);
    return { outputs, notes };
  }
  const sheets = visibleSheets(wb0);
  if (sheets.length < 2) throw new Error('il file ha un solo foglio: non c’è nulla da dividere');
  for (const ws of sheets) { // si rilegge il file ogni volta: così il foglio tenuto resta identico (stili, larghezze, formule)
    const wb = await load(file);
    for (const w of [...wb.worksheets]) if (w.name !== ws.name) wb.removeWorksheet(w.id);
    const out = uniquePath(dir, `${base} - ${safeName(ws.name)}`, 'xlsx'); await wb.xlsx.writeFile(out); outputs.push(out);
  }
  notes.push(`${outputs.length} fogli, un file ciascuno. Grafici e immagini non vengono copiati.`);
  return { outputs, notes };
}

// ---------- unisci ----------
async function merge(files, o = {}) {
  if (!files.length) throw new Error('aggiungi almeno un file');
  const dir = dirOf(files[0]), base0 = B.baseOf(files[0]), notes = [], out = new ExcelJS.Workbook();
  if (o.mode === 'sheets') {
    for (const f of files) {
      const wb = await load(f), sheets = visibleSheets(wb);
      for (const ws of sheets) { const w2 = out.addWorksheet(uniqueSheet(out, sheets.length === 1 ? B.baseOf(f) : `${B.baseOf(f)} - ${ws.name}`)); copySheet(ws, w2); }
    }
    const path_ = uniquePath(dir, `${base0} (unione)`, 'xlsx'); await out.xlsx.writeFile(path_);
    notes.push(`${out.worksheets.length} fogli in un unico file.`);
    return { outputs: [path_], notes };
  }
  // righe una sotto l'altra, abbinando le colonne per nome dell'intestazione
  const ws2 = out.addWorksheet('Unione'), heads = [], index = new Map(), headerCells = [], origins = [], csvDelims = [];
  for (const [n, f] of files.entries()) {
    const wb = await load(f), ws = visibleSheets(wb)[0];
    if (!ws) { notes.push(`${B.baseOf(f)}: nessun foglio visibile, saltato.`); continue; }
    csvDelims.push(wb.__kind === 'csv' ? wb.__delimiter : null);
    const m = matrix(ws), h = headerRowOf(m), map = [];
    let shared = 0;
    (m[h] || []).forEach((v, i) => {
      const k = keyOf(v).toLowerCase();
      if (index.has(k)) shared++;
      else { index.set(k, heads.length); heads.push(keyOf(v) || `colonna ${i + 1}`); headerCells.push(ws.getRow(h + 1).getCell(i + 1)); }
      map[i] = index.get(k);
    });
    if (n > 0 && !shared) notes.push(`${B.baseOf(f)}: le intestazioni non coincidono con quelle dei file precedenti, le colonne sono state aggiunte di fianco.`);
    let added = 0;
    for (let r = h + 1; r < m.length; r++) {
      if (m[r].every(isEmptyVal)) continue;
      const row = ws2.getRow(2 + origins.length), src = ws.getRow(r + 1);
      map.forEach((to, i) => { const s = src.getCell(i + 1), d = row.getCell(to + 1); d.value = forCopy(s.value); if (s.style && Object.keys(s.style).length) d.style = s.style; });
      origins.push(B.baseOf(f)); added++;
    }
    notes.push(`${B.baseOf(f)}: ${added} righe.`);
  }
  heads.forEach((name, i) => { // l'intestazione conserva lo stile del primo file in cui compare
    const c = ws2.getRow(1).getCell(i + 1), s = headerCells[i];
    c.value = name;
    if (s.style && Object.keys(s.style).length) c.style = s.style; else c.font = { bold: true };
  });
  const srcCol = heads.length + 1;
  if (o.addSource !== false) {
    ws2.getRow(1).getCell(srcCol).value = 'Origine'; ws2.getRow(1).getCell(srcCol).font = { bold: true };
    origins.forEach((name, i) => { ws2.getRow(2 + i).getCell(srcCol).value = name; });
  }
  ws2.views = [{ state: 'frozen', ySplit: 1 }];
  B.tidy(ws2);
  const summary = `${origins.length} righe, ${heads.length + (o.addSource !== false ? 1 : 0)} colonne.`;
  if (csvDelims.length && csvDelims.every(Boolean)) { // solo CSV: anche il risultato è un CSV
    const outFile = uniquePath(dir, `${base0} (unione)`, 'csv'), d = csvDelims[0];
    fs.writeFileSync(outFile, B.csvText(ws2, { delimiter: d, decimalComma: d === ';' }), 'utf8');
    return { outputs: [outFile], notes: [...notes, summary] };
  }
  const outFile = uniquePath(dir, `${base0} (unione)`, 'xlsx'); await out.xlsx.writeFile(outFile);
  return { outputs: [outFile], notes: [...notes, summary] };
}

// ---------- pulisci ----------
const hasFormula = (v) => v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v);
function formulasToValues(ws) { let n = 0; ws.eachRow((row) => row.eachCell((cell) => { if (hasFormula(cell.value)) { cell.value = cell.value.result === undefined ? null : plain(cell.value); n++; } })); return n; }

// Rimette in fila le righe tenute (le altre spariscono), conservando valori, stili e altezze.
// exceljs non toglie le righe in coda con spliceRows: si riscrivono le righe tenute in testa e si taglia l'elenco.
function keepRows(ws, keep) {
  const C = ws.columnCount;
  const snap = keep.map((r) => { const row = ws.getRow(r); return { h: row.height, cells: Array.from({ length: C }, (_, i) => { const c = row.getCell(i + 1); return { v: c.value, s: c.style }; }) }; });
  snap.forEach((s, i) => {
    const row = ws.getRow(i + 1);
    s.cells.forEach((c, j) => { const cell = row.getCell(j + 1); cell.value = c.v; cell.style = c.s && Object.keys(c.s).length ? c.s : {}; });
    row.height = s.h;
  });
  ws._rows.length = keep.length;
}

async function clean(file, o = {}) {
  const wb = await load(file), kind = wb.__kind, notes = [], count = {};
  const bump = (k, n) => { if (n) count[k] = (count[k] || 0) + n; };
  if (o.hiddenSheets) for (const ws of [...wb.worksheets]) if (ws.state && ws.state !== 'visible') { wb.removeWorksheet(ws.id); bump('fogli nascosti eliminati', 1); }
  if (o.personalInfo) {
    for (const k of ['company', 'manager', 'title', 'subject', 'keywords', 'category', 'description']) wb[k] = '';
    wb.creator = wb.lastModifiedBy = ' '; // exceljs scriverebbe "Unknown" se fosse vuoto: uno spazio appare come campo vuoto
    for (const ws of wb.worksheets) ws.eachRow((row) => row.eachCell((cell) => { if (cell.note) { cell.note = undefined; bump('commenti eliminati', 1); } }));
    bump('informazioni del documento svuotate (autore, società…)', 1);
  }
  const TEXT_NUMBERS = 'numeri o date salvati come testo convertiti';
  for (const ws of wb.worksheets) {
    if (o.formulas) bump('formule sostituite con il valore', formulasToValues(ws));
    ws.eachRow((row) => row.eachCell((cell) => {
      const v = cell.value;
      if (typeof v !== 'string') return;
      if (o.trim) { const t = v.replace(/\s+/g, ' ').trim(); if (t !== v) { cell.value = t; bump('celle ripulite dagli spazi', 1); } }
      if (o.textNumbers) {
        const n = csvValue(String(cell.value));
        if (typeof n === 'number' || n instanceof Date) { cell.value = n; if (n instanceof Date) cell.numFmt = 'dd/mm/yyyy'; bump(TEXT_NUMBERS, 1); }
      }
    }));
    if (!(o.emptyRows || o.emptyCols || o.dedupe)) continue;
    if (ws.model.merges && ws.model.merges.length) { notes.push(`Foglio “${ws.name}”: contiene celle unite, righe e colonne non sono state toccate.`); continue; }
    // eliminare righe o colonne sposterebbe i riferimenti delle formule: nei fogli toccati le formule diventano valori
    const freeze = (why) => { const n = formulasToValues(ws); if (n) { bump('formule sostituite con il valore', n); notes.push(`Foglio “${ws.name}”: le formule sono diventate valori perché sono state tolte ${why}.`); } };
    const m = matrix(ws), head = headerRowOf(m) + 1;
    let keep = m.map((_, i) => i + 1);
    if (o.emptyRows) keep = keep.filter((r) => !m[r - 1].every(isEmptyVal));
    if (o.dedupe) {
      const seen = new Set();
      keep = keep.filter((r) => { if (r <= head || m[r - 1].every(isEmptyVal)) return true; const k = JSON.stringify(m[r - 1].map(keyOf)); if (seen.has(k)) return false; seen.add(k); return true; });
    }
    if (keep.length !== m.length) {
      freeze('delle righe');
      keepRows(ws, keep);
      bump(o.dedupe && !o.emptyRows ? 'righe duplicate eliminate' : 'righe eliminate (vuote o duplicate)', m.length - keep.length);
    }
    if (o.emptyCols) {
      const mm = matrix(ws), empty = [];
      for (let c = 0; c < ws.columnCount; c++) if (mm.every((r) => isEmptyVal(r[c]))) empty.push(c + 1);
      if (empty.length) { freeze('delle colonne'); for (const c of empty.reverse()) ws.spliceColumns(c, 1); bump('colonne vuote eliminate', empty.length); }
    }
  }
  const dir = dirOf(file), base = B.baseOf(file);
  let out;
  if (kind === 'csv') { out = uniquePath(dir, `${base} (pulito)`, 'csv'); const d = wb.__delimiter || ';'; fs.writeFileSync(out, B.csvText(wb.worksheets[0], { delimiter: d, decimalComma: d === ';' }), 'utf8'); }
  else { out = uniquePath(dir, `${base} (pulito)`, 'xlsx'); await wb.xlsx.writeFile(out); }
  const ONE = { 'fogli nascosti eliminati': 'foglio nascosto eliminato', 'commenti eliminati': 'commento eliminato', 'formule sostituite con il valore': 'formula sostituita con il valore',
    'celle ripulite dagli spazi': 'cella ripulita dagli spazi', [TEXT_NUMBERS]: 'numero o data salvato come testo convertito', 'righe duplicate eliminate': 'riga duplicata eliminata',
    'righe eliminate (vuote o duplicate)': 'riga eliminata (vuota o duplicata)', 'colonne vuote eliminate': 'colonna vuota eliminata' };
  const lines = Object.entries(count).map(([k, n]) => (/informazioni/.test(k) ? k : n === 1 && ONE[k] ? `1 ${ONE[k]}` : `${n} ${k}`));
  return { outputs: [out], notes: [...(lines.length ? [lines.join(' · ')] : ['Nessuna modifica necessaria: il file era già pulito.']), ...notes], changes: count };
}

// ---------- confronta ----------
async function diff(fileA, fileB, o = {}) {
  const A = await load(fileA), Bk = await load(fileB), rows = [], notes = [];
  const sheetsA = visibleSheets(A), sheetsB = visibleSheets(Bk), namesB = new Map(sheetsB.map((w) => [w.name.toLowerCase(), w]));
  const summary = [];
  const same = (a, b) => keyOf(a) === keyOf(b) || (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9);
  const show = (v) => (v instanceof Date ? dateText(v) : isEmptyVal(v) ? '' : v);
  for (const wa of sheetsA) {
    const wbSheet = namesB.get(wa.name.toLowerCase());
    if (!wbSheet) { summary.push([wa.name, 'solo nel file A', 0, 0, 0]); continue; }
    namesB.delete(wa.name.toLowerCase());
    const ma = matrix(wa), mb = matrix(wbSheet);
    let changed = 0, onlyA = 0, onlyB = 0;
    if (o.key) { // righe abbinate per chiave (valore di una colonna)
      const ha = headerRowOf(ma), hb = headerRowOf(mb), headA = (ma[ha] || []).map((v) => keyOf(v)), headB = (mb[hb] || []).map((v) => keyOf(v));
      const ka = headA.findIndex((x) => x.toLowerCase() === String(o.key).toLowerCase()), kb = headB.findIndex((x) => x.toLowerCase() === String(o.key).toLowerCase());
      if (ka < 0 || kb < 0) { summary.push([wa.name, `colonna “${o.key}” non trovata`, 0, 0, 0]); continue; }
      const mapB = new Map(); for (let r = hb + 1; r < mb.length; r++) { const k = keyOf(mb[r][kb]); if (k && !mapB.has(k)) mapB.set(k, r); }
      const seen = new Set();
      for (let r = ha + 1; r < ma.length; r++) {
        const k = keyOf(ma[r][ka]); if (!k) continue; seen.add(k);
        const rb = mapB.get(k);
        if (rb === undefined) { rows.push([wa.name, 'Solo in A', k, '', '', '']); onlyA++; continue; }
        headA.forEach((name, c) => { const cb = headB.indexOf(name); if (cb < 0 || !name) return; if (!same(ma[r][c], mb[rb][cb])) { rows.push([wa.name, 'Cella diversa', k, name, show(ma[r][c]), show(mb[rb][cb])]); changed++; } });
      }
      for (const [k] of mapB) if (!seen.has(k)) { rows.push([wa.name, 'Solo in B', k, '', '', '']); onlyB++; }
    } else { // per posizione
      const R = Math.max(ma.length, mb.length), C = Math.max(wa.columnCount, wbSheet.columnCount);
      for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) {
        const a = ma[r]?.[c] ?? '', b = mb[r]?.[c] ?? '';
        if (!same(a, b)) { if (rows.length < 200000) rows.push([wa.name, 'Cella diversa', `${colLetter(c + 1)}${r + 1}`, '', show(a), show(b)]); changed++; }
      }
    }
    summary.push([wa.name, 'confrontato', changed, onlyA, onlyB]);
  }
  for (const [, w] of namesB) summary.push([w.name, 'solo nel file B', 0, 0, 0]);
  const wb = new ExcelJS.Workbook(), s1 = wb.addWorksheet('Riepilogo'), s2 = wb.addWorksheet('Differenze');
  s1.addRow(['File A', path.basename(fileA)]); s1.addRow(['File B', path.basename(fileB)]); s1.addRow(['Modo', o.key ? `per chiave: ${o.key}` : 'cella per cella']); s1.addRow([]);
  const head1 = s1.addRow(['Foglio', 'Esito', 'Celle diverse', 'Righe solo in A', 'Righe solo in B']); head1.font = { bold: true };
  summary.forEach((r) => s1.addRow(r));
  [28, 28, 16, 18, 18].forEach((w, i) => { s1.getColumn(i + 1).width = w; });
  s2.addRow(['Foglio', 'Tipo', o.key ? 'Chiave' : 'Cella', 'Colonna', 'Valore in A', 'Valore in B']).font = { bold: true };
  rows.forEach((r) => s2.addRow(r));
  [22, 16, 18, 22, 30, 30].forEach((w, i) => { s2.getColumn(i + 1).width = w; });
  s2.views = [{ state: 'frozen', ySplit: 1 }]; if (rows.length) s2.autoFilter = { from: 'A1', to: { row: 1, column: 6 } };
  const total = summary.reduce((n, r) => n + r[2] + r[3] + r[4], 0);
  const out = uniquePath(dirOf(fileA), `Confronto ${B.baseOf(fileA)} e ${B.baseOf(fileB)}`.slice(0, 100), 'xlsx');
  await wb.xlsx.writeFile(out);
  notes.push(total ? `${total} differenze trovate${rows.length >= 200000 ? ' (elencate le prime 200.000)' : ''}.` : 'Nessuna differenza: i due file hanno gli stessi dati.');
  return { outputs: [out], notes, differences: total };
}

// Legge solo ciò che serve a mostrare il file: fogli, dimensioni e le prime righe
async function inspect(file, maxRows = 60, maxCols = 24) {
  const wb = await load(file);
  return {
    kind: wb.__kind, delimiter: wb.__delimiter || null,
    sheets: wb.worksheets.map((ws) => ({ name: ws.name, hidden: !!ws.state && ws.state !== 'visible', rows: ws.rowCount, cols: ws.columnCount, preview: matrix(ws, maxRows, maxCols).map((r) => r.map((v) => (v instanceof Date ? dateText(v) : v))) })),
  };
}

module.exports = { convert, split, merge, clean, diff, inspect };
