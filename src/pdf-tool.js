// Finestra "PDF": modifica (testo, disegni, immagini, firme autografe, oscuramento), pagine e unione, moduli,
// firma digitale, password, compressione. Il lavoro è in src/pdf/.
const { BrowserWindow, ipcMain, dialog, app } = require('electron');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const ops = require('./pdf/ops');
const { protect } = require('./pdf/crypt');
const sign = require('./pdf/sign');
const { uniquePath } = require('./converter');
const guard = require('./ipc-guard');
const { glassOptions } = require('./window-style');

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'gif', 'avif', 'bmp', 'svg'];
const sessions = new Map(); // id webContents -> { files, preset, sources: [{ name, file?, bytes }] }

// preset: id scelto nella ruota, es. "pdf:edit", "pdf:pages", "pdf:merge", "pdf:sign", "pdf:protect", "pdf:compress"
async function openPdfTool(files, preset) {
  const win = new BrowserWindow({
    width: 1320, height: 880, minWidth: 1040, minHeight: 680, title: 'PDF', show: false, alwaysOnTop: true, autoHideMenuBar: true, ...glassOptions(),
    webPreferences: { preload: path.join(__dirname, 'tool-preload.js'), contextIsolation: true, sandbox: true },
  });
  win.setMenu(null);
  const id = win.webContents.id;
  sessions.set(id, { files, preset, sources: files.map((f) => ({ name: path.basename(f), file: f, bytes: null })) });
  win.on('closed', () => sessions.delete(id));
  win.once('ready-to-show', () => { win.show(); win.focus(); });
  await win.loadFile(path.join(__dirname, 'pdf.html'));
}

const bytesOf = (s, i) => {
  const src = s.sources[i];
  if (!src) throw new Error('file non trovato');
  return (src.bytes ||= fs.readFileSync(src.file));
};
const info = async (s, i) => { try { return { ...(await ops.inspect(bytesOf(s, i))), signatures: (await sign.findSignatures(bytesOf(s, i)).catch(() => [])).length }; } catch (e) { return { error: e.message }; } };

ipcMain.handle('pdf:init', async (e) => {
  const s = sessions.get(e.sender.id);
  return { files: s.files, preset: s.preset, infos: await Promise.all(s.files.map((_, i) => info(s, i))) };
});

ipcMain.handle('pdf:bytes', (e, i) => new Uint8Array(bytesOf(sessions.get(e.sender.id), i)));

// Aggiunge PDF o immagini (ogni immagine diventa una pagina) alle sorgenti della sessione
ipcMain.handle('pdf:add', async (e) => {
  const s = sessions.get(e.sender.id);
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Aggiungi PDF o immagini', properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'PDF e immagini', extensions: ['pdf', ...IMAGE_EXT] }, { name: 'Tutti i file', extensions: ['*'] }],
  });
  const out = [];
  for (const f of r.canceled ? [] : r.filePaths) {
    try {
      const raw = fs.readFileSync(f);
      const bytes = path.extname(f).toLowerCase() === '.pdf' ? raw : await ops.imageToPdf(raw);
      s.sources.push({ name: path.basename(f), file: f, bytes });
      const i = s.sources.length - 1;
      out.push({ src: i, name: path.basename(f), info: await info(s, i) });
    } catch (err) { out.push({ name: path.basename(f), error: err.message }); }
  }
  return out;
});

ipcMain.handle('pdf:blank', async (e, w, h) => {
  const s = sessions.get(e.sender.id);
  s.sources.push({ name: 'pagina vuota', bytes: await ops.blankPdf(w, h) });
  return s.sources.length - 1;
});

// Immagine da inserire nella pagina: PNG o JPEG, al massimo 2400 px di lato
async function imageData(buf) {
  let img = sharp(buf, { limitInputPixels: false }).rotate();
  const m = await img.metadata();
  if (Math.max(m.width, m.height) > 2400) img = img.resize(2400, 2400, { fit: 'inside' });
  const out = m.format === 'jpeg' ? await img.jpeg({ quality: 90 }).toBuffer({ resolveWithObject: true }) : await img.png().toBuffer({ resolveWithObject: true });
  return { data: out.data.toString('base64'), mime: m.format === 'jpeg' ? 'image/jpeg' : 'image/png', w: out.info.width, h: out.info.height };
}
ipcMain.handle('pdf:image', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Scegli un’immagine', properties: ['openFile'], filters: [{ name: 'Immagini', extensions: IMAGE_EXT }],
  });
  return r.canceled ? null : imageData(fs.readFileSync(r.filePaths[0]));
});

// ---- firme autografe salvate (userData/firme/*.png) ----
const sigDir = () => path.join(app.getPath('userData'), 'firme');
function listSigs() {
  try { return fs.readdirSync(sigDir()).filter((n) => n.endsWith('.png')).sort().map((n) => ({ id: n, data: fs.readFileSync(path.join(sigDir(), n)).toString('base64') })); }
  catch { return []; }
}
ipcMain.handle('pdf:sigs', () => listSigs());
ipcMain.handle('pdf:sigSave', async (_e, b64) => {
  fs.mkdirSync(sigDir(), { recursive: true });
  const png = await sharp(Buffer.from(String(b64), 'base64')).trim({ threshold: 1 }).png().toBuffer().catch(() => Buffer.from(String(b64), 'base64'));
  const id = `firma-${Date.now()}.png`;
  fs.writeFileSync(path.join(sigDir(), id), png);
  return listSigs();
});
ipcMain.handle('pdf:sigDelete', (_e, id) => {
  if (/^firma-\d+\.png$/.test(String(id))) fs.rmSync(path.join(sigDir(), id), { force: true });
  return listSigs();
});

// ---- firma digitale ----
ipcMain.handle('pdf:certs', () => sign.listCertificates());
ipcMain.handle('pdf:pfx', async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: 'Scegli il certificato', properties: ['openFile'], filters: [{ name: 'Certificati con chiave privata', extensions: ['pfx', 'p12'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('pdf:verify', (e, i) => sign.verifySignatures(bytesOf(sessions.get(e.sender.id), i)));

// ---- esecuzione ----
const base = (f) => path.basename(f, path.extname(f));
const write = (dir, name, bytes) => { const p = uniquePath(dir, name, 'pdf'); fs.writeFileSync(p, bytes); return p; };

// state: stato dell'editor (vedi ops.build); options dipende dall'operazione
async function runOne(s, op, state, options, file) {
  const dir = path.dirname(file), b = base(file), notes = [];
  const all = s.sources.map((_, i) => (state.plan || []).some((p) => p.src === i) ? bytesOf(s, i) : null);
  const built = state.plan ? await ops.build(all, state) : { bytes: bytesOf(s, s.files.indexOf(file)), changed: false };
  const hadSigs = built.changed && state.plan && (await sign.findSignatures(bytesOf(s, state.plan[0].src)).catch(() => [])).length;
  if (hadSigs) notes.push('Le firme digitali già presenti non sono più valide, perché il documento è stato modificato.');

  if (op === 'save') return { outputs: [write(dir, `${b} (${options.merge ? 'unione' : 'modificato'})`, built.bytes)], notes };

  if (op === 'extract' || op === 'split') {
    const groups = op === 'extract' ? [options.ids] : options.groups;
    const outputs = [];
    for (let k = 0; k < groups.length; k++) {
      const plan = groups[k].map((id) => state.plan.find((p) => p.id === id)).filter(Boolean);
      const r = await ops.build(all, { ...state, plan, meta: null });
      outputs.push(write(dir, op === 'extract' ? `${b} (pagine scelte)` : `${b} (parte ${k + 1})`, r.bytes));
    }
    return { outputs, notes };
  }

  if (op === 'compress') {
    const r = await ops.compress(built.bytes, options.level);
    if (r.bytes.length >= built.bytes.length) return { outputs: [], notes: [...notes, 'Il PDF è già compresso al meglio: non si guadagna spazio.'] };
    if (r.recompressed) notes.push(`${r.recompressed} immagini su ${r.images} ricompresse.`);
    if ((await sign.findSignatures(built.bytes).catch(() => [])).length) notes.push('La compressione toglie validità alle firme digitali presenti.');
    return { outputs: [write(dir, `${b} (compresso)`, r.bytes)], notes };
  }

  if (op === 'protect') {
    const bytes = await protect(built.bytes, options);
    return { outputs: [write(dir, `${b} (protetto)`, bytes)], notes };
  }

  if (op === 'sign') {
    const cert = options.cert || {};
    if (options.format === 'p7m') {
      // CAdES: il file (com'è adesso, con le eventuali modifiche) chiuso nella busta .p7m
      const tmp = built.changed ? write(dir, `${b} (modificato)`, built.bytes) : file;
      if (built.changed) notes.push(`Prima della firma è stato salvato “${path.basename(tmp)}”.`);
      const { data, signer } = await sign.signP7m(tmp, cert);
      let out = `${tmp}.p7m`; for (let i = 1; fs.existsSync(out); i++) out = `${tmp} (${i}).p7m`;
      fs.writeFileSync(out, data);
      return { outputs: [out], notes: [`Firmato da ${signer.name}.`, ...notes] };
    }
    let image = null;
    if (options.visible && options.image) image = Buffer.from(options.image, 'base64');
    const { pdf, signer } = await sign.signPdf(built.bytes, {
      name: options.name, reason: options.reason, location: options.location, visible: options.visible || null, image,
    }, sign.windowsSigner(cert));
    return { outputs: [write(dir, `${b} (firmato)`, pdf)], notes: [`Firmato da ${signer.name}.`, ...notes] };
  }
  throw new Error(`operazione sconosciuta: ${op}`);
}

const sizeOf = (p) => fs.statSync(p).size;
// batch: l'operazione si ripete su ciascun file così com'è (più file trascinati insieme); altrimenti sul documento dell'editor
ipcMain.handle('pdf:run', async (e, op, state = {}, options = {}) => {
  const s = sessions.get(e.sender.id), send = (i, total) => e.sender.send('pdf:progress', { index: i, total });
  const results = [];
  const wrap = async (file, fn) => {
    try { const r = await fn(); results.push({ file, ...r, sizes: r.outputs.map(sizeOf) }); }
    catch (err) { results.push({ file, error: err.message }); }
  };
  if (options.batch) {
    for (let i = 0; i < s.files.length; i++) { send(i, s.files.length); await wrap(s.files[i], () => runOne(s, op, {}, options, s.files[i])); }
  } else { send(0, 1); await wrap(s.files[0], () => runOne(s, op, state, options, s.files[0])); }
  return results;
});

ipcMain.on('pdf:reveal', (e, p) => guard.reveal(e, p));
ipcMain.on('pdf:open', (e, p) => guard.open(e, p));

module.exports = { openPdfTool };
