const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { openTool } = require('../src/tools');
const { photo } = require('./fixture-photo');
app.whenReady().then(async () => {
  const f0 = photo(7);
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-')); const file = path.join(d, 'foto.png'); fs.copyFileSync(f0, file);
  app.on('web-contents-created', (_e, wc) => wc.on('console-message', (_ev, level, msg, line, src) => console.log('[console]', level, msg, src.split('/').pop() + ':' + line)));
  await openTool('removebg', [file]);
  await new Promise((r) => setTimeout(r, 12000));
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  console.log('stato', await win.webContents.executeJavaScript(`[document.getElementById('status').textContent, document.getElementById('save').disabled, typeof AlphaOps, typeof window.bg].join(' | ')`));
  app.exit(0);
});
app.on('window-all-closed', () => {});
