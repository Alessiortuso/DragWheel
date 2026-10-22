// Test conversioni dentro Electron (serve per il rendering PDF): npx electron src/selftest-electron.js
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { convert, addBackground, setPdfRenderer } = require('./converter');
const { renderPdf } = require('./pdf-renderer');

app.whenReady().then(async () => {
  setPdfRenderer(renderPdf);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-'));
  const src = path.join(dir, 'test.png');
  await sharp({ create: { width: 300, height: 200, channels: 4, background: '#3b82f6' } }).png().toFile(src);
  const lines = [];
  let pdf;
  for (const f of ['jpg', 'webp', 'avif', 'tiff', 'bmp', 'pdf', 'docx']) {
    const [o] = await convert(src, f);
    if (f === 'pdf') pdf = o;
    lines.push(`${f}: ${fs.statSync(o).size}`);
  }
  const [fromBmp] = await convert(path.join(dir, 'test.bmp'), 'png');
  lines.push(`bmp->png: ${fs.statSync(fromBmp).size}`);
  const pages = await convert(pdf, 'png');
  const px = await sharp(pages[0]).resize(1, 1).raw().toBuffer();
  lines.push(`pdf->png: ${pages.length} pagina, pixel medio rgb(${[...px].join(',')}) (atteso ~59,130,246)`);
  const [bg] = await addBackground(src);
  lines.push(`bg: ${fs.statSync(bg).size}`);
  console.log('SELFTEST OK\n' + lines.join('\n'));
  app.exit(0);
}).catch((e) => { console.error('SELFTEST FAIL', e); app.exit(1); });
