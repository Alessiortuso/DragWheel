// Prova cosa fa la ruota al rilascio: le cartelle propongono solo "Comprimi in ZIP", i formati non supportati vengono
// rifiutati con un messaggio e nessuna opzione; i file supportati annunciati senza tipo propongono le opzioni giuste.
// Uso: npx electron tools/test-wheel-drop.js
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');

let fail = 0;
const ok = (n, c, extra = '') => { console.log((c ? 'OK      ' : 'FALLITO ') + n + (extra ? ' - ' + extra : '')); if (!c) fail++; };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  ipcMain.on('log', () => {}); ipcMain.on('hold', () => {});
  // come in main.js
  ipcMain.handle('pathKinds', (_e, paths) => paths.map((p) => { try { return fs.statSync(p).isDirectory() ? 'dir' : 'file'; } catch { return 'missing'; } }));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-drop-'));
  const folder = path.join(d, 'cartella.png'); fs.mkdirSync(folder); // anche con un nome che sembra un'immagine
  const exe = path.join(d, 'programma.exe'), mkv = path.join(d, 'film.mkv'), pdf = path.join(d, 'a.pdf'), json = path.join(d, 'dati.json'), zip = path.join(d, 'a.zip');
  for (const f of [exe, mkv, pdf, json, zip]) fs.writeFileSync(f, 'x');

  const w = new BrowserWindow({ show: false, width: 620, height: 620, webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload.js'), contextIsolation: true, sandbox: true } });
  await w.loadFile(path.join(__dirname, '..', 'src', 'wheel.html'));
  const state = () => w.webContents.executeJavaScript(`JSON.stringify({ ring: document.querySelectorAll('.seg').length, center: [...document.querySelectorAll('.cseg ~ text')].map((t) => t.textContent).join(' '), msg: document.getElementById('msg').textContent })`).then(JSON.parse);
  const drop = async (files) => { await w.webContents.executeJavaScript(`render(null); checkDrop(${JSON.stringify(files)}, null)`); await wait(300); return state(); };

  let s = await drop([folder]);
  ok('cartella: solo “Comprimi in ZIP”, con spiegazione', s.ring === 0 && s.center === 'COMPRIMI IN ZIP' && /si può fare solo questo/.test(s.msg), `${s.center} | ${s.msg}`);
  s = await drop([pdf, folder]);
  ok('file + cartella: solo ZIP', s.ring === 0 && s.center === 'COMPRIMI IN ZIP' && /Cartelle e file/.test(s.msg), s.msg);
  s = await drop([exe]);
  ok('formato non supportato: nessuna opzione e messaggio', s.ring === 0 && /FORMATO NON SUPPORTATO/.test(s.center) && /\.exe: formato non supportato/.test(s.msg), `${s.center} | ${s.msg}`);
  s = await drop([pdf, exe]);
  ok('supportato + non supportato: rifiutato', s.ring === 0 && /togli questi file/.test(s.msg), s.msg);
  s = await drop([mkv]);
  ok('file supportato annunciato senza tipo: opzioni giuste da cliccare', s.ring > 0 && /MKV/.test(s.msg), `${s.ring} formati | ${s.msg}`);
  s = await drop([json]);
  ok('JSON: conversioni e strumenti per i dati', s.ring === 5 && /FORMATTA/.test(s.center) && /VALIDA/.test(s.center), `${s.ring} formati | ${s.center}`);
  s = await drop([zip]);
  ok('ZIP: Estrai', s.ring === 0 && s.center === 'ESTRAI');
  s = await drop([pdf, json]);
  ok('tipi senza opzioni in comune: spiegato', s.ring === 0 && /NESSUNA OPZIONE/.test(s.center), s.msg);

  console.log(fail ? `\n${fail} prove FALLITE` : '\nTutte le prove superate');
  fs.rmSync(d, { recursive: true, force: true });
  app.exit(fail ? 1 : 0);
});
app.on('window-all-closed', () => {});
