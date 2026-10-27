// Aggiornamento incrementale: aggiunge in coda al PDF originale solo gli oggetti nuovi o modificati, con una nuova
// tabella dei riferimenti. I byte già presenti non cambiano, quindi le firme digitali precedenti restano valide.
const crypto = require('crypto');

const latin1 = (s) => Buffer.from(s, 'latin1');

// Posizione dell'ultima tabella dei riferimenti (startxref in fondo al file)
function lastStartxref(buf) {
  const tail = buf.subarray(Math.max(0, buf.length - 2048)).toString('latin1');
  const m = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail) || [...tail.matchAll(/startxref\s+(\d+)/g)].pop();
  if (!m) throw new Error('il PDF è danneggiato (manca startxref)');
  return Number(m[1]);
}

// I numeri degli oggetti già usati nel file (anche dai flussi di oggetti e di riferimenti, che pdf-lib non tiene
// in memoria) non vanno riassegnati: si riservano prima di aggiungere oggetti nuovi
function reserveNumbers(original, ctx) {
  const s = original.toString('latin1');
  let max = ctx.largestObjectNumber;
  for (const m of s.matchAll(/\/Size\s+(\d+)/g)) max = Math.max(max, Number(m[1]) - 1);
  for (const m of s.matchAll(/(?:^|\s)(\d+)\s+\d+\s+obj\b/g)) max = Math.max(max, Number(m[1]));
  ctx.largestObjectNumber = max;
  return max;
}

function serialize(obj) {
  const out = new Uint8Array(obj.sizeInBytes());
  obj.copyBytesInto(out, 0);
  return Buffer.from(out);
}

// original: Buffer del PDF; doc: PDFDocument caricato da quei byte e poi modificato;
// include(ref): true per gli oggetti da riscrivere (quelli nuovi si riconoscono dal numero > maxOriginale)
function appendUpdate(original, doc, include) {
  const ctx = doc.context;
  const prev = lastStartxref(original);
  const asStream = !original.subarray(prev, prev + 4).toString('latin1').startsWith('xref');
  const parts = [original];
  let offset = original.length;
  const push = (b) => { parts.push(b); offset += b.length; };
  if (original[original.length - 1] !== 0x0a) push(latin1('\n'));

  const entries = [];
  const objects = ctx.enumerateIndirectObjects().filter(([ref]) => include(ref)).sort((a, b) => a[0].objectNumber - b[0].objectNumber);
  for (const [ref, obj] of objects) {
    entries.push({ n: ref.objectNumber, gen: ref.generationNumber, offset });
    push(latin1(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    push(serialize(obj));
    push(latin1('\nendobj\n'));
  }

  const t = ctx.trailerInfo;
  const id0 = t.ID && t.ID.get && t.ID.get(0) ? t.ID.get(0).toString() : `<${crypto.randomBytes(16).toString('hex')}>`;
  const ids = `[${id0} <${crypto.randomBytes(16).toString('hex')}>]`;
  const common = `/Root ${t.Root}${t.Info ? ` /Info ${t.Info}` : ''} /ID ${ids} /Prev ${prev}`;
  const xrefAt = offset;

  if (!asStream) {
    let s = 'xref\n';
    for (let i = 0; i < entries.length;) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].n === entries[j].n + 1) j++;
      s += `${entries[i].n} ${j - i + 1}\n`;
      for (let k = i; k <= j; k++) s += `${String(entries[k].offset).padStart(10, '0')} ${String(entries[k].gen).padStart(5, '0')} n\r\n`;
      i = j + 1;
    }
    s += `trailer\n<< /Size ${ctx.largestObjectNumber + 1} ${common} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
    push(latin1(s));
  } else {
    // il file usa flussi di riferimenti (PDF 1.5+): l'aggiornamento ne usa uno anch'esso, non compresso
    const self = ctx.largestObjectNumber + 1;
    entries.push({ n: self, gen: 0, offset: xrefAt });
    const index = [], rows = [];
    for (let i = 0; i < entries.length;) {
      let j = i;
      while (j + 1 < entries.length && entries[j + 1].n === entries[j].n + 1) j++;
      index.push(entries[i].n, j - i + 1);
      i = j + 1;
    }
    for (const e of entries) { const r = Buffer.alloc(7); r[0] = 1; r.writeUInt32BE(e.offset, 1); r.writeUInt16BE(e.gen, 5); rows.push(r); }
    const data = Buffer.concat(rows);
    push(latin1(`${self} 0 obj\n<< /Type /XRef /Size ${self + 1} /W [1 4 2] /Index [${index.join(' ')}] ${common} /Length ${data.length} >>\nstream\n`));
    push(data);
    push(latin1(`\nendstream\nendobj\nstartxref\n${xrefAt}\n%%EOF\n`));
  }
  return Buffer.concat(parts);
}

module.exports = { appendUpdate, lastStartxref, reserveNumbers };
