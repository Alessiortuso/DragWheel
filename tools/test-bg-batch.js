const { app, BrowserWindow } = require('electron');
const fs = require('fs'), os = require('os'), path = require('path');
const { openTool } = require('../src/tools');
const { photo } = require('./fixture-photo');
app.whenReady().then(async () => {
  const all = Array.from({ length: 40 }, (_, i) => photo(i));
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-')); const files = [];
  for (const i of [2, 33, 24]) { const f = path.join(d, `img${i}.png`); fs.copyFileSync(all[i], f); files.push(f); }
  await openTool('removebg', files);
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  const ev = (c) => win.webContents.executeJavaScript(c);
  await new Promise((r) => setTimeout(r, 600));
  await ev(`document.getElementById('save').click(); 0`);
  const t = Date.now();
  while (!(await ev(`document.getElementById('status').textContent.includes('elaborate')`)) && Date.now() - t < 200000) await new Promise((r) => setTimeout(r, 500));
  console.log(Date.now() - t, 'ms |', await ev(`document.getElementById('status').textContent`));
  console.log(await ev(`[...document.querySelectorAll('.item')].map((i) => i.querySelector('span').textContent + ': ' + i.querySelector('.st').textContent).join('\n')`));
  console.log(fs.readdirSync(d).filter((n) => n.includes('No Background')).join(', '));
  app.exit(0);
});
app.on('window-all-closed', () => {});
