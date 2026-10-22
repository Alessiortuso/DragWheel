// Ripiego della ruota: tipo annunciato mancante/sbagliato, poi riconosciuto dall'estensione al rilascio
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), path = require('path');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  let held = 0;
  ipcMain.on('log', () => {}); ipcMain.on('hold', (_e, ms) => { held = ms; });
  const w = new BrowserWindow({ width: 520, height: 520, show: false, backgroundColor: '#7a8a9a', webPreferences: { offscreen: true, preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, sandbox: true } });
  await w.loadFile(path.join(__dirname, '..', 'src', 'wheel.html'));
  const ev = (c) => w.webContents.executeJavaScript(c);
  console.log('png su "png"            valido?', await ev(`valid('png', ['C:/x/a.mp4'])`), '(atteso false: è un video)');
  console.log('mp4 su "vid:convert:mkv" valido?', await ev(`valid('vid:convert:mkv', ['C:/x/a.mp4'])`), '(atteso true)');
  console.log('mkv su "vid:cut"         valido?', await ev(`valid('vid:cut', ['C:/x/a.mkv'])`), '(atteso true)');
  console.log('2 mkv su "vid:cut"       valido?', await ev(`valid('vid:cut', ['C:/x/a.mkv', 'C:/x/b.mkv'])`), '(atteso false: taglio solo su un file)');
  console.log('estensione ignota        valido?', await ev(`valid('png', ['C:/x/a.xyz'])`), '(atteso true: decide il programma)');
  await ev(`mismatch(['C:/x/film.mkv'])`);
  console.log('dopo mismatch (mkv):', await ev(`[...document.querySelectorAll('.seg + text')].map((t) => t.textContent).join(',') + ' | ' + document.getElementById('msg').textContent + ' | pending=' + JSON.stringify(pending)`), '| hold ms =', held);
  await new Promise((r) => setTimeout(r, 700));
  fs.writeFileSync(process.argv[2], (await w.webContents.capturePage()).toPNG());
  await ev(`mismatch(['C:/x/doc.docx'])`);
  console.log('docx:', await ev(`document.getElementById('msg').textContent + ' | pending=' + pending`));
  app.exit(0);
});
app.on('window-all-closed', () => {});
