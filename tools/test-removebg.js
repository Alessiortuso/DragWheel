// Prova la rimozione sfondo su un'immagine sintetica (oggetto ombreggiato su sfondo texturizzato)
const { app } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const sharp = require('sharp');
const { removeBackgroundOf } = require('../src/converter');

app.whenReady().then(async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const svg = `<svg width="800" height="600" xmlns="http://www.w3.org/2000/svg"><defs>
    <pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#9db4c0"/><circle cx="10" cy="10" r="8" fill="#b8c9d2"/><rect x="22" y="22" width="14" height="14" fill="#8aa3b0"/></pattern>
    <radialGradient id="g" cx="35%" cy="30%"><stop offset="0" stop-color="#ff8a80"/><stop offset=".6" stop-color="#d32f2f"/><stop offset="1" stop-color="#7f0000"/></radialGradient></defs>
    <rect width="800" height="600" fill="url(#p)"/><ellipse cx="400" cy="520" rx="170" ry="26" fill="#0005"/>
    <circle cx="400" cy="330" r="190" fill="url(#g)"/><rect x="392" y="110" width="16" height="60" rx="6" fill="#4e342e"/><path d="M408 130 q60 -50 100 -10 q-50 40 -100 10z" fill="#388e3c"/></svg>`;
  const f = path.join(d, 'mela.png');
  await sharp(Buffer.from(svg)).png().toFile(f);
  const t = Date.now();
  const [out] = await removeBackgroundOf(f);
  console.log('prima chiamata', Date.now() - t, 'ms ->', path.basename(out));
  const t2 = Date.now();
  await removeBackgroundOf(f);
  console.log('seconda chiamata', Date.now() - t2, 'ms');
  const { data, info } = await sharp(out).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const a = (x, y) => data[(y * info.width + x) * 4 + 3];
  console.log(`${info.width}x${info.height} canali ${info.channels}`, 'alpha centro', a(400, 330), '| angoli', [a(5, 5), a(795, 5), a(5, 595), a(795, 595)].join(','), '| fondo tra oggetto e bordo', a(100, 300));
  fs.copyFileSync(out, process.argv[2] || path.join(d, 'x.png'));
  app.exit(0);
});
app.on('window-all-closed', () => {});
