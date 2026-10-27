const { app, BrowserWindow, Tray, Menu, ipcMain, screen, globalShortcut, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { convert, addBackground, setPdfRenderer, setPdfExtractor } = require('./converter');
const { renderPdf, extractPdf } = require('./pdf-renderer');
const { openTool } = require('./tools');
const { openVideoTool } = require('./video-tool');
const { openAudioTool } = require('./audio-tool');
const { openSheetTool } = require('./sheet-tool');
const { openDocTool } = require('./doc-tool');
const { openPdfTool } = require('./pdf-tool');
const dataOps = require('./data/ops');
const webDocs = require('./web-docs');
const archive = require('./archive');
const bgClient = require('./bg/client');

const SIZE = 620;
const { KEYS, createDragTrigger } = require('./trigger');
const prefs = require('./prefs');
const wheelGlass = require('./wheel-glass');
require('./window-style'); // tema chiaro e vetro per le finestre di lavoro

let wheel = null;
let tray = null;
let busy = 0;
let hideTimer = null;

// log.txt in userData: ultimi eventi (anche i percorsi dei file elaborati); superati 512 KB il vecchio log passa a log.old.txt
function log(msg) {
  try {
    const f = path.join(app.getPath('userData'), 'log.txt');
    if (fs.existsSync(f) && fs.statSync(f).size > 512 * 1024) fs.renameSync(f, path.join(app.getPath('userData'), 'log.old.txt'));
    fs.appendFileSync(f, `${new Date().toISOString()} ${msg}
`);
  } catch {}
}
ipcMain.on('log', (_e, m) => log(`[wheel] ${m}`));

// Installato: i modelli di rimozione sfondo stanno in resources/models (vedi extraResources in package.json)
if (app.isPackaged && !process.env.DRAGWHEEL_MODELS) process.env.DRAGWHEEL_MODELS = path.join(process.resourcesPath, 'models');

if (!app.requestSingleInstanceLock()) app.quit();
setPdfRenderer(renderPdf);
setPdfExtractor(extractPdf);

function createWheel() {
  wheel = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false, transparent: true, resizable: false,
    skipTaskbar: true, alwaysOnTop: true, focusable: false, hasShadow: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  wheel.setAlwaysOnTop(true, 'screen-saver');
  wheel.loadFile(path.join(__dirname, 'wheel.html'));
}

// La ruota compare dopo aver scattato (o recuperato) la foto dello schermo da sfocare dietro la cornice
let showing = false;
async function showWheel() {
  if (showing) return;
  showing = true;
  try {
    clearTimeout(hideTimer);
    const visible = wheel.isVisible();
    let shot = null;
    if (!visible) { // la foto va scattata PRIMA di mostrare la ruota, altrimenti la ruota stessa finirebbe nello scatto
      if (!(await wheelGlass.latest(0))) wheelGlass.capture();
      shot = await wheelGlass.latest(250);
    }
    const pt = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(pt).workArea;
    const x = Math.min(Math.max(pt.x - SIZE / 2, area.x), area.x + area.width - SIZE);
    const y = Math.min(Math.max(pt.y - SIZE / 2, area.y), area.y + area.height - SIZE);
    const bounds = { x: Math.round(x), y: Math.round(y), width: SIZE, height: SIZE };
    wheel.setBounds(bounds);
    if (!visible) {
      wheel.webContents.send('reset');
      wheel.webContents.send('glass', shot ? wheelGlass.cropUnder(shot, bounds) : null);
      wheel.showInactive(); globalShortcut.register('Escape', () => hideWheel(0));
      wheelGlass.discard();
      log(`wheel shown (vetro: ${shot ? 'sì' : 'no'})`);
    }
  } finally { showing = false; }
}

function hideWheel(delay = 0) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (!busy && wheel && wheel.isVisible()) { wheel.hide(); globalShortcut.unregister('Escape'); } }, delay);
}

// Tasto da tenere premuto durante il trascinamento (scelta dal menu dell'icona, ricordata)
let triggerKey = KEYS[prefs.read().trigger] ? prefs.read().trigger : 'space';
let dragTrigger = null;

// Rilevamento globale: tasto sinistro premuto + tasto di attivazione + movimento = trascinamento con quel tasto
function startGlobalHook() {
  let uIOhook;
  try { ({ uIOhook } = require('uiohook-napi')); } catch (e) { console.error('uiohook non disponibile:', e.message); return; }
  dragTrigger = createDragTrigger({ key: triggerKey, isVisible: () => !!(wheel && wheel.isVisible()), onShow: showWheel, onArm: () => wheelGlass.capture(), onRelease: () => hideWheel(700) });
  for (const ev of ['keydown', 'keyup', 'mousedown', 'mouseup', 'mousemove']) uIOhook.on(ev, (e) => dragTrigger[ev](e));
  uIOhook.start();
  app.on('will-quit', () => uIOhook.stop());
}

ipcMain.handle('convert', async (_e, files, fmt) => {
  if (/^(data|web|zip):/.test(fmt)) { // operazioni rapide senza finestra: dati, documentazione, ZIP
    busy++;
    log(`${fmt}: ${JSON.stringify(files)}`);
    const results = [];
    const one = async (file, fn) => { try { results.push({ file, ...(await fn()) }); } catch (err) { log(`errore ${file}: ${err.stack}`); results.push({ file, error: err.message }); } };
    try {
      const [group, op, target] = fmt.split(':');
      if (fmt === 'zip:create') await one(files[0], () => archive.zipPaths(files)); // tutto in un solo archivio
      else for (const f of files) {
        if (group === 'zip') await one(f, () => archive.extract(f));
        else if (group === 'web') await one(f, () => webDocs.convert(f, op));
        else await one(f, () => (op === 'convert' ? dataOps.convert(f, target) : dataOps[op](f)));
      }
    } finally { busy--; hideWheel(results.some((r) => r.message || r.error) ? 6000 : 1800); }
    return results;
  }
  if (fmt.startsWith('pdf:')) { // strumenti PDF (modifica, pagine, firma, password, compressione): finestra propria
    log(`strumento ${fmt}: ${JSON.stringify(files)}`);
    try { await openPdfTool(files, fmt); hideWheel(300); return files.map((file) => ({ file, outputs: [], opened: true })); }
    catch (err) { log(`errore ${fmt}: ${err.stack}`); hideWheel(2500); return [{ file: files[0], error: err.message }]; }
  }
  if (fmt.startsWith('dx:')) { // strumenti per documenti Word: finestra propria
    log(`strumento ${fmt}: ${JSON.stringify(files)}`);
    try { await openDocTool(files, fmt); hideWheel(300); return files.map((file) => ({ file, outputs: [], opened: true })); }
    catch (err) { log(`errore ${fmt}: ${err.stack}`); hideWheel(2500); return [{ file: files[0], error: err.message }]; }
  }
  if (fmt.startsWith('xl:')) { // strumenti per fogli di calcolo: finestra propria
    log(`strumento ${fmt}: ${JSON.stringify(files)}`);
    try { await openSheetTool(files, fmt); hideWheel(300); return files.map((file) => ({ file, outputs: [], opened: true })); }
    catch (err) { log(`errore ${fmt}: ${err.stack}`); hideWheel(2500); return [{ file: files[0], error: err.message }]; }
  }
  if (fmt.startsWith('aud:')) { // strumenti audio: finestra propria
    log(`strumento ${fmt}: ${JSON.stringify(files)}`);
    try { await openAudioTool(files, fmt); hideWheel(300); return files.map((file) => ({ file, outputs: [], opened: true })); }
    catch (err) { log(`errore ${fmt}: ${err.stack}`); hideWheel(2500); return [{ file: files[0], error: err.message }]; }
  }
  if (fmt.startsWith('vid:')) { // strumenti video: finestra propria
    log(`strumento ${fmt}: ${JSON.stringify(files)}`);
    try { await openVideoTool(files, fmt); hideWheel(300); return files.map((file) => ({ file, outputs: [], opened: true })); }
    catch (err) { log(`errore ${fmt}: ${err.stack}`); hideWheel(2500); return [{ file: files[0], error: err.message }]; }
  }
  if (fmt === 'crop' || fmt === 'resize' || fmt === 'removebg') { // strumenti con finestra propria: la ruota si chiude subito
    log(`strumento ${fmt}: ${JSON.stringify(files)}`);
    try { await openTool(fmt, files); hideWheel(300); return files.map((file) => ({ file, outputs: [], opened: true })); }
    catch (err) { log(`errore ${fmt}: ${err.stack}`); hideWheel(2500); return [{ file: files[0], error: err.message }]; }
  }
  busy++;
  log(`convert ${fmt}: ${JSON.stringify(files)}`);
  const results = [];
  try {
    for (const f of files) {
      try {
        const outs = fmt === 'bg' ? await addBackground(f) : await convert(f, fmt);
        results.push({ file: f, outputs: outs });
      } catch (err) {
        log(`errore ${f}: ${err.stack}`);
        results.push({ file: f, error: err.message });
      }
    }
  } finally {
    busy--;
    hideWheel(1800);
  }
  return results;
});

// Per ogni percorso rilasciato sulla ruota: 'dir' (cartella), 'file' o 'missing'
ipcMain.handle('pathKinds', (_e, paths) => (Array.isArray(paths) ? paths : []).map((p) => {
  try { return fs.statSync(String(p)).isDirectory() ? 'dir' : 'file'; } catch { return 'missing'; }
}));

ipcMain.on('hide', () => hideWheel(0));
// La ruota resta aperta per qualche secondo (es. quando va riproposta dopo un rilascio non valido)
ipcMain.on('hold', (_e, ms) => { busy++; clearTimeout(hideTimer); setTimeout(() => { busy--; hideWheel(300); }, Math.min(ms || 8000, 30000)); });

async function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="14" fill="#ee4b5b"/><circle cx="16" cy="16" r="5" fill="#fff"/></svg>';
  const icon = nativeImage.createFromBuffer(await sharp(Buffer.from(svg)).png().toBuffer());
  tray = new Tray(icon);
  tray.on('click', showWheel);
  refreshTray();
}

function refreshTray() {
  tray.setToolTip(`DragWheel — trascina un file tenendo premuto ${KEYS[triggerKey].label}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostra ruota (Ctrl+Shift+W)', click: showWheel },
    { label: 'Tasto da tenere premuto', submenu: Object.entries(KEYS).map(([id, k]) => ({
      label: k.label, type: 'radio', checked: id === triggerKey,
      click: () => { triggerKey = id; if (dragTrigger) dragTrigger.setKey(id); prefs.update((p) => { p.trigger = id; }); refreshTray(); },
    })) },
    { type: 'separator' },
    { label: 'Avvia con Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin,
      click: (i) => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Esci', click: () => app.quit() },
  ]));
}

app.whenReady().then(async () => {
  createWheel();
  wheelGlass.capture(); // primo scatto "a vuoto": il sistema impiega più tempo la prima volta
  await createTray();
  startGlobalHook();
  // Alternativa senza hook: ruota al cursore, si chiude dopo qualche secondo o dopo un drop
  globalShortcut.register('CommandOrControl+Shift+W', () => { showWheel(); hideWheel(8000); });
});

app.on('window-all-closed', (e) => e.preventDefault());
app.on('will-quit', () => bgClient.shutdown());
