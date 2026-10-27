// Collaudo degli strumenti per programmatori: dati (JSON/YAML/TOML/XML/CSV/SQL), ZIP, Markdown/HTML -> PDF.
// Gira dentro Electron perché il PDF si stampa con Chromium. Uso: npx electron tools/test-dev.js
const { app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
app.disableHardwareAcceleration();
app.on('window-all-closed', (e) => e.preventDefault());

// ZIP minimo (senza compressione) con nomi a scelta, anche non validi
function rawZip(entries) {
  const zlib = require('zlib'), local = [], central = [];
  let off = 0;
  for (const [name, text] of entries) {
    const n = Buffer.from(name), data = Buffer.from(text), crc = zlib.crc32(data);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    local.push(h, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(entries.length, 8); e.writeUInt16LE(entries.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...local, cd, e]);
}

let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
const read = (f) => fs.readFileSync(f, 'utf8');

app.whenReady().then(async () => {
  const D = require('../src/data/ops'), archive = require('../src/archive'), web = require('../src/web-docs');
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-dev-'));
  const w = (n, t) => { const f = path.join(d, n); fs.writeFileSync(f, t); return f; };
  const data = { nome: 'Progetto àè', versione: 3, attivo: true, prezzo: 9.5, tag: ['a', 'b'], autore: { nome: 'Mario', email: 'mario@example.com' },
    utenti: [{ id: 1, nome: 'Anna', creato: '2026-01-05' }, { id: 2, nome: 'Luca', note: null, creato: '2026-02-10' }] };
  const json = w('dati.json', JSON.stringify(data, null, 2));

  console.log('--- dati: conversioni andata e ritorno');
  for (const t of ['yaml', 'toml', 'xml']) {
    const r = await D.convert(json, t);
    const back = D.parse(read(r.outputs[0]), t);
    const same = t === 'xml' ? back.root?.utenti?.[0]?.nome === 'Anna' || back.utenti?.[0]?.nome === 'Anna' || JSON.stringify(back).includes('Anna')
      : t === 'toml' ? back.utenti[1].note === undefined && back.utenti[0].nome === 'Anna' && back.nome === data.nome
      : JSON.stringify(back) === JSON.stringify(data);
    ok(`JSON -> ${t.toUpperCase()} e rilettura`, same, `${path.basename(r.outputs[0])}${r.notes.length ? ' | ' + r.notes.join(' ') : ''}`);
    const again = await D.convert(r.outputs[0], 'json');
    ok(`${t.toUpperCase()} -> JSON`, JSON.parse(read(again.outputs[0])).nome !== undefined || JSON.stringify(JSON.parse(read(again.outputs[0]))).includes('Progetto'));
  }
  let r = await D.convert(json, 'csv');
  const csv = read(r.outputs[0]).replace(/^﻿/, '');
  ok('JSON -> CSV (trova la tabella “utenti”)', csv.split('\r\n')[0] === 'id,nome,creato,note' && csv.includes('2,Luca,2026-02-10,'), `${csv.split('\r\n')[0]} | ${r.notes[0]}`);
  r = await D.convert(json, 'sql');
  const sql = read(r.outputs[0]);
  ok('JSON -> SQL', /CREATE TABLE "utenti"/.test(sql) && /"id" INTEGER/.test(sql) && /"creato" DATE/.test(sql) && /\(2, 'Luca', NULL, '2026-02-10'\)|\(2, 'Luca', '2026-02-10', NULL\)/.test(sql), sql.split('\n').slice(2, 7).join(' '));
  const xmlIn = w('conf.xml', '<?xml version="1.0"?>\n<config versione="2"><!-- commento --><server porta="8080">localhost</server><server porta="8443">example.org</server></config>');
  r = await D.convert(xmlIn, 'json');
  const xj = JSON.parse(read(r.outputs[0]));
  ok('XML con attributi -> JSON', xj.config['@_versione'] === '2' && xj.config.server.length === 2 && xj.config.server[1]['#text'] === 'example.org', JSON.stringify(xj).slice(0, 90));

  console.log('--- formatta, minifica, valida');
  const ugly = w('brutto.json', '{"a":1,"b":[1,2,{"c":"x"}]}');
  r = await D.format(ugly); ok('formatta JSON', read(r.outputs[0]).includes('\n  "b": [\n'));
  r = await D.minify(r.outputs[0]); ok('minifica JSON', read(r.outputs[0]) === '{"a":1,"b":[1,2,{"c":"x"}]}', r.notes[0]);
  const yml = w('ci.yml', '# commento importante\nname: test\non: [push]\njobs:\n    build:\n        runs-on: windows-latest\n');
  r = await D.format(yml); ok('formatta YAML mantenendo i commenti', read(r.outputs[0]).startsWith('# commento importante') && read(r.outputs[0]).includes('  build:\n    runs-on'));
  r = await D.format(xmlIn); const fx = read(r.outputs[0]);
  ok('formatta XML mantenendo ordine e commenti', /<!--\s*commento\s*-->/.test(fx) && fx.indexOf('8080') < fx.indexOf('8443') && fx.split('\n').length > 4, fx.split('\n').length + ' righe');
  r = await D.minify(xmlIn); ok('minifica XML', !read(r.outputs[0]).includes('\n'));
  r = await D.validate(json); ok('valida JSON corretto', /✓ JSON valido/.test(r.message), r.message);
  const bad = w('rotto.json', '{\n  "a": 1,\n  "b": [1, 2\n}');
  r = await D.validate(bad); ok('JSON sbagliato: riga e colonna', r.invalid && /riga 4/.test(r.message), r.message);
  r = await D.validate(w('rotto.yaml', 'a: 1\nb: [1, 2\nc: 3\n')); ok('YAML sbagliato: riga', r.invalid && /riga \d/.test(r.message), r.message);
  r = await D.validate(w('rotto.toml', 'a = 1\nb = [1, 2\n')); ok('TOML sbagliato: riga', r.invalid && /riga \d/.test(r.message), r.message);
  r = await D.validate(w('rotto.xml', '<a>\n  <b>\n</a>')); ok('XML sbagliato: riga', r.invalid && /riga \d/.test(r.message), r.message);
  try { await D.convert(bad, 'yaml'); ok('conversione di un file sbagliato: errore chiaro', false); } catch (e) { ok('conversione di un file sbagliato: errore chiaro', /riga 4/.test(e.message), e.message); }

  console.log('--- tipi TypeScript e JSON Schema');
  r = await D.types(json);
  const ts = read(r.outputs[0]), schema = JSON.parse(read(r.outputs[1]));
  ok('interfacce TypeScript', /export interface Dati \{/.test(ts) && /utenti: UtentiItem\[\];/.test(ts) && /note\?: null;/.test(ts) && /email: string;/.test(ts), ts.split('\n').filter((l) => l.startsWith('export')).join(' '));
  ok('JSON Schema', schema.$schema.includes('2020-12') && schema.properties.utenti.items.required.includes('id') && !schema.properties.utenti.items.required.includes('note') && schema.properties.autore.properties.email.format === 'email' && schema.properties.versione.type === 'integer');
  ok('i file .d.ts e .schema.json hanno i nomi giusti', path.basename(r.outputs[0]) === 'dati.d.ts' && path.basename(r.outputs[1]) === 'dati.schema.json');

  console.log('--- foglio di calcolo -> SQL');
  const sheet = require('../src/sheet/ops');
  const csvIn = w('clienti.csv', 'Nome;Città;Età;Iscritto\nAnna;Roma;34;2025-03-01\nO\'Brien;Milano;41;2024-11-20\n');
  r = await sheet.convert(csvIn, { target: 'sql' });
  const s2 = read(r.outputs[0]);
  ok('CSV -> SQL', /CREATE TABLE "clienti"/.test(s2) && /'O''Brien'/.test(s2) && /"Età" INTEGER/.test(s2), s2.split('\n').slice(2, 8).join(' '));

  console.log('--- ZIP');
  const src = path.join(d, 'progetto'); fs.mkdirSync(path.join(src, 'sotto', 'vuota'), { recursive: true });
  fs.writeFileSync(path.join(src, 'leggimi è.txt'), 'ciao'); fs.writeFileSync(path.join(src, 'sotto', 'dati.bin'), Buffer.alloc(300000, 7)); fs.writeFileSync(path.join(src, 'vuoto.txt'), '');
  r = await archive.zipPaths([src]);
  ok('cartella -> ZIP', path.basename(r.outputs[0]) === 'progetto.zip' && fs.statSync(r.outputs[0]).size < 5000, `${fs.statSync(r.outputs[0]).size} byte | ${r.notes[0]}`);
  const zipped = r.outputs[0];
  fs.renameSync(src, src + '-originale');
  r = await archive.extract(zipped);
  const x = r.outputs[0];
  ok('ZIP -> cartella (senza doppio livello)', path.basename(x) === 'progetto' && read(path.join(x, 'leggimi è.txt')) === 'ciao' && fs.statSync(path.join(x, 'sotto', 'dati.bin')).size === 300000 && fs.existsSync(path.join(x, 'sotto', 'vuota')) && fs.existsSync(path.join(x, 'vuoto.txt')), r.notes[0]);
  r = await archive.extract(zipped);
  ok('estrarre di nuovo non sovrascrive', path.basename(r.outputs[0]) === 'progetto (1)');
  const f1 = w('uno.txt', '1'), f2 = w('due.txt', '2');
  r = await archive.zipPaths([f1, f2, x]);
  ok('più file e cartelle -> Archivio.zip', path.basename(r.outputs[0]) === 'Archivio.zip');
  r = await archive.extract(r.outputs[0]);
  ok('...estratto in “Archivio”', path.basename(r.outputs[0]) === 'Archivio' && fs.existsSync(path.join(r.outputs[0], 'uno.txt')) && fs.existsSync(path.join(r.outputs[0], 'progetto', 'sotto', 'dati.bin')));
  // archivio malevolo: un nome che esce dalla cartella
  const evil = path.join(d, 'cattivo.zip');
  fs.writeFileSync(evil, rawZip([['ok.txt', 'x'], ['../fuori.txt', 'pwned']])); // scritto a mano: le librerie non creano nomi così
  if (fs.existsSync(evil)) {
    try { await archive.extract(evil); ok('ZIP con “../”: nulla esce dalla cartella', !fs.existsSync(path.join(d, 'fuori.txt')) && !fs.existsSync(path.join(path.dirname(d), 'fuori.txt'))); }
    catch (e) { ok('ZIP con “../”: estrazione rifiutata', !fs.existsSync(path.join(path.dirname(d), 'fuori.txt')), e.message); }
  } else console.log('SALTATO  ZIP malevolo (yazl non permette di crearlo)');
  try { await archive.extract(w('finto.zip', 'non sono uno zip')); ok('file .zip rovinato', false); } catch (e) { ok('file .zip rovinato: errore chiaro', /ZIP non leggibile/.test(e.message), e.message); }

  console.log('--- Markdown e HTML');
  fs.writeFileSync(path.join(d, 'logo.png'), await require('sharp')({ create: { width: 40, height: 40, channels: 3, background: '#e8502f' } }).png().toBuffer());
  const md = w('LEGGIMI.md', '---\ntitle: Guida\n---\n# Progetto\n\nTesto con **grassetto** e `codice`.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- [x] fatto\n- [ ] da fare\n\n```js\nconsole.log(1)\n```\n\n![logo](logo.png)\n\n![remota](https://example.com/x.png)\n');
  r = await web.convert(md, 'html');
  const html = read(r.outputs[0]);
  ok('Markdown -> HTML', /<title>Guida<\/title>/.test(html) && /<table>/.test(html) && /type="checkbox"/.test(html) && /<pre><code class="language-js">/.test(html) && !/^---/m.test(html.split('<body>')[1]));
  r = await web.convert(md, 'pdf');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(r.outputs[0])), verbosity: 0 }).promise;
  let txt = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  const ops = await (await doc.getPage(1)).getOperatorList();
  ok('Markdown -> PDF (testo, tabella, immagine locale)', /Progetto/.test(txt) && /grassetto/.test(txt) && ops.fnArray.includes(pdfjs.OPS.paintImageXObject), txt.slice(0, 60));
  const htmlFile = w('pagina.html', '<!doctype html><html><head><title>T</title><style>h1{color:#c00}</style></head><body><h1>Pagina HTML</h1><img src="logo.png"><script>document.body.innerHTML="JS eseguito"</script></body></html>');
  r = await web.convert(htmlFile, 'pdf');
  doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(r.outputs[0])), verbosity: 0 }).promise;
  txt = (await (await doc.getPage(1)).getTextContent()).items.map((i) => i.str).join(' ');
  ok('HTML -> PDF (senza eseguire JavaScript)', /Pagina HTML/.test(txt) && !/JS eseguito/.test(txt), txt);

  console.log(fail ? `\n${fail} prove FALLITE` : '\nTutte le prove superate');
  fs.rmSync(d, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
