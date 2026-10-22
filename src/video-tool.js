// Finestra "Video": converti, comprimi, ridimensiona, taglia, fotogrammi. Il lavoro vero lo fa ffmpeg (src/video/).
const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ff = require('./video/ffmpeg');
const jobs = require('./video/jobs');
const guard = require('./ipc-guard');
const { glassOptions } = require('./window-style');

// Peso di un file, o della cartella con tutti i suoi file
const sizeOf = (p) => { const st = fs.statSync(p); return st.isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + sizeOf(path.join(p, f)), 0) : st.size; };

const sessions = new Map(); // id webContents -> { files, probes, running }

// preset: id scelto nella ruota, es. "vid:convert:mp4", "vid:compress", "vid:cut"
async function openVideoTool(files, preset) {
  const probes = await Promise.all(files.map((f) => ff.probe(f).then((p) => ({ ...p, url: pathToFileURL(f).href }), (e) => ({ error: e.message }))));
  if (probes.every((p) => p.error)) throw new Error(probes[0].error);
  const win = new BrowserWindow({
    width: 1220, height: 820, minWidth: 900, minHeight: 640, title: 'Video', show: false, alwaysOnTop: true, autoHideMenuBar: true, ...glassOptions(),
    webPreferences: { preload: path.join(__dirname, 'tool-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  const id = win.webContents.id;
  sessions.set(id, { files, probes, preset, running: null });
  win.on('closed', () => { const s = sessions.get(id); if (s && s.running) s.running.cancel(); sessions.delete(id); });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  await win.loadFile(path.join(__dirname, 'video.html'));
}

ipcMain.handle('video:init', (e) => { const s = sessions.get(e.sender.id); return { files: s.files, probes: s.probes, preset: s.preset }; });
ipcMain.handle('video:thumb', (e, index, t) => ff.thumbnail(sessions.get(e.sender.id).files[index], t));
ipcMain.handle('video:canCopy', (e, index, target) => jobs.canCopy(sessions.get(e.sender.id).probes[index], target));

// Esegue l'operazione su tutti i file (uno dopo l'altro). Progress: { index, total, p }
ipcMain.handle('video:run', async (e, op, options) => {
  const s = sessions.get(e.sender.id);
  if (!s || s.running) throw new Error('operazione già in corso');
  const results = [];
  let cancelled = false;
  s.running = { cancel: () => { cancelled = true; s.cancelCurrent && s.cancelCurrent(); } };
  try {
    for (let i = 0; i < s.files.length && !cancelled; i++) {
      const file = s.files[i], p = s.probes[i];
      try {
        if (p.error) throw new Error(p.error);
        const plan = jobs.plan(op, file, p, options);
        const h = jobs.execute(plan, (v) => e.sender.send('video:progress', { index: i, total: s.files.length, p: v }));
        s.cancelCurrent = h.cancel;
        const outputs = await h.promise;
        results.push({ file, outputs, sizes: outputs.map(sizeOf), count: plan.count, copy: plan.copy, warn: plan.warn });
      } catch (err) {
        if (err.cancelled) { results.push({ file, cancelled: true }); break; }
        results.push({ file, error: err.message });
      }
    }
  } finally { s.running = null; s.cancelCurrent = null; }
  return results;
});

ipcMain.on('video:cancel', (e) => { const s = sessions.get(e.sender.id); if (s && s.running) s.running.cancel(); });
ipcMain.on('video:reveal', (e, p) => guard.reveal(e, p));
ipcMain.on('video:open', (e, p) => guard.open(e, p));

module.exports = { openVideoTool };
