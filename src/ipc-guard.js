// Controlli sulle richieste che arrivano dalle pagine dell'app (renderer): apri/mostra solo file di dati esistenti,
// mai programmi o script. Le pagine sono locali e fidate, ma così un errore o un file malevolo non può avviare nulla.
const { shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const APP_URL = pathToFileURL(__dirname).href;
const RUNNABLE = new Set(['.exe', '.com', '.bat', '.cmd', '.ps1', '.psm1', '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.msi', '.msp', '.scr', '.lnk', '.url', '.hta', '.jar', '.reg', '.cpl', '.dll', '.appx', '.msix', '.docm', '.xlsm', '.pptm']);

const fromApp = (e) => String((e.senderFrame && e.senderFrame.url) || (e.sender && e.sender.getURL()) || '').startsWith(APP_URL);
function safeFile(p) {
  if (typeof p !== 'string' || !path.isAbsolute(p)) return false;
  try { fs.statSync(p); } catch { return false; }
  return !RUNNABLE.has(path.extname(p).toLowerCase());
}

const open = (e, p) => { if (fromApp(e) && safeFile(p)) shell.openPath(p); };
const reveal = (e, p) => { if (fromApp(e) && typeof p === 'string' && path.isAbsolute(p) && fs.existsSync(p)) shell.showItemInFolder(p); };

module.exports = { open, reveal, fromApp };
