// Finestra "Documenti Word": converti, unisci, comprimi, pulisci, sostituisci. Il lavoro è in src/doc/.
const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const ops = require('./doc/ops');
const guard = require('./ipc-guard');
const { glassOptions } = require('./window-style');

const sessions = new Map(); // id webContents -> { files, preset, cache }

// preset: id scelto nella ruota, es. "dx:convert:pdf", "dx:merge", "dx:compress", "dx:clean", "dx:replace"
async function openDocTool(files, preset) {
  const win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 920, minHeight: 620, title: 'Documenti Word', show: false, alwaysOnTop: true, autoHideMenuBar: true, ...glassOptions(),
    webPreferences: { preload: path.join(__dirname, 'tool-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  const id = win.webContents.id;
  sessions.set(id, { files, preset, cache: new Map() });
  win.on('closed', () => sessions.delete(id));
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  await win.loadFile(path.join(__dirname, 'doc.html'));
}

ipcMain.handle('doc:init', (e) => { const s = sessions.get(e.sender.id); return { files: s.files, preset: s.preset, word: ops.wordAvailable() }; });

// Dimensioni, parole, immagini, commenti, autore e inizio del testo (con cache)
ipcMain.handle('doc:inspect', (e, file) => {
  const s = sessions.get(e.sender.id);
  if (!s.cache.has(file)) s.cache.set(file, ops.inspect(file).catch((err) => ({ error: err.message })));
  return s.cache.get(file);
});

ipcMain.handle('doc:add', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Aggiungi documenti', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Documenti Word', extensions: ['docx'] }, { name: 'Tutti i file', extensions: ['*'] }],
  });
  return r.canceled ? [] : r.filePaths;
});

const sizeOf = (p) => fs.statSync(p).size;
// merge: sui file indicati, nell'ordine dato; le altre operazioni: su ciascun file della sessione
ipcMain.handle('doc:run', async (e, op, options = {}) => {
  const s = sessions.get(e.sender.id), send = (i, total) => e.sender.send('doc:progress', { index: i, total });
  const results = [];
  const wrap = async (file, fn) => {
    try { const r = await fn(); results.push({ file, ...r, sizes: r.outputs.map(sizeOf) }); }
    catch (err) { results.push({ file, error: err.message }); }
  };
  if (op === 'merge') { send(0, 1); const files = options.files || []; await wrap(files[0], () => ops.merge(files, options)); }
  else {
    const fn = { convert: ops.convert, compress: ops.compress, clean: ops.clean, replace: ops.replace }[op];
    if (!fn) throw new Error(`operazione sconosciuta: ${op}`);
    for (let i = 0; i < s.files.length; i++) { send(i, s.files.length); await wrap(s.files[i], () => fn(s.files[i], options)); }
  }
  return results;
});

ipcMain.on('doc:reveal', (e, p) => guard.reveal(e, p));
ipcMain.on('doc:open', (e, p) => guard.open(e, p));

module.exports = { openDocTool };
