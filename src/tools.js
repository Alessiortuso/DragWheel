// Finestre degli strumenti per le immagini: ritaglio e ridimensionamento
const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { cropImage, resizeImage, previewOf, sizeOf, uniquePath } = require('./converter');
const bg = require('./bg/client');
const guard = require('./ipc-guard');
const { glassOptions } = require('./window-style');

// Ultimo formato di salvataggio scelto per ciascuno strumento
const prefs = require('./prefs');
const readPrefs = prefs.read;
function rememberOutput(kind, output) {
  if (output) prefs.update((p) => { (p.output ||= {})[kind] = output; });
}

const sessions = new Map(); // id webContents -> { kind, files, info }
const WINDOW = { crop: { width: 940, height: 740, title: 'Ritaglia immagine', page: 'crop.html' }, resize: { width: 560, height: 480, title: 'Ridimensiona', page: 'resize.html' },
  removebg: { width: 1200, height: 820, title: 'Rimuovi sfondo', page: 'bgremove.html' } };

async function openTool(kind, files) {
  const cfg = WINDOW[kind];
  const info = kind === 'crop' ? await previewOf(files[0]) : kind === 'resize' && files.length === 1 ? await sizeOf(files[0]) : {};
  const win = new BrowserWindow({
    width: cfg.width, height: cfg.height, minWidth: 460, minHeight: 400, title: cfg.title, show: false, alwaysOnTop: true,
    autoHideMenuBar: true, ...glassOptions(), webPreferences: { preload: path.join(__dirname, 'tool-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  const id = win.webContents.id;
  sessions.set(id, { kind, files, info });
  if (kind === 'removebg') bg.retain();
  win.on('closed', () => {
    sessions.delete(id);
    if (kind === 'removebg') bg.call({ type: 'forget', sid: id }).catch(() => {}).finally(() => bg.release());
  });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  await win.loadFile(path.join(__dirname, cfg.page));
}

ipcMain.handle('tool:init', (e) => {
  const s = sessions.get(e.sender.id);
  return { files: s.files, info: s.info, output: (readPrefs().output || {})[s.kind] || null };
});

ipcMain.handle('tool:apply', async (e, params) => {
  const s = sessions.get(e.sender.id);
  const outputs = [];
  let firstError = null;
  for (const f of s.files) {
    try { outputs.push(...(s.kind === 'crop' ? await cropImage(f, params, params.output) : await resizeImage(f, params, params.output))); }
    catch (err) { firstError ||= err; }
  }
  if (!outputs.length) throw firstError || new Error('nessun file elaborato');
  rememberOutput(s.kind, params.output);
  return { outputs };
});

// ---- Rimozione sfondo: l'elaborazione avviene nel processo di lavoro (bg/worker.js)
const outPathFor = (file, fmt = 'png') => uniquePath(path.dirname(file), `${path.basename(file, path.extname(file))} No Background`, fmt);

ipcMain.handle('bg:analyze', (e, model) => {
  const s = sessions.get(e.sender.id);
  return bg.call({ type: 'analyze', sid: e.sender.id, file: s.files[0], model }, (stage, p) => e.sender.send('bg:progress', { stage, p }));
});

ipcMain.handle('bg:export', async (e, opts) => {
  const s = sessions.get(e.sender.id);
  const outPath = outPathFor(s.files[0], opts.format);
  rememberOutput('removebg', { format: opts.format, quality: opts.quality, background: opts.background });
  await bg.call({ type: 'export', sid: e.sender.id, opts, outPath }, (stage, p) => e.sender.send('bg:progress', { stage, p }));
  return { outPath };
});

ipcMain.handle('bg:batch', async (e, model, output = {}) => {
  rememberOutput('removebg', output);
  const s = sessions.get(e.sender.id);
  const results = [];
  for (let i = 0; i < s.files.length; i++) {
    const file = s.files[i];
    try {
      const outPath = outPathFor(file, output.format);
      await bg.call({ type: 'auto', file, model, outPath, output }, (stage, p) => e.sender.send('bg:batch', { index: i, stage, p }));
      e.sender.send('bg:batch', { index: i, done: true, outPath });
      results.push({ file, outPath });
    } catch (err) {
      e.sender.send('bg:batch', { index: i, error: err.message });
      results.push({ file, error: err.message });
    }
  }
  return results;
});

ipcMain.on('bg:reveal', (e, p) => guard.reveal(e, p));

ipcMain.on('tool:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());

module.exports = { openTool };
