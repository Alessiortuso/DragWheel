// Finestra "Fogli di calcolo": converti, dividi, unisci, pulisci, confronta. Il lavoro è in src/sheet/.
const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const ops = require('./sheet/ops');
const guard = require('./ipc-guard');
const { glassOptions } = require('./window-style');

const SHEET_EXT = ['xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv'];
const sessions = new Map(); // id webContents -> { files, preset, cache }

// preset: id scelto nella ruota, es. "xl:convert:csv", "xl:split", "xl:merge", "xl:clean", "xl:diff"
async function openSheetTool(files, preset) {
  const win = new BrowserWindow({
    width: 1220, height: 820, minWidth: 940, minHeight: 640, title: 'Fogli di calcolo', show: false, alwaysOnTop: true, autoHideMenuBar: true, ...glassOptions(),
    webPreferences: { preload: path.join(__dirname, 'tool-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  const id = win.webContents.id;
  sessions.set(id, { files, preset, cache: new Map() });
  win.on('closed', () => sessions.delete(id));
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  await win.loadFile(path.join(__dirname, 'sheet.html'));
}

ipcMain.handle('sheet:init', (e) => { const s = sessions.get(e.sender.id); return { files: s.files, preset: s.preset }; });

// Fogli, dimensioni e prime righe di un file (con cache: la lettura può richiedere un po')
ipcMain.handle('sheet:inspect', (e, file) => {
  const s = sessions.get(e.sender.id);
  if (!s.cache.has(file)) s.cache.set(file, ops.inspect(file).catch((err) => ({ error: err.message })));
  return s.cache.get(file);
});

ipcMain.handle('sheet:add', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Aggiungi file', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Fogli di calcolo', extensions: SHEET_EXT }, { name: 'Tutti i file', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

const sizeOf = (p) => fs.statSync(p).size;
// convert/split/clean: su ciascun file; merge: sui file indicati, nell'ordine dato; diff: su due file
ipcMain.handle('sheet:run', async (e, op, options = {}) => {
  const s = sessions.get(e.sender.id), send = (i, total) => e.sender.send('sheet:progress', { index: i, total });
  const results = [];
  const wrap = async (file, fn) => {
    try { const r = await fn(); results.push({ file, ...r, sizes: r.outputs.map(sizeOf) }); }
    catch (err) { results.push({ file, error: err.message }); }
  };
  if (op === 'merge') { send(0, 1); const files = options.files || []; await wrap(files[0], () => ops.merge(files, options)); }
  else if (op === 'diff') { send(0, 1); await wrap(options.fileA, () => ops.diff(options.fileA, options.fileB, options)); }
  else {
    const fn = { convert: ops.convert, split: ops.split, clean: ops.clean }[op];
    if (!fn) throw new Error(`operazione sconosciuta: ${op}`);
    for (let i = 0; i < s.files.length; i++) { send(i, s.files.length); await wrap(s.files[i], () => fn(s.files[i], options)); }
  }
  return results;
});

ipcMain.on('sheet:reveal', (e, p) => guard.reveal(e, p));
ipcMain.on('sheet:open', (e, p) => guard.open(e, p));

module.exports = { openSheetTool };
