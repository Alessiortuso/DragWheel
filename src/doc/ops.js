// Operazioni sui documenti DOCX. Ogni funzione crea file nuovi accanto all'originale (che non viene mai toccato)
// e restituisce { outputs: [percorsi], notes: [frasi da mostrare] }.
const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const mammoth = require('mammoth');
const sharp = require('sharp');
const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { uniquePath } = require('../converter');
const word = require('./word');

const baseOf = (f) => path.basename(f, path.extname(f));
const dirOf = (f) => path.dirname(f);
const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function openZip(file) {
  try { return await JSZip.loadAsync(fs.readFileSync(file)); }
  catch { throw new Error('il file non è un documento DOCX valido (o è protetto da password)'); }
}
const saveZip = async (zip, out) => fs.writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } }));
const textOf = async (zip, name) => (zip.file(name) ? zip.file(name).async('string') : null);
const mediaNames = (zip) => Object.keys(zip.files).filter((n) => /^word\/media\/[^/]+$/.test(n) && !zip.files[n].dir);
// Parti con testo del documento (corpo, intestazioni, piè di pagina, note)
const textParts = (zip) => Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/.test(n));
const tagValue = (xml, tag) => { const m = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`).exec(xml || ''); return m ? m[1].trim() : ''; };
const countOf = (xml, re) => (xml ? (xml.match(re) || []).length : 0);

// ---------- informazioni ----------
async function inspect(file) {
  const zip = await openZip(file), stat = fs.statSync(file);
  const raw = (await mammoth.extractRawText({ path: file })).value;
  const media = mediaNames(zip);
  let mediaBytes = 0;
  for (const n of media) mediaBytes += (await zip.file(n).async('nodebuffer')).length;
  const body = await textOf(zip, 'word/document.xml'), comments = await textOf(zip, 'word/comments.xml'), core = await textOf(zip, 'docProps/core.xml');
  return {
    size: stat.size, words: (raw.match(/\S+/g) || []).length, chars: raw.length,
    images: media.length, imageBytes: mediaBytes,
    comments: countOf(comments, /<w:comment\b/g), revisions: countOf(body, /<w:(ins|del|moveFrom|moveTo)\b(?![^>]*\/>)/g),
    author: tagValue(core, 'dc:creator'), lastModifiedBy: tagValue(core, 'cp:lastModifiedBy'),
    preview: raw.slice(0, 2500).trim(),
  };
}

// ---------- converti ----------
const PAGE_CSS = 'body{font:11pt Calibri,Segoe UI,Arial,sans-serif;line-height:1.4;max-width:820px;margin:32px auto;padding:0 24px;color:#222}h1,h2,h3{line-height:1.2}table{border-collapse:collapse;margin:10px 0}td,th{border:1px solid #999;padding:4px 8px;vertical-align:top}img{max-width:100%;height:auto}';
const htmlPage = (title, body) => `<!doctype html>\n<meta charset="utf-8">\n<title>${esc(title)}</title>\n<style>${PAGE_CSS}</style>\n${body}\n`;
const inlineImage = mammoth.images.imgElement((img) => img.read('base64').then((b) => ({ src: `data:${img.contentType};base64,${b}` })));

// PDF senza Word: il documento diventa una pagina web (testo, titoli, elenchi, tabelle, immagini) stampata da Chromium
async function pdfWithoutWord(file, out) {
  const { BrowserWindow } = require('electron');
  const html = htmlPage(baseOf(file), (await mammoth.convertToHtml({ path: file }, { convertImage: inlineImage })).value);
  const tmp = path.join(require('os').tmpdir(), `dw-doc-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try { await win.loadFile(tmp); fs.writeFileSync(out, await win.webContents.printToPDF({ pageSize: 'A4', margins: { marginType: 'default' }, printBackground: true })); }
  finally { win.destroy(); fs.rmSync(tmp, { force: true }); }
}

async function extractImages(file, zip) {
  const names = mediaNames(zip);
  if (!names.length) throw new Error('il documento non contiene immagini');
  let dir = path.join(dirOf(file), `${baseOf(file)} - immagini`);
  for (let i = 1; fs.existsSync(dir); i++) dir = path.join(dirOf(file), `${baseOf(file)} - immagini (${i})`);
  fs.mkdirSync(dir);
  for (const n of names) fs.writeFileSync(path.join(dir, path.basename(n)), await zip.file(n).async('nodebuffer'));
  return { outputs: [dir], notes: [`${names.length} ${names.length === 1 ? 'immagine estratta' : 'immagini estratte'} nella loro qualità originale.`] };
}

async function convert(file, o = {}) {
  const t = o.target, dir = dirOf(file), base = baseOf(file), notes = [];
  if (t === 'images') return extractImages(file, await openZip(file));
  await openZip(file); // controllo che sia un DOCX leggibile
  if (t === 'txt') { const out = uniquePath(dir, base, 'txt'); fs.writeFileSync(out, (await mammoth.extractRawText({ path: file })).value, 'utf8'); return { outputs: [out], notes }; }
  if (t === 'html') {
    const r = await mammoth.convertToHtml({ path: file }, { convertImage: inlineImage });
    const out = uniquePath(dir, base, 'html'); fs.writeFileSync(out, htmlPage(base, r.value), 'utf8');
    return { outputs: [out], notes };
  }
  if (t === 'md') {
    const images = []; let n = 0;
    const r = await mammoth.convertToMarkdown({ path: file }, { convertImage: mammoth.images.imgElement((img) => img.read().then((buf) => { n++; const ext = (img.contentType.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, ''); images.push([`immagine${n}.${ext}`, buf]); return { src: `DWIMG${n}X` }; })) });
    const out = uniquePath(dir, base, 'md');
    // mammoth protegge i caratteri speciali nei collegamenti: si scrive un segnaposto e lo si sostituisce dopo
    const folder = encodeURIComponent(`${path.basename(out, '.md')}-immagini`);
    fs.writeFileSync(out, r.value.replace(/DWIMG(\d+)X/g, (_, i) => `${folder}/${images[i - 1][0]}`), 'utf8');
    const outputs = [out];
    if (images.length) { const d = path.join(dir, `${path.basename(out, '.md')}-immagini`); fs.mkdirSync(d, { recursive: true }); images.forEach(([nm, buf]) => fs.writeFileSync(path.join(d, nm), buf)); notes.push(`${images.length} immagini salvate nella cartella “${path.basename(d)}”.`); }
    return { outputs, notes };
  }
  if (t === 'pdf') {
    const out = uniquePath(dir, base, 'pdf');
    if (word.isAvailable() && o.useWord !== false) { await word.run('pdf', { input: file, output: out }); notes.push('PDF creato da Microsoft Word: impaginazione identica a quella del documento.'); }
    else { await pdfWithoutWord(file, out); notes.push('Word non è disponibile: PDF creato dal contenuto del documento, l’impaginazione può differire dall’originale.'); }
    return { outputs: [out], notes };
  }
  throw new Error(`formato di uscita sconosciuto: ${t}`);
}

// ---------- comprimi (immagini) ----------
const PRESETS = { high: { dim: 2400, quality: 85 }, balanced: { dim: 1600, quality: 75 }, small: { dim: 1100, quality: 60 } };
async function compress(file, o = {}) {
  const zip = await openZip(file), p = PRESETS[o.level] || PRESETS.balanced, before = fs.statSync(file).size;
  let imgBefore = 0, imgAfter = 0, changed = 0;
  for (const n of mediaNames(zip)) {
    const ext = path.extname(n).slice(1).toLowerCase();
    if (!['jpg', 'jpeg', 'png'].includes(ext)) continue; // EMF, WMF, SVG, GIF: lasciati come sono
    const buf = await zip.file(n).async('nodebuffer');
    imgBefore += buf.length;
    let out = buf;
    try {
      const s = sharp(buf).resize({ width: p.dim, height: p.dim, fit: 'inside', withoutEnlargement: true });
      out = ext === 'png' ? await s.png({ compressionLevel: 9, palette: o.level !== 'high', quality: p.quality }).toBuffer() : await s.jpeg({ quality: p.quality, mozjpeg: true }).toBuffer();
    } catch { out = buf; }
    if (out.length < buf.length) { zip.file(n, out); changed++; imgAfter += out.length; } else imgAfter += buf.length; // se non migliora, resta l'originale
  }
  if (zip.file('docProps/thumbnail.jpeg')) zip.remove('docProps/thumbnail.jpeg');
  const out = uniquePath(dirOf(file), `${baseOf(file)} (compresso)`, 'docx');
  await saveZip(zip, out);
  const after = fs.statSync(out).size, mb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
  const notes = [changed ? `Immagini: ${mb(imgBefore)} → ${mb(imgAfter)} (${changed} ${changed === 1 ? 'ridotta' : 'ridotte'}). Il documento passa da ${mb(before)} a ${mb(after)}.` : 'Nessuna immagine da ridurre: il documento era già leggero.'];
  return { outputs: [out], notes, before, after };
}

// ---------- pulisci (prima di inviare) ----------
const rel = (xml, re) => (xml.match(re) || []).length;
function acceptChanges(xml, stat) {
  const c = (re) => { const n = rel(xml, re); stat.revisions += n; };
  c(/<w:(?:ins|del|moveFrom|moveTo)\b(?![^>]*\/>)[^>]*>/g);
  xml = xml.replace(/<w:(del|moveFrom)\b(?![^>]*\/>)[^>]*>[\s\S]*?<\/w:\1>/g, '');            // contenuto cancellato: sparisce
  xml = xml.replace(/<w:(?:ins|moveTo)\b(?![^>]*\/>)[^>]*>|<\/w:(?:ins|moveTo)>/g, '');        // contenuto aggiunto: resta, senza il segno di revisione
  xml = xml.replace(/<w:(?:ins|del|moveFrom|moveTo)\b[^>]*\/>/g, '');                           // segni di revisione sul fine paragrafo
  xml = xml.replace(/<w:(?:moveFromRange|moveToRange)(?:Start|End)\b[^>]*\/>/g, '');
  xml = xml.replace(/<w:(rPr|pPr|sectPr|tblPr|tblGrid|trPr|tcPr|numPr)Change\b[\s\S]*?<\/w:\1Change>/g, ''); // cronologia delle formattazioni
  return xml;
}
function removeComments(xml, stat) {
  stat.comments += rel(xml, /<w:commentReference\b/g);
  xml = xml.replace(/<w:commentRange(?:Start|End)\b[^>]*\/>/g, '');
  return xml.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:commentReference\b[^>]*\/>(?:(?!<\/w:r>)[\s\S])*?<\/w:r>/g, '');
}
async function clean(file, o = {}) {
  const zip = await openZip(file), stat = { revisions: 0, comments: 0, props: 0 };
  if (o.comments) {
    const names = Object.keys(zip.files).filter((n) => /^word\/comments(Extended|Ids|Extensible)?\.xml$/.test(n));
    const body = await textOf(zip, 'word/document.xml');
    if (names.length || /commentReference/.test(body || '')) {
      for (const n of textParts(zip)) { const x = await textOf(zip, n); const y = removeComments(x, stat); if (y !== x) zip.file(n, y); }
      for (const n of names) zip.remove(n);
      let ct = await textOf(zip, '[Content_Types].xml'), rels = await textOf(zip, 'word/_rels/document.xml.rels');
      ct = ct.replace(/<Override\b[^>]*PartName="\/word\/comments(?:Extended|Ids|Extensible)?\.xml"[^>]*\/>/g, '');
      rels = rels.replace(/<Relationship\b[^>]*Target="comments(?:Extended|Ids|Extensible)?\.xml"[^>]*\/>/g, '');
      zip.file('[Content_Types].xml', ct); zip.file('word/_rels/document.xml.rels', rels);
    }
  }
  if (o.changes) for (const n of textParts(zip)) { const x = await textOf(zip, n), y = acceptChanges(x, stat); if (y !== x) zip.file(n, y); }
  if (o.privacy) {
    let core = await textOf(zip, 'docProps/core.xml'), app = await textOf(zip, 'docProps/app.xml');
    if (core) { const t = core; core = core.replace(/<(dc:creator|cp:lastModifiedBy)>[^<]*<\/\1>/g, '<$1></$1>'); if (core !== t) stat.props++; zip.file('docProps/core.xml', core); }
    if (app) { const t = app; app = app.replace(/<(Company|Manager)>[^<]*<\/\1>/g, '<$1></$1>'); if (app !== t) stat.props++; zip.file('docProps/app.xml', app); }
    if (zip.file('docProps/thumbnail.jpeg')) { zip.remove('docProps/thumbnail.jpeg'); stat.props++; }
  }
  const out = uniquePath(dirOf(file), `${baseOf(file)} (pulito)`, 'docx');
  await saveZip(zip, out);
  const parts = [];
  if (stat.comments) parts.push(`${stat.comments} ${stat.comments === 1 ? 'commento eliminato' : 'commenti eliminati'}`);
  if (stat.revisions) parts.push(`${stat.revisions} ${stat.revisions === 1 ? 'modifica registrata accettata' : 'modifiche registrate accettate'}`);
  if (stat.props) parts.push('autore, società e altre informazioni personali tolti');
  return { outputs: [out], notes: [parts.length ? parts.join(' · ') : 'Nessuna modifica necessaria: il documento era già pulito.'], stat };
}

// ---------- sostituisci ----------
// Il testo di un paragrafo è spezzato in "pezzi" (w:t) con formattazioni diverse: si cerca sul testo intero e la sostituzione
// va nel pezzo dove inizia la corrispondenza, così resta la sua formattazione.
const paragraphOf = (node) => { for (let n = node.parentNode; n; n = n.parentNode) if (n.nodeName === 'w:p') return n; return null; };
function replaceInXml(xml, pairs, matchCase) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml'), counts = pairs.map(() => 0);
  const all = Array.from(doc.getElementsByTagName('w:t')), byP = new Map();
  for (const t of all) { const p = paragraphOf(t); if (p) { if (!byP.has(p)) byP.set(p, []); byP.get(p).push(t); } }
  for (const [, nodes] of byP) {
    const texts = nodes.map((t) => t.textContent);
    pairs.forEach((pr, pi) => {
      if (!pr.find) return;
      const hay = () => (matchCase ? texts.join('') : texts.join('').toLowerCase()), needle = matchCase ? pr.find : pr.find.toLowerCase();
      const found = []; let full = hay(), from = 0, at;
      while ((at = full.indexOf(needle, from)) >= 0) { found.push(at); from = at + needle.length; }
      for (const start of found.reverse()) { // dall'ultima alla prima: le posizioni precedenti non cambiano
        const end = start + needle.length; let off = 0, placed = false;
        for (let i = 0; i < texts.length; i++) {
          const s = off, e = off + texts[i].length; off = e;
          if (e <= start || s >= end) continue;
          const a = Math.max(start, s) - s, b = Math.min(end, e) - s;
          texts[i] = texts[i].slice(0, a) + (placed ? '' : pr.replace) + texts[i].slice(b); placed = true;
        }
        counts[pi]++;
      }
    });
    nodes.forEach((t, i) => { if (t.textContent !== texts[i]) { t.textContent = texts[i]; if (/^\s|\s$/.test(texts[i])) t.setAttribute('xml:space', 'preserve'); } });
  }
  return { xml: XML_DECL + new XMLSerializer().serializeToString(doc).replace(/^<\?xml[^>]*\?>\s*/, ''), counts };
}
async function replace(file, o = {}) {
  const pairs = (o.pairs || []).filter((p) => p && String(p.find || '').length);
  if (!pairs.length) throw new Error('scrivi almeno un testo da cercare');
  const zip = await openZip(file), counts = pairs.map(() => 0);
  for (const n of textParts(zip)) {
    const x = await textOf(zip, n);
    if (!x.includes('<w:t')) continue;
    const r = replaceInXml(x, pairs.map((p) => ({ find: p.find, replace: p.replace || '' })), !!o.matchCase);
    if (r.counts.some(Boolean)) { zip.file(n, r.xml); r.counts.forEach((c, i) => { counts[i] += c; }); }
  }
  const total = counts.reduce((a, b) => a + b, 0);
  if (!total) return { outputs: [], notes: ['Nessuna corrispondenza trovata: non è stato creato alcun file.'], counts, none: true };
  const out = uniquePath(dirOf(file), `${baseOf(file)} (sostituito)`, 'docx');
  await saveZip(zip, out);
  return { outputs: [out], notes: [pairs.map((p, i) => `“${p.find}” → “${p.replace || ''}”: ${counts[i]}`).join(' · ')], counts };
}

// ---------- unisci (con Word) ----------
async function merge(files, o = {}) {
  if (!files.length) throw new Error('aggiungi almeno un file');
  if (!word.isAvailable()) throw new Error('unire i documenti richiede Microsoft Word, che non è installato');
  for (const f of files) await openZip(f);
  const out = uniquePath(dirOf(files[0]), `${baseOf(files[0])} (unione)`, 'docx');
  await word.run('merge', { files, output: out, pageBreak: o.pageBreak !== false });
  return { outputs: [out], notes: [`${files.length} documenti uniti con Microsoft Word${o.pageBreak !== false ? ', ciascuno su una nuova pagina' : ''}.`] };
}

module.exports = { inspect, convert, compress, clean, replace, merge, wordAvailable: word.isAvailable };
