// Collaudo delle operazioni sui DOCX con documenti generati qui; Word (se c'è) serve anche a verificare che i file prodotti si aprano.
// Uso: node tools/test-doc.js
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const D = require('docx');
const ops = require('../src/doc/ops');
const word = require('../src/doc/word');
const mammoth = require('mammoth');
const { makeDoc } = require('./doc-fixture');

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-doc-'));
let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
const kb = (f) => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
const text = async (f) => (await mammoth.extractRawText({ path: f })).value;
const pages = async (pdf) => (await PDFDocument.load(fs.readFileSync(pdf))).getPageCount();


(async () => {
  const hasWord = word.isAvailable();
  console.log('Word disponibile:', hasWord);
  const f1 = await makeDoc(d, 'contratto.docx'), f2 = await makeDoc(d, 'allegato.docx', { title: 'Allegato', big: false });

  console.log('--- informazioni');
  const I = await ops.inspect(f1);
  ok('parole, immagini, commenti, revisioni, autore', I.words > 20 && I.images === 1 && I.comments === 1 && I.revisions === 2 && I.author === 'Mario Rossi' && I.preview.startsWith('Contratto'),
    `${I.words} parole, ${I.images} immagine (${(I.imageBytes / 1024).toFixed(0)} KB), ${I.comments} commento, ${I.revisions} revisioni, autore ${I.author}`);

  console.log('--- converti');
  let r = await ops.convert(f1, { target: 'txt' }); const t = fs.readFileSync(r.outputs[0], 'utf8');
  ok('DOCX -> TXT', /Contratto/.test(t) && /Gentile Cliente/.test(t) && /Primo punto/.test(t));
  r = await ops.convert(f1, { target: 'html' }); const h = fs.readFileSync(r.outputs[0], 'utf8');
  ok('DOCX -> HTML (titoli, elenco, tabella, immagine inclusa)', /<h1>/.test(h) && /<ul>/.test(h) && /<table>/.test(h) && /data:image\/jpeg;base64/.test(h), kb(r.outputs[0]));
  r = await ops.convert(f1, { target: 'md' }); const md = fs.readFileSync(r.outputs[0], 'utf8');
  ok('DOCX -> Markdown (titolo, immagine in cartella)', /^# Contratto/m.test(md) || /Contratto/.test(md), `${path.basename(r.outputs[0])} + ${r.outputs.length - 1} cartella; ${r.notes[0] || ''}`);
  ok('...l’immagine è salvata accanto e il file la richiama', fs.existsSync(path.join(d, 'contratto-immagini')) && /contratto-immagini\/immagine1\.jpg/.test(md), (md.match(/!\[[^\]]*\]\([^)]*\)/) || ['nessun collegamento'])[0].slice(0, 80));
  r = await ops.convert(f1, { target: 'images' }); ok('estrai le immagini', fs.readdirSync(r.outputs[0]).length === 1 && fs.statSync(path.join(r.outputs[0], fs.readdirSync(r.outputs[0])[0])).size > 100000, r.notes[0]);
  try { await ops.convert(f2.replace('allegato', 'nonesiste'), { target: 'txt' }); ok('file inesistente', false); } catch (e) { ok('file inesistente', true, e.message.slice(0, 60)); }
  const fake = path.join(d, 'finto.docx'); fs.writeFileSync(fake, 'non sono uno zip');
  try { await ops.convert(fake, { target: 'txt' }); ok('file non valido', false); } catch (e) { ok('file non valido', true, e.message); }
  if (hasWord) {
    r = await ops.convert(f1, { target: 'pdf' }); ok('DOCX -> PDF con Word', (await pages(r.outputs[0])) >= 1 && /Word/.test(r.notes[0]), `${await pages(r.outputs[0])} pagine, ${kb(r.outputs[0])}`);
  }

  console.log('--- comprimi');
  const c = await ops.compress(f1, { level: 'balanced' });
  ok('immagini ridotte, documento più leggero', c.after < c.before * 0.5 && (await ops.inspect(c.outputs[0])).images === 1, `${kb(f1)} -> ${kb(c.outputs[0])}; ${c.notes[0]}`);
  ok('il testo resta uguale', (await text(c.outputs[0])) === (await text(f1)));
  const c2 = await ops.compress(f1, { level: 'small' }); ok('massima compressione ancora più leggera', c2.after < c.after, `${kb(c.outputs[0])} -> ${kb(c2.outputs[0])}`);
  const c3 = await ops.compress(f2, { level: 'balanced' }); ok('documento piccolo: riepilogo in KB', /KB/.test(c3.notes[0]), c3.notes[0]);

  console.log('--- pulisci');
  const cl = await ops.clean(f1, { comments: true, changes: true, privacy: true });
  const cx = await ops.inspect(cl.outputs[0]), ct = await text(cl.outputs[0]);
  ok('commenti, revisioni e autore tolti', cx.comments === 0 && cx.revisions === 0 && !cx.author && !cx.lastModifiedBy, `commenti ${cx.comments}, revisioni ${cx.revisions}, autore ${JSON.stringify(cx.author)}`);
  ok('modifiche accettate: il testo cancellato sparisce, quello aggiunto resta', /Prezzo nuovo concordato/.test(ct) && !/vecchio/.test(ct), JSON.stringify(ct.split('\n').find((l) => /Prezzo/.test(l))));
  ok('il resto del documento è intatto', /Scadenza: 31 dicembre/.test(ct) && /Totale/.test(ct) && cx.images === 1);
  ok('riepilogo', /1 commento eliminato/.test(cl.notes[0]) && /2 modifiche/.test(cl.notes[0]), cl.notes[0]);
  const cl2 = await ops.clean(f1, { privacy: true }); ok('solo privacy: commenti e revisioni restano', (await ops.inspect(cl2.outputs[0])).comments === 1 && (await ops.inspect(cl2.outputs[0])).revisions === 2);
  const cl3 = await ops.clean(cl.outputs[0], { comments: true, changes: true, privacy: true }); ok('già pulito: lo dice', /Nessuna modifica/.test(cl3.notes[0]), cl3.notes[0]);

  console.log('--- sostituisci');
  const rp = await ops.replace(f1, { pairs: [{ find: 'cliente', replace: 'Fornitore' }, { find: '30%', replace: '40%' }], matchCase: false });
  const rt = await text(rp.outputs[0]);
  ok('trova anche il testo spezzato su più parti di formattazione e nell’intestazione', /Gentile Fornitore/.test(rt) && /Il Fornitore paga il 40%/.test(rt) && rp.counts[0] === 3 && rp.counts[1] === 1, `conteggi ${rp.counts.join(',')}: ${JSON.stringify(rt.split('\n')[1])}`);
  ok('...e l’intestazione', (await (async () => { const JSZip = require('jszip'); const z = await JSZip.loadAsync(fs.readFileSync(rp.outputs[0])); const hd = Object.keys(z.files).find((n) => /word\/header\d*\.xml/.test(n)); return hd ? (await z.file(hd).async('string')).includes('Intestazione Fornitore') : false; })()));
  const rp2 = await ops.replace(f1, { pairs: [{ find: 'cliente', replace: 'X' }], matchCase: true }); ok('rispetta maiuscole e minuscole', rp2.counts[0] === 1 && /Il X paga/.test(await text(rp2.outputs[0])), `conteggio ${rp2.counts[0]}`);
  const rp3 = await ops.replace(f1, { pairs: [{ find: 'inesistente', replace: 'x' }] }); ok('nessuna corrispondenza: nessun file', rp3.none && !rp3.outputs.length, rp3.notes[0]);
  const rp4 = await ops.replace(f1, { pairs: [{ find: 'Primo', replace: '' }] }); ok('sostituire con niente cancella il testo', /^ punto$|^\spunto/m.test(await text(rp4.outputs[0])) || !/Primo/.test(await text(rp4.outputs[0])));
  const rp5 = await ops.replace(f1, { pairs: [{ find: '&', replace: '<e>' }, { find: 'Totale', replace: 'A&B' }] }); ok('caratteri speciali (& < >) gestiti', /A&B/.test(await text(rp5.outputs[0])));
  try { await ops.replace(f1, { pairs: [{ find: '' }] }); ok('errore senza testo da cercare', false); } catch (e) { ok('errore senza testo da cercare', true, e.message); }

  if (hasWord) {
    console.log('--- verifica con Word: i file prodotti si aprono');
    for (const [label, f] of [['compresso', c.outputs[0]], ['pulito', cl.outputs[0]], ['sostituito', rp.outputs[0]]]) {
      const out = path.join(d, `verifica-${label}.pdf`);
      try { await word.run('pdf', { input: f, output: out }); ok(`Word apre il documento ${label}`, (await pages(out)) >= 1, `${await pages(out)} pagine`); }
      catch (e) { ok(`Word apre il documento ${label}`, false, e.message); }
    }
    console.log('--- unisci');
    const m = await ops.merge([f1, f2], { pageBreak: true }); const mt = await text(m.outputs[0]);
    ok('due documenti uniti da Word', /Contratto/.test(mt) && /Allegato/.test(mt) && mt.indexOf('Contratto') < mt.indexOf('Allegato'), `${kb(m.outputs[0])}; ${m.notes[0]}`);
    const mp = path.join(d, 'unione.pdf'); await word.run('pdf', { input: m.outputs[0], output: mp });
    ok('...ciascuno su una nuova pagina', (await pages(mp)) >= 2, `${await pages(mp)} pagine`);
    const m2 = await ops.merge([f2, f1, f2], { pageBreak: false }); ok('tre documenti, senza interruzione di pagina, nell’ordine dato', (await text(m2.outputs[0])).indexOf('Allegato') < (await text(m2.outputs[0])).indexOf('Contratto'));
  }

  console.log(fail ? `\n${fail} FALLITI` : '\nTUTTO OK');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERRORE', e); process.exit(1); });
