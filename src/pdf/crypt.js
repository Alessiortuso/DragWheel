// Protezione con password: cifratura AES-256 standard del PDF 2.0 (filtro Standard, V5 R6), letta da Acrobat,
// dai browser e dai lettori recenti. Le funzioni seguono ISO 32000-2, §7.6.4.
const crypto = require('crypto');
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFString, PDFHexString, PDFRawStream, PDFStream } = require('pdf-lib');

// Permessi (tabella 22): bit 3 stampa, 4 modifica, 5 copia, 6 commenti, 9 moduli, 10 accessibilità, 11 assemblaggio, 12 stampa di qualità
const PERM = { print: (1 << 2) | (1 << 11), modify: (1 << 3) | (1 << 10), copy: 1 << 4, annotate: (1 << 5) | (1 << 8) };
const BASE_P = 0xfffff0c0 | (1 << 9); // bit riservati a 1 + accessibilità (sempre consentita)

const aesNoPad = (algo, key, iv, data) => { const c = iv ? crypto.createCipheriv(algo, key, iv) : crypto.createCipheriv(algo, key, null); c.setAutoPadding(false); return Buffer.concat([c.update(data), c.final()]); };

// Algoritmo 2.B: hash della password
function hash2B(pwd, salt, udata = Buffer.alloc(0)) {
  let k = crypto.createHash('sha256').update(Buffer.concat([pwd, salt, udata])).digest();
  let e = Buffer.alloc(0);
  for (let i = 0; i < 64 || e[e.length - 1] > i - 32; i++) {
    const k1 = Buffer.concat(Array(64).fill(Buffer.concat([pwd, k, udata])));
    e = aesNoPad('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32), k1);
    let mod = 0;
    for (let z = 0; z < 16; z++) mod += e[z];
    k = crypto.createHash(['sha256', 'sha384', 'sha512'][mod % 3]).update(e).digest();
  }
  return k.subarray(0, 32);
}

const pwdBytes = (s) => Buffer.from(String(s || '').normalize('NFKC'), 'utf8').subarray(0, 127);

function encryptDict(fileKey, userPwd, ownerPwd, perms) {
  const up = pwdBytes(userPwd), op = pwdBytes(ownerPwd);
  const uVal = crypto.randomBytes(8), uKey = crypto.randomBytes(8);
  const U = Buffer.concat([hash2B(up, uVal), uVal, uKey]);
  const UE = aesNoPad('aes-256-cbc', hash2B(up, uKey), Buffer.alloc(16), fileKey);
  const oVal = crypto.randomBytes(8), oKey = crypto.randomBytes(8);
  const O = Buffer.concat([hash2B(op, oVal, U), oVal, oKey]);
  const OE = aesNoPad('aes-256-cbc', hash2B(op, oKey, U), Buffer.alloc(16), fileKey);
  let P = BASE_P;
  for (const [k, bits] of Object.entries(PERM)) if (perms[k]) P |= bits;
  P |= 0; // intero con segno a 32 bit
  const pb = Buffer.alloc(16);
  pb.writeInt32LE(P, 0); pb.writeUInt32LE(0xffffffff, 4); pb.write('Tadb', 8, 'latin1'); crypto.randomBytes(4).copy(pb, 12);
  const Perms = aesNoPad('aes-256-ecb', fileKey, null, pb);
  return { U, UE, O, OE, P, Perms };
}

const encryptBytes = (key, data) => {
  const iv = crypto.randomBytes(16), c = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([iv, c.update(Buffer.from(data)), c.final()]);
};

// bytes: PDF non cifrato; opts: { userPassword, ownerPassword, perms: { print, modify, copy, annotate } } -> Buffer
async function protect(bytes, { userPassword = '', ownerPassword = '', perms = {} } = {}) {
  if (!userPassword && !ownerPassword) throw new Error('scegli almeno una password');
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const ctx = doc.context, key = crypto.randomBytes(32);
  const hex = (b) => PDFHexString.of(Buffer.from(b).toString('hex'));
  const enc = (o) => {
    if (o instanceof PDFString || o instanceof PDFHexString) return hex(encryptBytes(key, o.asBytes()));
    if (o instanceof PDFDict) { for (const [k, v] of o.entries()) { const n = enc(v); if (n !== v) o.set(k, n); } return o; }
    if (o instanceof PDFArray) { for (let i = 0; i < o.size(); i++) { const v = o.get(i), n = enc(v); if (n !== v) o.set(i, n); } return o; }
    return o;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    if (obj instanceof PDFStream) {
      enc(obj.dict);
      const t = obj.dict.get(PDFName.of('Type'));
      if (t && t.toString() === '/XRef') continue;
      ctx.assign(ref, PDFRawStream.of(obj.dict, encryptBytes(key, obj.getContents())));
    } else enc(obj);
  }
  const d = encryptDict(key, userPassword, ownerPassword || crypto.randomBytes(24).toString('base64'), perms);
  const encRef = ctx.register(ctx.obj({
    Filter: 'Standard', V: 5, R: 6, Length: 256,
    CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } }, StmF: 'StdCF', StrF: 'StdCF',
    O: hex(d.O), U: hex(d.U), OE: hex(d.OE), UE: hex(d.UE), Perms: hex(d.Perms), P: d.P, EncryptMetadata: true,
  }));
  ctx.trailerInfo.Encrypt = encRef;
  const id = crypto.randomBytes(16).toString('hex');
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id), PDFHexString.of(id)]);
  // niente flussi di oggetti: il dizionario di cifratura e i riferimenti devono restare in chiaro
  return Buffer.from(await doc.save({ useObjectStreams: false, updateFieldAppearances: false }));
}

module.exports = { protect, hash2B };
