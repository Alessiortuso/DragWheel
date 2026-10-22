const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tool', {
  init: () => ipcRenderer.invoke('tool:init'),
  apply: (params) => ipcRenderer.invoke('tool:apply', params),
  close: () => ipcRenderer.send('tool:close'),
});

contextBridge.exposeInMainWorld('bg', {
  analyze: (model) => ipcRenderer.invoke('bg:analyze', model),
  export: (opts) => ipcRenderer.invoke('bg:export', opts),
  batch: (model, output) => ipcRenderer.invoke('bg:batch', model, output),
  reveal: (file) => ipcRenderer.send('bg:reveal', file),
  onProgress: (cb) => ipcRenderer.on('bg:progress', (_e, m) => cb(m)),
  onBatch: (cb) => ipcRenderer.on('bg:batch', (_e, m) => cb(m)),
});

contextBridge.exposeInMainWorld('video', {
  init: () => ipcRenderer.invoke('video:init'),
  thumb: (index, t) => ipcRenderer.invoke('video:thumb', index, t),
  canCopy: (index, target) => ipcRenderer.invoke('video:canCopy', index, target),
  run: (op, options) => ipcRenderer.invoke('video:run', op, options),
  cancel: () => ipcRenderer.send('video:cancel'),
  reveal: (p) => ipcRenderer.send('video:reveal', p),
  open: (p) => ipcRenderer.send('video:open', p),
  onProgress: (cb) => ipcRenderer.on('video:progress', (_e, m) => cb(m)),
});

contextBridge.exposeInMainWorld('audio', {
  init: () => ipcRenderer.invoke('audio:init'),
  waveform: (file) => ipcRenderer.invoke('audio:waveform', file),
  add: () => ipcRenderer.invoke('audio:add'),
  run: (op, options) => ipcRenderer.invoke('audio:run', op, options),
  cancel: () => ipcRenderer.send('audio:cancel'),
  reveal: (p) => ipcRenderer.send('audio:reveal', p),
  open: (p) => ipcRenderer.send('audio:open', p),
  onProgress: (cb) => ipcRenderer.on('audio:progress', (_e, m) => cb(m)),
});

contextBridge.exposeInMainWorld('doc', {
  init: () => ipcRenderer.invoke('doc:init'),
  inspect: (file) => ipcRenderer.invoke('doc:inspect', file),
  add: () => ipcRenderer.invoke('doc:add'),
  run: (op, options) => ipcRenderer.invoke('doc:run', op, options),
  reveal: (p) => ipcRenderer.send('doc:reveal', p),
  open: (p) => ipcRenderer.send('doc:open', p),
  onProgress: (cb) => ipcRenderer.on('doc:progress', (_e, m) => cb(m)),
});

contextBridge.exposeInMainWorld('sheet', {
  init: () => ipcRenderer.invoke('sheet:init'),
  inspect: (file) => ipcRenderer.invoke('sheet:inspect', file),
  add: () => ipcRenderer.invoke('sheet:add'),
  run: (op, options) => ipcRenderer.invoke('sheet:run', op, options),
  reveal: (p) => ipcRenderer.send('sheet:reveal', p),
  open: (p) => ipcRenderer.send('sheet:open', p),
  onProgress: (cb) => ipcRenderer.on('sheet:progress', (_e, m) => cb(m)),
});
