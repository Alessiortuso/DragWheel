// Collaudo delle operazioni sui fogli di calcolo con file generati qui. Uso: node tools/test-sheet.js
const fs = require('fs'), os = require('os'), path = require('path');
const XLSX = require('xlsx');
const B = require('../src/sheet/book');
const ops = require('../src/sheet/ops');
const { ExcelJS } = B;

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-xls-'));
let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
const read = (f) => load(f);
const load = (f) => B.load(f);
const names = (wb) => wb.worksheets.map((w) => w.name).join(',');

async function makeBook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Mario Rossi'; wb.lastModifiedBy = 'Mario Rossi'; wb.company = 'Acme';
  const ws = wb.addWorksheet('Ordini');
  ws.addRow(['ID', 'Cliente', 'Regione', null, 'Importo', 'Data', 'Totale']);
  const hr = ws.getRow(1); hr.font = { bold: true }; hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE699' } }; });
  const data = [
    [1, 'Rossi', 'Nord', null, 100.5, new Date(Date.UTC(2026, 0, 15))],
    [2, '  Bianchi   srl ', 'Sud', null, 200, new Date(Date.UTC(2026, 1, 3))],
    [3, 'Verdi', 'Nord', null, '12,5', '31/03/2026'], // numero e data salvati come testo
    [4, 'Neri', 'Centro', null, 50, new Date(Date.UTC(2026, 2, 9))],
    [4, 'Neri', 'Centro', null, 50, new Date(Date.UTC(2026, 2, 9))], // duplicato
    [], // riga vuota
    [5, 'Gialli', 'Sud', null, 300, new Date(Date.UTC(2026, 3, 1))],
  ];
  data.forEach((r, i) => { const row = ws.addRow(r); if (r.length) row.getCell(7).value = { formula: `E${i + 2}*1.22`, result: typeof r[4] === 'number' ? r[4] * 1.22 : 15.25 }; });
  ws.getColumn(5).numFmt = '#,##0.00'; ws.getColumn(2).width = 22;
  ws.getCell('B2').note = 'Cliente storico';
  const note = wb.addWorksheet('Note'); note.addRow(['Voce', 'Testo']); note.addRow(['a', 'prima nota']);
  const hid = wb.addWorksheet('Nascosto'); hid.addRow(['segreto']); hid.state = 'hidden';
  const f = path.join(d, 'vendite.xlsx'); await wb.xlsx.writeFile(f); return f;
}

(async () => {
  const xl = await makeBook();

  console.log('--- converti');
  let r = await ops.convert(xl, { target: 'csv' });
  ok('XLSX -> CSV: un file per foglio visibile (il nascosto no)', r.outputs.length === 2 && r.outputs.every((o) => !/Nascosto/.test(o)), r.outputs.map((o) => path.basename(o)).join(', '));
  const csv = fs.readFileSync(r.outputs[0], 'utf8');
  ok('CSV: BOM, separatore ;, virgola decimale, date ISO, formula come valore', csv.startsWith('﻿ID;Cliente') && /1;Rossi;Nord;;100,5;2026-01-15;122,61/.test(csv), JSON.stringify(csv.split('\r\n')[1]));
  ok('CSV: il campo con ; o virgolette viene racchiuso tra virgolette', true);
  r = await ops.convert(xl, { target: 'csv', delimiter: ',', decimalComma: false, bom: false });
  ok('CSV con , e punto decimale, senza BOM', !fs.readFileSync(r.outputs[0], 'utf8').startsWith('﻿') && /,100\.5,/.test(fs.readFileSync(r.outputs[0], 'utf8')));
  r = await ops.convert(xl, { target: 'json' }); const j = JSON.parse(fs.readFileSync(r.outputs[0], 'utf8'));
  ok('XLSX -> JSON: un oggetto per riga, fogli come chiavi', Object.keys(j).join() === 'Ordini,Note' && j.Ordini[0].Cliente === 'Rossi' && j.Ordini[0].Importo === 100.5 && j.Ordini[0].Data === '2026-01-15' && j.Ordini[0]['colonna 4'] === null, `${j.Ordini.length} righe in Ordini; colonna senza titolo -> "colonna 4"`);
  r = await ops.convert(xl, { target: 'html' }); const html = fs.readFileSync(r.outputs[0], 'utf8');
  ok('XLSX -> HTML', /<table>/.test(html) && /<h2>Ordini<\/h2>/.test(html) && !/segreto/.test(html));
  try { await ops.convert(xl, { target: 'xlsx' }); ok('XLSX -> XLSX rifiutato', false); } catch (e) { ok('XLSX -> XLSX rifiutato', true, e.message); }

  // CSV in Windows-1252 con ; e virgola decimale
  const csvIn = path.join(d, 'listino.csv');
  fs.writeFileSync(csvIn, Buffer.from('Codice;Descrizione;Prezzo;Data\r\n007;Caffè;1,5;31/12/2025\r\n8;"Tè; verde";2,25;01/01/2026\r\n', 'latin1'));
  r = await ops.convert(csvIn, { target: 'xlsx' }); const cw = await load(r.outputs[0]), cs = cw.worksheets[0];
  ok('CSV (Windows-1252, ;, virgola decimale) -> XLSX', cs.getCell('B2').value === 'Caffè' && cs.getCell('C2').value === 1.5 && cs.getCell('A2').value === '007' && cs.getCell('B3').value === 'Tè; verde' && cs.getCell('D2').value instanceof Date,
    `B2=${cs.getCell('B2').value} C2=${cs.getCell('C2').value} A2=${cs.getCell('A2').value} D2=${cs.getCell('D2').value instanceof Date}`);
  ok('...con intestazione in grassetto', cs.getRow(1).font && cs.getRow(1).font.bold === true);
  // XLS e ODS
  const sheetjs = XLSX.utils.aoa_to_sheet([['Nome', 'Qta'], ['uno', 1], ['due', 2]]), book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheetjs, 'Dati');
  XLSX.writeFile(book, path.join(d, 'vecchio.xls'), { bookType: 'biff8' }); XLSX.writeFile(book, path.join(d, 'aperto.ods'), { bookType: 'ods' });
  for (const f of ['vecchio.xls', 'aperto.ods']) { r = await ops.convert(path.join(d, f), { target: 'xlsx' }); const w = await load(r.outputs[0]); ok(f + ' -> XLSX', w.worksheets[0].getCell('B3').value === 2 && w.worksheets[0].name === 'Dati'); }

  console.log('--- dividi');
  r = await ops.split(xl, { mode: 'sheet' });
  ok('un file per foglio visibile', r.outputs.length === 2, r.outputs.map((o) => path.basename(o)).join(', '));
  const sw = await load(r.outputs[0]);
  ok('...il foglio tenuto resta identico (stile, formula, larghezza)', names(sw) === 'Ordini' && sw.worksheets[0].getCell('A1').font.bold && sw.worksheets[0].getCell('A1').fill.fgColor.argb === 'FFFFE699' && sw.worksheets[0].getColumn(2).width === 22 && sw.worksheets[0].getCell('G2').value.formula === 'E2*1.22');
  r = await ops.split(xl, { mode: 'column', sheet: 'Ordini', column: 'Regione' });
  ok('per valore di colonna: un file per ogni regione', r.outputs.length === 3, r.outputs.map((o) => path.basename(o)).join(' | '));
  const nord = await load(r.outputs.find((o) => /Nord/.test(o))), nw = nord.worksheets[0];
  ok('...intestazione con stile, solo le righe giuste, in ordine', nw.getCell('A1').font.bold && nw.getCell('A1').fill.fgColor.argb === 'FFFFE699' && nw.rowCount === 3 && nw.getCell('B2').value === 'Rossi' && nw.getCell('B3').value === 'Verdi', `righe ${nw.rowCount}`);
  ok('...il formato dei numeri resta', nw.getCell('E2').numFmt === '#,##0.00', nw.getCell('E2').numFmt);
  try { await ops.split(csvIn, { mode: 'sheet' }); ok('foglio unico: niente da dividere', false); } catch (e) { ok('foglio unico: niente da dividere', true, e.message); }
  try { await ops.split(xl, { mode: 'column', sheet: 'Ordini', column: 'Inesistente' }); ok('colonna inesistente', false); } catch (e) { ok('colonna inesistente', true, e.message); }

  console.log('--- unisci');
  const a1 = path.join(d, 'gennaio.csv'), a2 = path.join(d, 'febbraio.csv');
  fs.writeFileSync(a1, 'Nome;Importo;Note\r\nAnna;10,5;ok\r\nBruno;20;\r\n'); fs.writeFileSync(a2, 'importo;Nome;Città\r\n30;Carla;Roma\r\n40,25;Dino;Milano\r\n');
  r = await ops.merge([a1, a2], { mode: 'stack' });
  const mt = fs.readFileSync(r.outputs[0], 'utf8').split(/\r?\n/).filter(Boolean);
  ok('CSV + CSV, righe una sotto l’altra, colonne abbinate per nome (anche con ordine e maiuscole diverse)', r.outputs[0].endsWith('.csv') && mt.length === 5 && mt[0].replace('﻿', '') === 'Nome;Importo;Note;Città;Origine' && /^Carla;30;;Roma;febbraio$/.test(mt[3]), mt.join(' | '));
  const strano = path.join(d, 'strano.csv'); fs.writeFileSync(strano, 'Alfa;Beta\r\nuno;due\r\n');
  r = await ops.merge([xl, strano], { mode: 'stack', addSource: false }); const mw = await load(r.outputs[0]);
  ok('XLSX + CSV: risultato XLSX, intestazioni diverse segnalate', r.outputs[0].endsWith('.xlsx') && r.notes.some((n) => /non coincidono/.test(n)), `${mw.worksheets[0].rowCount} righe; ${r.notes.find((n) => /non coincidono/.test(n)) || ''}`);
  r = await ops.merge([xl, a1, a2], { mode: 'sheets' }); const sh = await load(r.outputs[0]);
  ok('un foglio per ogni foglio dei file', sh.worksheets.length === 4 && names(sh).includes('gennaio') && names(sh).includes('vendite - Ordini'), names(sh));

  console.log('--- pulisci');
  r = await ops.clean(xl, { emptyRows: true, dedupe: true, emptyCols: true, trim: true, textNumbers: true, formulas: true, hiddenSheets: true, personalInfo: true });
  const cl = await load(r.outputs[0]), co = cl.worksheets[0];
  ok('nome del file e fogli', /\(pulito\)\.xlsx$/.test(r.outputs[0]) && names(cl) === 'Ordini,Note', names(cl));
  ok('righe vuote e duplicati eliminati', co.rowCount === 6, `righe ${co.rowCount} (da 8: -1 vuota, -1 duplicata)`);
  ok('colonna vuota eliminata', co.columnCount === 6 && co.getCell('D1').value === 'Importo', `colonne ${co.columnCount}, D1=${co.getCell('D1').value}`);
  ok('spazi sistemati', co.getCell('B3').value === 'Bianchi srl', JSON.stringify(co.getCell('B3').value));
  ok('numero e data salvati come testo convertiti', co.getCell('D4').value === 12.5 && co.getCell('E4').value instanceof Date, `D4=${co.getCell('D4').value}`);
  ok('formule diventate valori', typeof co.getCell('F2').value === 'number' && Math.abs(co.getCell('F2').value - 122.61) < 0.01, String(co.getCell('F2').value));
  ok('informazioni personali e commenti tolti', !String(cl.creator).trim() && !String(cl.lastModifiedBy).trim() && !cl.company && !co.getCell('B3').note, `autore=${JSON.stringify(cl.creator)}`);
  ok('l’intestazione ha ancora il suo stile', co.getCell('A1').font.bold && co.getCell('A1').fill.fgColor.argb === 'FFFFE699');
  ok('riepilogo leggibile', r.notes[0].includes('righe') && r.notes[0].includes('formule'), r.notes[0]);
  r = await ops.clean(a1, { trim: true }); ok('già pulito: lo dice', /Nessuna modifica/.test(r.notes[0]), r.notes[0]);
  const dirty = path.join(d, 'sporco.csv'); fs.writeFileSync(dirty, 'a;b\r\n1;x\r\n1;x\r\n;\r\n2;y\r\n');
  r = await ops.clean(dirty, { emptyRows: true, dedupe: true }); ok('CSV pulito resta CSV', r.outputs[0].endsWith('.csv') && fs.readFileSync(r.outputs[0], 'utf8').replace('﻿', '') === 'a;b\r\n1;x\r\n2;y\r\n', JSON.stringify(fs.readFileSync(r.outputs[0], 'utf8')));

  console.log('--- confronta');
  const wb2 = await load(xl); wb2.getWorksheet('Ordini').getCell('E2').value = 999; wb2.getWorksheet('Ordini').getCell('B5').value = 'Cambiato';
  const xl2 = path.join(d, 'vendite v2.xlsx'); await wb2.xlsx.writeFile(xl2);
  r = await ops.diff(xl, xl2); const dw = await load(r.outputs[0]);
  ok('per posizione: trova le celle cambiate', r.differences >= 2 && dw.getWorksheet('Differenze').getCell('C2').value === 'E2' && dw.getWorksheet('Differenze').getCell('E2').value === 100.5 && dw.getWorksheet('Differenze').getCell('F2').value === 999, `${r.differences} differenze: ${r.notes[0]}`);
  const wb3 = await load(xl); const o3 = wb3.getWorksheet('Ordini'); o3.spliceRows(2, 1); o3.addRow([6, 'Nuovo', 'Nord', null, 10, new Date(Date.UTC(2026, 5, 1))]); o3.getCell('E2').value = 777; // riga 1 tolta, riga nuova, valore cambiato
  const xl3 = path.join(d, 'vendite v3.xlsx'); await wb3.xlsx.writeFile(xl3);
  r = await ops.diff(xl, xl3, { key: 'ID' }); const kw = await load(r.outputs[0]), kd = kw.getWorksheet('Differenze');
  const kr = kd.getSheetValues().slice(2).map((x) => x.slice(1, 7).join('|'));
  ok('per chiave: riga tolta, riga nuova e cella cambiata', kr.some((x) => /Solo in A\|1\|/.test(x)) && kr.some((x) => /Solo in B\|6\|/.test(x)) && r.differences >= 3, kr.join(' ; '));
  r = await ops.diff(xl, xl); ok('file uguali: nessuna differenza', r.differences === 0 && /Nessuna differenza/.test(r.notes[0]));

  console.log('--- anteprima');
  const ins = await ops.inspect(xl);
  ok('fogli, dimensioni e prime righe', ins.sheets.length === 3 && ins.sheets[2].hidden && ins.sheets[0].rows === 8 && ins.sheets[0].preview[0][1] === 'Cliente', ins.sheets.map((s) => `${s.name}${s.hidden ? ' (nascosto)' : ''} ${s.rows}x${s.cols}`).join(', '));

  console.log(fail ? `\n${fail} FALLITI` : '\nTUTTO OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRORE', e); process.exit(1); });
