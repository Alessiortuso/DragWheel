// Finestra "Audio": converti, taglia (più parti), unisci in sequenza, volume. Il lavoro vero lo fa ffmpeg (src/audio/, src/video/).
const { BrowserWindow, ipcMain, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const ff = require('./video/ffmpeg');
const jobs = require('./audio/jobs');
const separation = require('./audio/separation/client');
const splitPlan = require('./audio/separation/plan').plan;
const guard = require('./ipc-guard');
const { glassOptions } = require('./window-style');

const AUDIO_EXT = ['mp3', 'm4a', 'm4b', 'aac', 'wav', 'flac', 'ogg', 'oga', 'opus', 'wma', 'aif', 'aiff', 'mp4'];
const sessions = new Map(); // id webContents -> { files, probes, preset, running, waves }

const sizeOf = (p) => fs.statSync(p).size;
const withUrl = (f) => ff.probe(f).then((p) => ({ ...p, url: pathToFileURL(f).href }), (e) => ({ error: e.message }));

// preset: id scelto nella ruota, es. "aud:convert:mp3", "aud:cut", "aud:merge", "aud:volume", "aud:split"
async function openAudioTool(files, preset) {
  const probes = await Promise.all(files.map(withUrl));
  if (probes.every((p) => p.error)) throw new Error(probes[0].error);
  const win = new BrowserWindow({
    width: 1220, height: 820, minWidth: 920, minHeight: 640, title: 'Audio', show: false, alwaysOnTop: true, autoHideMenuBar: true, ...glassOptions(),
    webPreferences: { preload: require('path').join(__dirname, 'tool-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  const id = win.webContents.id;
  sessions.set(id, { files, probes, preset, running: null, waves: new Map() });
  win.on('closed', () => { const s = sessions.get(id); if (s && s.running) s.running.cancel(); sessions.delete(id); });
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  await win.loadFile(path.join(__dirname, 'audio.html'));
}

ipcMain.handle('audio:init', (e) => { const s = sessions.get(e.sender.id); return { files: s.files, probes: s.probes, preset: s.preset }; });

// Forma d'onda (con cache): al massimo ~200000 intervalli, circa uno ogni 10 ms
ipcMain.handle('audio:waveform', async (e, file) => {
  const s = sessions.get(e.sender.id);
  if (!s.waves.has(file)) {
    const p = await ff.probe(file);
    s.waves.set(file, ff.waveform(file, Math.min(200000, Math.max(1000, Math.round(p.duration * 100))), p.duration).then((w) => ({ ...w, duration: p.duration })));
  }
  return s.waves.get(file);
});

// Aggiunta di file all'elenco da unire
ipcMain.handle('audio:add', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const r = await dialog.showOpenDialog(win, { title: 'Aggiungi file audio', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: AUDIO_EXT }, { name: 'Tutti i file', extensions: ['*'] }] });
  if (r.canceled) return [];
  return Promise.all(r.filePaths.map(async (f) => ({ path: f, probe: await withUrl(f) })));
});

// Esegue l'operazione. convert/volume: su tutti i file; cut: sul primo; merge: sui file indicati in options.files, nell'ordine dato
ipcMain.handle('audio:run', async (e, op, options) => {
  const s = sessions.get(e.sender.id);
  if (!s || s.running) throw new Error('operazione già in corso');
  const results = [];
  let cancelled = false;
  s.running = { cancel: () => { cancelled = true; s.cancelCurrent && s.cancelCurrent(); } };
  const send = (i, total, p, stage) => e.sender.send('audio:progress', { index: i, total, p, stage });
  const one = async (input, probe, i, total) => {
    if (op === 'split') { // separazione voce / musica: processo dedicato
      if (probe && !probe.hasAudio) throw new Error('il file non contiene audio');
      const h = separation.run(splitPlan(input, options), (stage, p) => send(i, total, p, stage));
      s.cancelCurrent = h.cancel;
      const outputs = await h.promise;
      return { outputs, sizes: outputs.map(sizeOf) };
    }
    const plan = jobs.plan(op, input, probe, options);
    const h = jobs.execute(plan, (v) => send(i, total, v));
    s.cancelCurrent = h.cancel;
    const outputs = await h.promise;
    return { outputs, sizes: outputs.map(sizeOf), copy: plan.copy, warn: plan.warn, total: plan.total };
  };
  try {
    if (op === 'merge') {
      const files = options.files || [];
      try {
        const probes = await Promise.all(files.map((f) => ff.probe(f)));
        results.push({ file: files[0], ...(await one(files, probes, 0, 1)) });
      } catch (err) { results.push(err.cancelled ? { cancelled: true } : { file: files[0], error: err.message }); }
    } else if (op === 'cut') {
      try { results.push({ file: s.files[0], ...(await one(s.files[0], s.probes[0], 0, 1)) }); }
      catch (err) { results.push(err.cancelled ? { cancelled: true } : { file: s.files[0], error: err.message }); }
    } else {
      for (let i = 0; i < s.files.length && !cancelled; i++) {
        try {
          if (s.probes[i].error) throw new Error(s.probes[i].error);
          results.push({ file: s.files[i], ...(await one(s.files[i], s.probes[i], i, s.files.length)) });
        } catch (err) { if (err.cancelled) { results.push({ file: s.files[i], cancelled: true }); break; } results.push({ file: s.files[i], error: err.message }); }
      }
    }
  } finally { s.running = null; s.cancelCurrent = null; }
  return results;
});

ipcMain.on('audio:cancel', (e) => { const s = sessions.get(e.sender.id); if (s && s.running) s.running.cancel(); });
ipcMain.on('audio:reveal', (e, p) => guard.reveal(e, p));
ipcMain.on('audio:open', (e, p) => guard.open(e, p));

module.exports = { openAudioTool };
