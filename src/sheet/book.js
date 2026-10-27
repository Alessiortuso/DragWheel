// Lettura e scrittura dei fogli di calcolo. XLSX con exceljs (mantiene colori, grassetti, formati); XLS e ODS passano da SheetJS;
// i CSV si leggono con codifica e separatore riconosciuti (UTF-8 o Windows-1252, ; , o tab).
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const XLSX = require('xlsx');

const extOf = (f) => path.extname(f).slice(1).toLowerCase();
const baseOf = (f) => path.basename(f, path.extname(f));
const KINDS = { xlsx: 'xlsx', xlsm: 'xlsx', xls: 'xls', ods: 'ods', csv: 'csv', tsv: 'csv', txt: 'csv' };
const kindOf = (f) => KINDS[extOf(f)] || null;

// Nome di file sicuro (niente caratteri vietati da Windows)
const safeName = (s, max = 80) => String(s).replace(/[\\/:*?"<>|\r\n\t]+/g, '_').replace(/\s+/g, ' ').trim().slice(0, max).replace(/[. ]+$/, '') || '(vuoto)';
const sheetName = (s) => safeName(s, 31).replace(/[\[\]*?:/\\]/g, '_') || 'Foglio'; // limiti di Excel sui nomi dei fogli

function decode(buf) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch { return new TextDecoder('windows-1252').decode(buf); } // i CSV di Excel in italiano spesso non sono UTF-8
}
function detectDelimiter(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim()) || '';
  let best = ',', bestN = -1;
  for (const d of [';', ',', '\t']) { const n = line.split(d).length; if (n > bestN) { best = d; bestN = n; } }
  return best;
}

// Valori dei CSV: "1,5" e "1.5" diventano numeri, "31/12/2025" diventa data, VERO/FALSO booleani
function csvValue(v) {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (/^-?\d+$/.test(t) && t.length < 16 && !/^-?0\d/.test(t)) return Number(t);   // "007" resta testo
  if (/^-?\d+[.,]\d+$/.test(t) && !/^-?0\d/.test(t)) return Number(t.replace(',', '.'));
  const d = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (d && +d[2] >= 1 && +d[2] <= 12 && +d[1] >= 1 && +d[1] <= 31) return new Date(Date.UTC(+d[3], +d[2] - 1, +d[1]));
  if (/^(VERO|TRUE)$/i.test(t)) return true;
  if (/^(FALSO|FALSE)$/i.test(t)) return false;
  return v;
}

// Carica qualsiasi formato supportato come workbook di exceljs. Restituisce anche il separatore, se era un CSV
async function load(file) {
  const kind = kindOf(file), wb = new ExcelJS.Workbook();
  if (!kind) throw new Error(`formato non supportato: .${extOf(file)}`);
  if (kind === 'xlsx') { await wb.xlsx.readFile(file); }
  else if (kind === 'csv') {
    const text = decode(fs.readFileSync(file)), delimiter = detectDelimiter(text);
    await wb.csv.read(Readable.from([text]), { sheetName: sheetName(baseOf(file)), parserOptions: { delimiter }, map: csvValue });
    wb.__delimiter = delimiter;
  } else { // xls, ods
    const book = XLSX.readFile(file, { cellDates: true });
    await wb.xlsx.load(XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  }
  wb.__kind = kind;
  return wb;
}

// Valore semplice di una cella (le formule danno il risultato calcolato)
function plain(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return plain(v.result);
    if (Array.isArray(v.richText)) return v.richText.map((t) => t.text).join('');
    if (v.error) return String(v.error);
    if ('text' in v) return plain(v.text);
    if (v.hyperlink) return v.hyperlink;
    return '';
  }
  return v;
}
const visibleSheets = (wb) => wb.worksheets.filter((ws) => ws.state === 'visible' || !ws.state);

// Tabella di valori semplici dell'intera area usata (opzionalmente le prime righe/colonne)
function matrix(ws, maxRows = Infinity, maxCols = Infinity) {
  const R = Math.min(ws.rowCount, maxRows), C = Math.min(ws.columnCount, maxCols), out = [];
  for (let r = 1; r <= R; r++) { const row = ws.getRow(r), line = []; for (let c = 1; c <= C; c++) line.push(plain(row.getCell(c).value)); out.push(line); }
  return out;
}
const isEmptyVal = (v) => v === '' || v === null || v === undefined || (typeof v === 'string' && !v.trim());
const headerRowOf = (m) => { const i = m.findIndex((r) => r.some((v) => !isEmptyVal(v))); return i < 0 ? 0 : i; }; // indice (0-based) della prima riga non vuota

function dateText(d) {
  const s = d.toISOString(); // exceljs rappresenta le date di Excel come UTC
  return /T00:00:00\.000Z$/.test(s) ? s.slice(0, 10) : s.slice(0, 19).replace('T', ' ');
}
const colLetter = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = ((n - 1 - m) / 26) | 0; } return s; };

// ---------- scrittura di testo ----------
function csvText(ws, o = {}) {
  const d = o.delimiter || ';', rows = matrix(ws);
  const field = (v) => {
    if (isEmptyVal(v)) return '';
    let s;
    if (typeof v === 'number') s = String(v); else if (v instanceof Date) s = dateText(v);
    else if (typeof v === 'boolean') s = o.decimalComma ? (v ? 'VERO' : 'FALSO') : (v ? 'TRUE' : 'FALSE'); else s = String(v);
    if (typeof v === 'number' && o.decimalComma) s = s.replace('.', ',');
    return s.includes(d) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return (o.bom === false ? '' : '﻿') + rows.map((r) => r.map(field).join(d)).join('\r\n') + '\r\n';
}

// raw: le date restano Date (per l'SQL); altrimenti diventano testo come nel foglio
function jsonRows(ws, { raw = false } = {}) {
  const m = matrix(ws), h = headerRowOf(m), head = [], seen = new Map();
  (m[h] || []).forEach((v, i) => {
    let k = isEmptyVal(v) ? `colonna ${i + 1}` : String(v).trim();
    if (seen.has(k)) { const n = seen.get(k) + 1; seen.set(k, n); k = `${k}_${n}`; } else seen.set(k, 1);
    head.push(k);
  });
  return m.slice(h + 1).filter((r) => r.some((v) => !isEmptyVal(v))).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i] instanceof Date && !raw ? dateText(r[i]) : isEmptyVal(r[i]) ? null : r[i]])));
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function htmlText(wb, title) {
  const tables = visibleSheets(wb).map((ws) => {
    const rows = matrix(ws), h = headerRowOf(rows);
    const cell = (v) => (v instanceof Date ? dateText(v) : isEmptyVal(v) ? '' : esc(v));
    return `<h2>${esc(ws.name)}</h2>\n<table>\n${rows.map((r, i) => `<tr>${r.map((v) => (i === h ? `<th>${cell(v)}</th>` : `<td>${cell(v)}</td>`)).join('')}</tr>`).join('\n')}\n</table>`;
  });
  return `<!doctype html>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n<style>body{font:14px Segoe UI,sans-serif;margin:24px}table{border-collapse:collapse;margin:8px 0 28px}th,td{border:1px solid #ccc;padding:4px 10px;text-align:left}th{background:#f3e3d3}</style>\n${tables.join('\n')}\n`;
}

// Intestazione in grassetto, riga bloccata, larghezze adatte (per i fogli nati da CSV)
function tidy(ws) {
  if (!ws.rowCount) return;
  ws.getRow(1).font = { bold: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  for (let c = 1; c <= ws.columnCount; c++) {
    let w = 8;
    for (let r = 1; r <= Math.min(ws.rowCount, 200); r++) { const v = plain(ws.getRow(r).getCell(c).value); w = Math.max(w, (v instanceof Date ? 10 : String(v).length) + 2); }
    ws.getColumn(c).width = Math.min(w, 60);
  }
  ws.eachRow((row) => row.eachCell((cell) => { if (plain(cell.value) instanceof Date) cell.numFmt = 'dd/mm/yyyy'; }));
}

module.exports = { ExcelJS, csvValue, load, plain, matrix, visibleSheets, csvText, jsonRows, htmlText, tidy, headerRowOf, isEmptyVal, dateText, colLetter, safeName, sheetName, kindOf, extOf, baseOf };
