// File di dati per programmatori: JSON, YAML, TOML, XML (e CSV/SQL in uscita).
// Conversioni, formattazione, minificazione, validazione con riga e colonna dell'errore, tipi TypeScript e JSON Schema.
// Ogni funzione crea file nuovi accanto all'originale e restituisce { outputs, notes, message }.
const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const TOML = require('smol-toml');
const { XMLParser, XMLBuilder, XMLValidator } = require('fast-xml-parser');
const { uniquePath } = require('../converter');

const KINDS = { json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml' };
const kindOf = (file) => KINDS[path.extname(file).slice(1).toLowerCase()];
const baseOf = (file) => path.basename(file, path.extname(file));
const read = (file) => fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
const NAME = { json: 'JSON', yaml: 'YAML', toml: 'TOML', xml: 'XML', csv: 'CSV', sql: 'SQL' };

// Errore di sintassi con la posizione: { line, col, msg }
class SyntaxProblem extends Error {
  constructor(kind, line, col, msg) {
    super(`${NAME[kind]} non valido${line ? ` alla riga ${line}${col ? `, colonna ${col}` : ''}` : ''}: ${msg}`);
    Object.assign(this, { line, col, short: msg });
  }
}
const lineCol = (text, pos) => { const before = text.slice(0, pos).split('\n'); return [before.length, before[before.length - 1].length + 1]; };

const XML_OPTS = { ignoreAttributes: false, attributeNamePrefix: '@_', textNodeName: '#text', commentPropName: '#comment', cdataPropName: '#cdata', parseTagValue: true, parseAttributeValue: false, trimValues: true };

function parse(text, kind) {
  switch (kind) {
    case 'json':
      try { return JSON.parse(text); } catch (e) {
        const m = /line (\d+) column (\d+)/.exec(e.message), p = /position (\d+)/.exec(e.message);
        const [line, col] = m ? [+m[1], +m[2]] : p ? lineCol(text, +p[1]) : [0, 0];
        throw new SyntaxProblem('json', line, col, e.message.replace(/\s*\(line \d+ column \d+\)/, '').replace(/ in JSON at position \d+/, '').replace(/^JSON\.parse: /, ''));
      }
    case 'yaml': {
      const docs = YAML.parseAllDocuments(text, { prettyErrors: false });
      const bad = docs.flatMap((d) => d.errors || [])[0];
      if (bad) { const [line, col] = bad.linePos ? [bad.linePos[0].line, bad.linePos[0].col] : lineCol(text, bad.pos[0]); throw new SyntaxProblem('yaml', line, col, bad.message.split('\n')[0].replace(/ at line \d+, column \d+:?$/, '')); }
      const values = docs.map((d) => d.toJS({ maxAliasCount: 1000 }));
      return values.length === 1 ? values[0] : values;
    }
    case 'toml':
      try { return TOML.parse(text); } catch (e) { throw new SyntaxProblem('toml', e.line, e.column, String(e.message).split('\n')[0].replace(/^Invalid TOML document: /, '')); }
    case 'xml': {
      const v = XMLValidator.validate(text, { allowBooleanAttributes: true });
      if (v !== true) throw new SyntaxProblem('xml', v.err.line, v.err.col, v.err.msg);
      const obj = new XMLParser({ ...XML_OPTS, commentPropName: false }).parse(text);
      delete obj['?xml'];
      return obj;
    }
    default: throw new Error('formato non riconosciuto');
  }
}

// ---- dai valori ai formati ---------------------------------------------------------------------------
const plainDates = (v) => (v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.map(plainDates) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plainDates(x)])) : v);
function dropNulls(v, notes) {
  if (Array.isArray(v)) return v.filter((x) => x !== null && x !== undefined).map((x) => dropNulls(x, notes));
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) { if (x === null || x === undefined) { notes.add('TOML non ha il valore “null”: i campi vuoti sono stati tolti.'); continue; } o[k] = dropNulls(x, notes); }
    return o;
  }
  return v;
}
const xmlName = (k) => { let n = String(k).replace(/[^\p{L}\p{N}_.:-]/gu, '_'); if (!/^[\p{L}_]/u.test(n)) n = '_' + n; return n; };
function xmlKeys(v) {
  if (Array.isArray(v)) return v.map(xmlKeys);
  if (v && typeof v === 'object' && !(v instanceof Date)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k.startsWith('@_') || k === '#text' ? k : xmlName(k), xmlKeys(x)]));
  return v;
}

function serialize(value, kind, notes = new Set(), { minify = false } = {}) {
  switch (kind) {
    case 'json': return minify ? JSON.stringify(plainDates(value)) : JSON.stringify(plainDates(value), null, 2) + '\n';
    case 'yaml': return YAML.stringify(plainDates(value), { lineWidth: 0 });
    case 'toml': {
      let v = dropNulls(value, notes);
      if (Array.isArray(v) || v === null || typeof v !== 'object') { v = { items: Array.isArray(v) ? v : [v] }; notes.add('In TOML il documento deve essere una tabella: i dati sono sotto la chiave “items”.'); }
      return TOML.stringify(v) + '\n';
    }
    case 'xml': {
      let v = xmlKeys(plainDates(value));
      const keys = v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).filter((k) => !k.startsWith('@_')) : [];
      if (!(keys.length === 1 && !Array.isArray(v[keys[0]]))) { v = { root: Array.isArray(v) ? { item: v } : v }; notes.add('XML vuole un solo elemento principale: i dati sono dentro <root>.'); }
      const b = new XMLBuilder({ ...XML_OPTS, format: !minify, indentBy: '  ', suppressEmptyNode: true });
      return '<?xml version="1.0" encoding="UTF-8"?>' + (minify ? '' : '\n') + b.build(v);
    }
    default: throw new Error(`formato di uscita sconosciuto: ${kind}`);
  }
}

// ---- tabelle (CSV, SQL) ---------------------------------------------------------------------------------
// I record di una struttura: un array di oggetti, o il primo array di oggetti trovato dentro un oggetto
function recordsOf(value) {
  const isRec = (a) => Array.isArray(a) && a.length && a.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (isRec(value)) return { rows: value, name: null };
  if (Array.isArray(value)) return { rows: value.map((x) => ({ valore: x })), name: null };
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) { if (isRec(v)) return { rows: v, name: k }; if (v && typeof v === 'object' && !Array.isArray(v)) { const inner = recordsOf(v); if (inner.name) return inner; } }
    return { rows: [value], name: null };
  }
  throw new Error('i dati non contengono una tabella');
}
// oggetti annidati -> colonne "a.b"; array -> testo JSON
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(plainDates(v)) : v;
  }
  return out;
}
function table(value) {
  const { rows, name } = recordsOf(value);
  const flat = rows.map((r) => flatten(r));
  const cols = [...new Set(flat.flatMap((r) => Object.keys(r)))];
  return { cols, rows: flat, name };
}
const csvCell = (v) => { if (v === null || v === undefined) return ''; const s = v instanceof Date ? v.toISOString() : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = ({ cols, rows }) => '﻿' + [cols.map(csvCell).join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';

// SQL standard (va bene per PostgreSQL, SQLite, SQL Server; MySQL con ANSI_QUOTES): CREATE TABLE + INSERT a blocchi
const sqlId = (s) => `"${String(s).replace(/"/g, '""')}"`;
function sqlType(values) {
  const v = values.filter((x) => x !== null && x !== undefined && x !== '');
  if (!v.length) return 'TEXT';
  if (v.every((x) => typeof x === 'boolean')) return 'BOOLEAN';
  if (v.every((x) => typeof x === 'number' && Number.isInteger(x))) return Math.max(...v.map(Math.abs)) > 2147483647 ? 'BIGINT' : 'INTEGER';
  if (v.every((x) => typeof x === 'number')) return 'DOUBLE PRECISION';
  if (v.every((x) => x instanceof Date || (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)))) return v.every((x) => typeof x === 'string' || (x.getUTCHours() + x.getUTCMinutes() + x.getUTCSeconds() === 0)) ? 'DATE' : 'TIMESTAMP';
  if (v.every((x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(x))) return 'TIMESTAMP';
  const max = Math.max(...v.map((x) => String(x).length));
  return max <= 255 ? `VARCHAR(${Math.max(16, 2 ** Math.ceil(Math.log2(max)))})` : 'TEXT';
}
function sqlValue(v, type) {
  if (v === null || v === undefined || (v === '' && type !== 'TEXT' && !type.startsWith('VARCHAR'))) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return `'${type === 'DATE' ? v.toISOString().slice(0, 10) : v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '')}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
}
function toSql(tables) {
  let out = '-- Creato da DragWheel\n';
  for (const { name, cols, rows } of tables) {
    const types = cols.map((c) => sqlType(rows.map((r) => r[c])));
    out += `\nCREATE TABLE ${sqlId(name)} (\n${cols.map((c, i) => `  ${sqlId(c)} ${types[i]}`).join(',\n')}\n);\n`;
    for (let i = 0; i < rows.length; i += 500) {
      out += `\nINSERT INTO ${sqlId(name)} (${cols.map(sqlId).join(', ')}) VALUES\n`;
      out += rows.slice(i, i + 500).map((r) => `  (${cols.map((c, k) => sqlValue(r[c], types[k])).join(', ')})`).join(',\n') + ';\n';
    }
  }
  return out;
}
const tableName = (s) => String(s || 'dati').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'dati';

// ---- tipi TypeScript e JSON Schema ----------------------------------------------------------------------
const pascal = (s) => { const p = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(''); return /^[A-Za-z]/.test(p) ? p : 'T' + p; };
// nome del tipo degli elementi di un elenco: "users" -> User; per le altre lingue ("utenti") -> UtentiItem
const singular = (s) => (/[^s]s$/i.test(s) ? String(s).replace(/ies$/i, 'y').replace(/s$/i, '') : `${s}Item`);
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);

function typescript(value, rootName) {
  const defs = [], used = new Set();
  const uniq = (n) => { let x = n, i = 2; while (used.has(x)) x = n + i++; used.add(x); return x; };
  const infer = (samples, name) => {
    const parts = new Set(), objs = [], arrs = [];
    for (const s of samples) {
      if (s === null || s === undefined) parts.add('null');
      else if (Array.isArray(s)) arrs.push(s);
      else if (isObj(s)) objs.push(s);
      else parts.add(s instanceof Date ? 'string' : typeof s);
    }
    if (objs.length) parts.add(iface(objs, name));
    if (arrs.length) { const items = arrs.flat(); const t = items.length ? infer(items, singular(name)) : 'unknown'; parts.add(/[|]/.test(t) ? `(${t})[]` : `${t}[]`); }
    return [...parts].join(' | ') || 'unknown';
  };
  const iface = (objs, name) => {
    const n = uniq(pascal(name) || 'Item'), keys = [...new Set(objs.flatMap(Object.keys))], body = [];
    const slot = defs.length; defs.push('');
    for (const k of keys) {
      const present = objs.filter((o) => k in o);
      const prop = /^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k);
      body.push(`  ${prop}${present.length < objs.length ? '?' : ''}: ${infer(present.map((o) => o[k]), k)};`);
    }
    defs[slot] = `export interface ${n} {\n${body.join('\n')}\n}`;
    return n;
  };
  const root = infer([value], rootName);
  const out = defs.filter(Boolean);
  if (!isObj(value)) out.unshift(`export type ${uniq(pascal(rootName) + 'Root')} = ${root};`);
  return '// Tipi generati da DragWheel a partire dai dati di esempio: controllali prima di usarli.\n\n' + out.join('\n\n') + '\n';
}

function schemaOf(samples) {
  const types = new Set(), objs = [], arrs = [], strs = [];
  for (const s of samples) {
    if (s === null || s === undefined) types.add('null');
    else if (Array.isArray(s)) { types.add('array'); arrs.push(s); }
    else if (isObj(s)) { types.add('object'); objs.push(s); }
    else if (s instanceof Date) { types.add('string'); strs.push(s.toISOString()); }
    else if (typeof s === 'number') types.add(Number.isInteger(s) ? 'integer' : 'number');
    else { types.add(typeof s); if (typeof s === 'string') strs.push(s); }
  }
  if (types.has('number')) types.delete('integer');
  const sc = { type: types.size === 1 ? [...types][0] : [...types] };
  if (strs.length && strs.length === samples.filter((s) => typeof s === 'string' || s instanceof Date).length) {
    if (strs.every((s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s))) sc.format = 'date-time';
    else if (strs.every((s) => /^\d{4}-\d{2}-\d{2}$/.test(s))) sc.format = 'date';
    else if (strs.every((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))) sc.format = 'email';
    else if (strs.every((s) => /^https?:\/\//.test(s))) sc.format = 'uri';
  }
  if (objs.length) {
    const keys = [...new Set(objs.flatMap(Object.keys))];
    sc.properties = Object.fromEntries(keys.map((k) => [k, schemaOf(objs.filter((o) => k in o).map((o) => o[k]))]));
    const req = keys.filter((k) => objs.every((o) => k in o));
    if (req.length) sc.required = req;
  }
  if (arrs.length) { const items = arrs.flat(); if (items.length) sc.items = schemaOf(items); }
  return sc;
}

// ---- operazioni -----------------------------------------------------------------------------------------
function load(file) {
  const kind = kindOf(file);
  if (!kind) throw new Error('formato non riconosciuto');
  const text = read(file);
  return { kind, text, value: parse(text, kind) };
}
const write = (file, suffix, ext, text) => { const out = uniquePath(path.dirname(file), suffix ? `${baseOf(file)} (${suffix})` : baseOf(file), ext); fs.writeFileSync(out, text, 'utf8'); return out; };

async function convert(file, target) {
  const { kind, value } = load(file);
  if (kind === target) throw new Error(`il file è già ${NAME[target]}`);
  const notes = new Set();
  let out;
  if (target === 'csv') { const t = table(value); out = write(file, '', 'csv', toCsv(t)); notes.add(`${t.rows.length} righe, ${t.cols.length} colonne${t.name ? ` (dalla chiave “${t.name}”)` : ''}.`); }
  else if (target === 'sql') { const t = table(value); out = write(file, '', 'sql', toSql([{ ...t, name: tableName(t.name || baseOf(file)) }])); notes.add(`Tabella “${tableName(t.name || baseOf(file))}” con ${t.rows.length} righe.`); }
  else out = write(file, '', target === 'yaml' ? 'yaml' : target, serialize(value, target, notes));
  if (kind === 'xml' && target !== 'xml') notes.add('Gli attributi XML diventano chiavi che iniziano con “@_”.');
  return { outputs: [out], notes: [...notes] };
}

async function format(file) {
  const kind = kindOf(file), text = read(file);
  let res;
  if (kind === 'yaml') { parse(text, 'yaml'); res = YAML.parseAllDocuments(text).map((d) => d.toString({ lineWidth: 0 })).join(''); } // i commenti restano
  else if (kind === 'xml') { parse(text, 'xml'); res = xmlKeep(text, false); }
  else res = serialize(parse(text, kind), kind);
  const notes = kind === 'toml' && /(^|\n)\s*#/.test(text) ? ['Nel TOML formattato i commenti non vengono conservati.'] : [];
  return { outputs: [write(file, 'formattato', path.extname(file).slice(1).toLowerCase(), res)], notes };
}

async function minify(file) {
  const kind = kindOf(file), text = read(file);
  if (kind !== 'json' && kind !== 'xml') throw new Error('si possono minificare solo JSON e XML');
  parse(text, kind); // errore con riga e colonna se il file non è valido
  const res = kind === 'xml' ? xmlKeep(text, true) : JSON.stringify(JSON.parse(text));
  const out = write(file, 'minificato', kind, res);
  return { outputs: [out], notes: [`${Math.round((1 - Buffer.byteLength(res) / Buffer.byteLength(text)) * 100)}% più piccolo.`] };
}
// XML riformattato mantenendo ordine, commenti e CDATA
function xmlKeep(text, min) {
  const o = { ...XML_OPTS, preserveOrder: true, parseTagValue: false, trimValues: true };
  const tree = new XMLParser(o).parse(text);
  return new XMLBuilder({ ...o, format: !min, indentBy: '  ', suppressEmptyNode: false }).build(tree).trim() + (min ? '' : '\n');
}

function describe(v) {
  if (Array.isArray(v)) return `elenco di ${v.length} element${v.length === 1 ? 'o' : 'i'}`;
  if (isObj(v)) { const n = Object.keys(v).length; return `oggetto con ${n} chiav${n === 1 ? 'e' : 'i'}`; }
  return v === null ? 'valore null' : `valore ${typeof v}`;
}
async function validate(file) {
  const kind = kindOf(file);
  try { const { value } = load(file); return { outputs: [], message: `✓ ${NAME[kind]} valido: ${describe(value)}` }; }
  catch (e) { if (e instanceof SyntaxProblem) return { outputs: [], message: `✗ ${e.message}`, invalid: true }; throw e; }
}

async function types(file) {
  const { value } = load(file);
  const name = pascal(baseOf(file)) || 'Dati';
  const ts = write(file, '', 'd.ts', typescript(value, name));
  const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: baseOf(file), ...schemaOf([value]) };
  const js = uniquePath(path.dirname(file), `${baseOf(file)}.schema`, 'json');
  fs.writeFileSync(js, JSON.stringify(schema, null, 2) + '\n', 'utf8');
  return { outputs: [ts, js], notes: ['Tipi ricavati dai dati presenti: un campo che manca in qualche elemento diventa facoltativo.'] };
}

module.exports = { convert, format, minify, validate, types, parse, serialize, typescript, schemaOf, toSql, table, tableName, kindOf };
