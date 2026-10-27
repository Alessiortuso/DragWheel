// Prova la ruota con trascinamenti simulati e salva uno screenshot per ogni scenario.
// Uso: npx electron tools/wheel-test.js <cartella-output>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf', gif: 'image/gif', xyz: '', zip: 'application/x-zip-compressed', exe: 'application/x-msdownload', json: 'application/json', md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  mp4: 'video/mp4', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv: 'application/vnd.ms-excel', tsv: 'text/tab-separated-values',
};
const SCENARI = {
  neutra: null, png: ['png'], pdf: ['pdf'], 'pdf+pdf': ['pdf', 'pdf'], zip: ['zip'], exe: ['exe'], json: ['json'], md: ['md'], 'png+exe': ['png', 'exe'], docx: ['docx'], 'docx+docx': ['docx', 'docx'], 'docx+pdf': ['docx', 'pdf'], 'png+pdf': ['png', 'pdf'], 'png+jpg': ['png', 'jpg'], sconosciuto: ['xyz'],
  mp4: ['mp4'], 'mp4+mov': ['mp4', 'mov'], 'mp4+png': ['mp4', 'png'],
  gif: ['gif'], tsv: ['tsv'], xlsx: ['xlsx'], 'xlsx+xlsx': ['xlsx', 'xlsx'], 'xlsx+3': ['xlsx', 'xlsx', 'xlsx'], 'csv(xls)': ['csv'],
  mp3: ['mp3'], 'mp3+mp4': ['mp3', 'mp4'], 'mp3+wav': ['mp3', 'wav'], 'mp3+mp4': ['mp3', 'mp4'],
  'png-hot': { t: ['png'], hot: 3, hotCenter: 1 }, 'mp4-hot': { t: ['mp4'], hot: 2, hotCenter: 2 },
};

app.whenReady().then(async () => {
  ipcMain.on('log', () => {});
  const out = process.argv[2];
  fs.mkdirSync(out, { recursive: true });
  const w = new BrowserWindow({ width: 620, height: 620, show: false, backgroundColor: process.env.BG || '#7a8a9a',
    webPreferences: { offscreen: true, preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, sandbox: true } });
  await w.loadFile(path.join(__dirname, '..', 'src', 'wheel.html'));
  for (const [nome, sc] of Object.entries(SCENARI)) {
    const tipi = sc && sc.t ? sc.t : sc;
    const code = `(() => {
      ${tipi ? `const dt = new DataTransfer();
      for (const m of ${JSON.stringify(tipi.map((t) => MIME[t]))}) dt.items.add(new File(['x'], 'f', { type: m }));
      document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));` : ''}
      ${sc && sc.t ? `document.querySelectorAll('.seg')[${sc.hot}].classList.add('hot'); document.querySelectorAll('.cseg')[${sc.hotCenter}].classList.add('hot');` : ''}
      const ring = [...document.querySelectorAll('.seg + text')].map((t) => t.textContent).join(',');
      const center = [...document.querySelectorAll('.cseg ~ text, .center ~ text')].map((t) => t.textContent.replace(String.fromCharCode(10), ' ')).join(' / ');
      return ring + ' | centro: ' + center;
    })()`;
    await w.webContents.executeJavaScript(code).then((r) => console.log(nome.padEnd(12), r));
    await new Promise((r) => setTimeout(r, 700));
    fs.writeFileSync(path.join(out, `${nome}.png`), (await w.webContents.capturePage()).toPNG());
  }
  app.exit(0);
});
app.on('window-all-closed', () => {});
