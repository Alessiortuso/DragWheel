// Stampa una pagina HTML in PDF con Chromium (finestra nascosta)
const { BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function htmlToPdf(html, out, { landscape = false } = {}) {
  const tmp = path.join(os.tmpdir(), `dw-print-${process.pid}-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
  try { await win.loadFile(tmp); fs.writeFileSync(out, await win.webContents.printToPDF({ pageSize: 'A4', landscape, margins: { marginType: 'default' }, printBackground: true })); }
  finally { win.destroy(); fs.rmSync(tmp, { force: true }); }
}
module.exports = { htmlToPdf };
