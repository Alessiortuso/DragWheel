// Verifica la scelta del formato di salvataggio in Ritaglia, Ridimensiona e Rimuovi sfondo
const { app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { cropImage, resizeImage, FORMATS } = require('../src/converter');
const engine = require('../src/bg/engine');
const { photo } = require('./fixture-photo');

const describe = async (f) => {
  const b = fs.readFileSync(f), ext = path.extname(f).slice(1);
  if (ext === 'bmp') return `bmp ${b.readInt32LE(18)}x${Math.abs(b.readInt32LE(22))} (intestazione ${b.toString('latin1', 0, 2)})`;
  const m = await sharp(b).metadata();
  const { data } = await sharp(b).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return `${m.format} ${m.width}x${m.height} alpha=${m.hasAlpha} px(0,0)=${[...data.slice(0, 4)]} ${(b.length / 1024).toFixed(0)} KB`;
};

app.whenReady().then(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  // PNG 400x300: metà sinistra rossa opaca, metà destra trasparente
  const raw = Buffer.alloc(400 * 300 * 4);
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) { const i = (y * 400 + x) * 4; if (x < 200) { raw[i] = 255; raw[i + 3] = 255; } }
  const src = path.join(d, 'a.png');
  await sharp(raw, { raw: { width: 400, height: 300, channels: 4 } }).png().toFile(src);
  console.log('--- Ritaglia (rettangolo 300x100 che include trasparenza, riempimento verde #00ff00)');
  for (const f of FORMATS) {
    const [o] = await cropImage(src, { left: 100, top: 0, width: 300, height: 100 }, { format: f, background: '#00ff00' });
    console.log(f.padEnd(5), path.basename(o).padEnd(18), await describe(o));
  }
  const [same] = await cropImage(src, { left: 0, top: 0, width: 50, height: 50 }, { format: null });
  console.log('same ', path.basename(same), '(atteso png)');
  fs.writeFileSync(path.join(d, 'b.jpg'), await sharp(raw, { raw: { width: 400, height: 300, channels: 4 } }).flatten({ background: '#fff' }).jpeg().toBuffer());
  const [sj] = await cropImage(path.join(d, 'b.jpg'), { left: 0, top: 0, width: 50, height: 50 }, {});
  console.log('senza output su jpg ->', path.basename(sj));
  console.log('--- Qualità WEBP 20 vs 95');
  for (const q of [20, 95]) { const [o] = await resizeImage(src, { percent: 100 }, { format: 'webp', quality: q }); console.log('q' + q, (fs.statSync(o).size / 1024).toFixed(1), 'KB'); }
  const [rj] = await resizeImage(src, { percent: 50 }, { format: 'jpg', background: '#0000ff' });
  console.log('resize ->', path.basename(rj), await describe(rj));

  console.log('--- Rimuovi sfondo (immagine reale in copia temporanea), riempimento #00ff00 per JPG/BMP');
  const f0 = photo(33);
  const real = path.join(d, 'foto.png'); fs.copyFileSync(f0, real);
  const st = await engine.analyze(real, 'fast');
  for (const f of FORMATS) {
    const out = path.join(d, `foto No Background.${f}`);
    await engine.exportPng(real, st, { outPath: out, format: f, background: '#00ff00', quality: 80 });
    console.log(f.padEnd(5), await describe(out));
  }
  app.exit(0);
});
app.on('window-all-closed', () => {});
