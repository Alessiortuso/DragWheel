const { contextBridge, ipcRenderer, webUtils } = require('electron');

// I File che attraversano il contextBridge perdono l'identità e getPathForFile restituisce '':
// i percorsi vanno quindi letti qui, nel mondo del preload, durante la fase di capture del drop.
let lastDrop = [];
document.addEventListener('drop', (e) => {
  lastDrop = Array.from(e.dataTransfer.files).map((f) => webUtils.getPathForFile(f)).filter(Boolean);
}, true);

contextBridge.exposeInMainWorld('api', {
  takeDropPaths: () => { const p = lastDrop; lastDrop = []; return p; },
  convert: (files, fmt) => ipcRenderer.invoke('convert', files, fmt),
  log: (m) => ipcRenderer.send('log', String(m)),
  onGlass: (cb) => ipcRenderer.on('glass', (_e, url) => cb(url)),
  onReset: (cb) => ipcRenderer.on('reset', () => cb()),
  hold: (ms) => ipcRenderer.send('hold', ms),
  hide: () => ipcRenderer.send('hide'),
});
