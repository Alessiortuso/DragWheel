const { BrowserWindow } = require('electron');
const path = require('path');

let win = null;
let loading = null;

function getWindow() {
  if (loading) return loading;
  win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false } });
  win.on('closed', () => { win = null; loading = null; });
  loading = win.loadFile(path.join(__dirname, 'pdf-render.html'))
    .then(() => win.webContents.executeJavaScript('new Promise(r => { const t = setInterval(() => window.ready && (clearInterval(t), r()), 20); })'))
    .then(() => win);
  return loading;
}

// buf: Buffer del PDF -> array di Buffer PNG (una per pagina)
async function renderPdf(buf) {
  const w = await getWindow();
  const pages = await w.webContents.executeJavaScript(`window.renderPdf(${JSON.stringify(buf.toString('base64'))})`);
  return pages.map((b64) => Buffer.from(b64, 'base64'));
}

// buf: Buffer del PDF -> righe di testo per pagina
async function extractPdf(buf) {
  const w = await getWindow();
  return w.webContents.executeJavaScript(`window.extractPdf(${JSON.stringify(buf.toString('base64'))})`);
}

module.exports = { renderPdf, extractPdf };
