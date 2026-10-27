// Stampa una pagina HTML in PDF con Chromium (finestra nascosta, senza JavaScript e senza rete:
// le risorse online non vengono scaricate, quelle locali sì)
const { BrowserWindow, session } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

let offline = null;
function offlineSession() {
  if (offline) return offline;
  offline = session.fromPartition('dragwheel-print');
  offline.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data|blob|devtools|chrome):/i.test(d.url) }));
  return offline;
}

async function printWindow(load, out, { landscape = false } = {}) {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, session: offlineSession() } });
  try {
    await load(win);
    fs.writeFileSync(out, await win.webContents.printToPDF({ pageSize: 'A4', landscape, margins: { marginType: 'default' }, printBackground: true }));
  } finally { win.destroy(); }
}

// html: testo della pagina; base: cartella da cui risolvere immagini e collegamenti relativi
async function htmlToPdf(html, out, { landscape = false, base = null } = {}) {
  const tmp = path.join(os.tmpdir(), `dw-print-${process.pid}-${Date.now()}.html`);
  const withBase = base ? html.replace(/<head([^>]*)>/i, (m) => `${m}<base href="${require('url').pathToFileURL(base + path.sep).href}">`) : html;
  fs.writeFileSync(tmp, withBase, 'utf8');
  try { await printWindow((win) => win.loadFile(tmp), out, { landscape }); }
  finally { fs.rmSync(tmp, { force: true }); }
}

// Un file HTML così com'è (con i suoi fogli di stile e immagini locali)
const htmlFileToPdf = (file, out) => printWindow((win) => win.loadFile(file), out);

module.exports = { htmlToPdf, htmlFileToPdf };
