// Microsoft Word come motore opzionale: PDF identico a quello di Word e unione dei documenti.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// In un'app impacchettata (asar) lo script sta in app.asar.unpacked
const SCRIPT = path.join(__dirname, 'word.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
let available = null;

function isAvailable() {
  if (available !== null) return available;
  try {
    const r = spawnSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\winword.exe', '/ve'], { encoding: 'utf8', windowsHide: true });
    available = r.status === 0 && /winword/i.test(r.stdout);
  } catch { available = false; }
  return available;
}

function friendly(err) {
  const line = String(err).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] || 'errore sconosciuto';
  return `Word non è riuscito a elaborare il documento: ${line.slice(0, 200)}`;
}

// op: 'pdf' | 'merge'; cfg: { input, output } oppure { files, output, pageBreak }
function run(op, cfg, { timeout = 300000 } = {}) {
  return new Promise((resolve, reject) => {
    const json = path.join(os.tmpdir(), `dw-word-${process.pid}-${Date.now()}.json`);
    fs.rmSync(cfg.output, { force: true });   // Word non sovrascrive un file già presente
    fs.writeFileSync(json, JSON.stringify(cfg), 'utf8');
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SCRIPT, '-Op', op, '-Json', json], { windowsHide: true });
    let err = '';
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { err = 'tempo scaduto (Word non risponde)'; child.kill(); }, timeout);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer); fs.rmSync(json, { force: true });
      if (code === 0 && fs.existsSync(cfg.output)) resolve();
      else { fs.rmSync(cfg.output, { force: true }); reject(new Error(friendly(err))); }
    });
  });
}

module.exports = { isAvailable, run };
