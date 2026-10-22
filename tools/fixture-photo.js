// Immagini di prova generate qui (un soggetto su uno sfondo sfumato), così i test non dipendono da file personali.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-photos-'));

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgb) { // rgb: Buffer w*h*3
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// i-esima immagine (sempre la stessa per lo stesso i): PNG 1024x768 con una figura (testa e busto) su sfondo sfumato
function photo(i = 0) {
  const f = path.join(dir, `foto-${i}.png`);
  if (fs.existsSync(f)) return f;
  const w = 1024, h = 768, cx = 380 + ((i * 53) % 260), cy = 330 + ((i * 29) % 120), px = Buffer.alloc(w * h * 3);
  const hue = (i * 47) % 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 90 + hue / 3 + (x / w) * 90, g = 120 + (y / h) * 90, b = 200 - (x / w) * 70 - hue / 4;   // sfondo
    if (y > 560) { r = 60; g = 70; b = 60; }                                                           // pavimento
    if (((x - cx) / 150) ** 2 + ((y - cy - 170) / 210) ** 2 < 1) { r = 43; g = 43; b = 43; }           // busto
    if ((x - cx) ** 2 + (y - cy + 90) ** 2 < 85 * 85) { r = 232; g = 183; b = 142; }                   // testa
    const o = (y * w + x) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b;
  }
  fs.writeFileSync(f, png(w, h, px));
  return f;
}
module.exports = { photo, dir };
