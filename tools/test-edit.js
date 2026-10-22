// Prova ritaglio e ridimensionamento su immagini vere (incluso JPG ruotato via EXIF e BMP)
const { app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { cropImage, resizeImage, previewOf, sizeOf, convert } = require('../src/converter');

const dims = async (f) => { const m = await sharp(f).metadata(); return `${m.width}x${m.height} ${m.format}`; };
app.whenReady().then(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-')), r = [];
  const base = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#3b82f6' } }).png().toBuffer();
  fs.writeFileSync(path.join(d, 'a.png'), base);
  fs.writeFileSync(path.join(d, 'b.jpg'), await sharp(base).jpeg().toBuffer());
  fs.writeFileSync(path.join(d, 'c.jpg'), await sharp(base).withMetadata({ orientation: 6 }).jpeg().toBuffer()); // 400x300 con EXIF 90°
  const [bmp] = await convert(path.join(d, 'a.png'), 'bmp');
  const t = async (name, p) => { try { r.push(`${name}: ${await p}`); } catch (e) { r.push(`${name}: ERRORE ${e.message}`); } };
  await t('crop png', cropImage(path.join(d, 'a.png'), { left: 10.4, top: 20, width: 100, height: 50 }).then((o) => dims(o[0])));
  await t('crop fuori bordo', cropImage(path.join(d, 'a.png'), { left: 350, top: 250, width: 500, height: 500 }).then((o) => dims(o[0])));
  await t('crop jpg->jpg', cropImage(path.join(d, 'b.jpg'), { left: 0, top: 0, width: 200, height: 200 }).then((o) => path.basename(o[0]) + ' ' + '(' + o.length + ')'));
  await t('crop bmp', cropImage(bmp, { left: 0, top: 0, width: 40, height: 30 }).then((o) => dims(o[0])));
  await t('resize 50%', resizeImage(path.join(d, 'a.png'), { percent: 50 }).then((o) => dims(o[0])));
  await t('resize 200x? lock', resizeImage(path.join(d, 'a.png'), { width: 200, height: 0, lock: true }).then((o) => dims(o[0])));
  await t('resize box 100x100 lock', resizeImage(path.join(d, 'a.png'), { width: 100, height: 100, lock: true }).then((o) => dims(o[0])));
  await t('resize 100x100 esatto', resizeImage(path.join(d, 'a.png'), { width: 100, height: 100, lock: false }).then((o) => dims(o[0])));
  await t('resize nome', resizeImage(path.join(d, 'b.jpg'), { percent: 25 }).then((o) => path.basename(o[0])));
  await t('EXIF c.jpg (atteso 300x400)', sizeOf(path.join(d, 'c.jpg')).then((s) => `${s.width}x${s.height}`));
  await t('preview 1400 max', previewOf(path.join(d, 'a.png'), 100).then((p) => `${p.width}x${p.height} url ${p.dataUrl.slice(0, 22)}`));
  await t('resize senza misure', resizeImage(path.join(d, 'a.png'), { lock: true }));
  console.log(r.join('\n'));
  app.exit(0);
});
app.on('window-all-closed', () => {});
