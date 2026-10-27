// Cartelle e file -> ZIP, ZIP -> cartella. Lettura e scrittura in streaming (anche archivi di molti GB, ZIP64).
// L'estrazione rifiuta i nomi che uscirebbero dalla cartella di destinazione (percorsi assoluti, "..").
const fs = require('fs');
const path = require('path');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { uniquePath } = require('./converter');

function uniqueDir(parent, name) {
  let p = path.join(parent, name);
  for (let i = 1; fs.existsSync(p); i++) p = path.join(parent, `${name} (${i})`);
  return p;
}

// paths: cartelle e/o file (anche insieme). Una sola cartella -> "Cartella.zip" accanto, con la cartella dentro;
// più elementi -> "Archivio.zip" nella cartella del primo, ciascuno alla radice dell'archivio
async function zipPaths(paths, { onProgress } = {}) {
  const parent = path.dirname(paths[0]);
  const single = paths.length === 1;
  const out = uniquePath(parent, single ? path.basename(paths[0], fs.statSync(paths[0]).isDirectory() ? '' : path.extname(paths[0])) : 'Archivio', 'zip');
  const zip = new yazl.ZipFile();
  let files = 0, bytes = 0, skipped = 0;
  const add = (full, name) => {
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) { skipped++; return; } // collegamenti e giunzioni: niente cicli, niente file fuori dalla cartella
    if (path.resolve(full) === path.resolve(out)) return;
    if (st.isDirectory()) {
      const kids = fs.readdirSync(full);
      if (!kids.length) zip.addEmptyDirectory(name, { mtime: st.mtime });
      for (const k of kids) add(path.join(full, k), `${name}/${k}`);
    } else if (st.isFile()) {
      zip.addFile(full, name, { mtime: st.mtime, compress: !/\.(zip|7z|rar|gz|jpe?g|png|webp|avif|mp4|mkv|mov|webm|mp3|m4a|ogg|opus|docx|xlsx|pptx)$/i.test(name) });
      files++; bytes += st.size;
    } else skipped++;
  };
  for (const p of paths) add(p, path.basename(p));
  if (!files && !paths.some((p) => fs.statSync(p).isDirectory())) throw new Error('niente da comprimere');
  await new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(out);
    zip.outputStream.on('error', reject).pipe(ws).on('close', resolve).on('error', reject);
    let done = 0;
    if (onProgress) zip.outputStream.on('data', (c) => { done += c.length; onProgress(Math.min(1, done / Math.max(1, bytes))); });
    zip.end();
  }).catch((e) => { fs.rmSync(out, { force: true }); throw new Error(/EBUSY|EPERM|EACCES/.test(e.code || e.message) ? `un file è bloccato o non leggibile: ${e.path || e.message}` : e.message); });
  const notes = [`${files} file, ${(bytes / 1048576).toFixed(1).replace('.', ',')} MB prima della compressione.`];
  if (skipped) notes.push(`${skipped} collegamenti o elementi speciali non inclusi.`);
  return { outputs: [out], notes };
}

const openZip = (file) => new Promise((res, rej) => yauzl.open(file, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: false }, (e, z) => (e ? rej(e) : res(z))));

// ZIP -> cartella accanto. Se tutto l'archivio sta in una sola cartella, si estrae quella (senza doppio livello)
async function extract(file) {
  // prima passata: nomi delle voci (per scegliere la destinazione)
  let z = await openZip(file).catch((e) => { throw new Error(`ZIP non leggibile: ${e.message}`); });
  const names = [];
  await new Promise((res, rej) => { z.on('entry', (e) => { names.push(e.fileName); z.readEntry(); }).on('end', res).on('error', rej); z.readEntry(); })
    .catch((e) => { throw new Error(/relative path|absolute path/i.test(e.message) ? 'l’archivio contiene percorsi che escono dalla cartella: estrazione rifiutata per sicurezza' : `ZIP non leggibile: ${e.message}`); });
  z.close();
  if (!names.length) throw new Error('l’archivio è vuoto');
  const tops = new Set(names.map((n) => n.split('/')[0]));
  const oneRoot = tops.size === 1 && names.every((n) => n.includes('/'));
  const root = [...tops][0];
  const dest = uniqueDir(path.dirname(file), oneRoot ? root : path.basename(file, path.extname(file)));
  const strip = (n) => (oneRoot ? n.slice(root.length + 1) : n);

  z = await openZip(file);
  let files = 0, encrypted = 0;
  try {
    await new Promise((resolve, reject) => {
      z.on('error', reject).on('end', resolve);
      z.on('entry', (e) => {
        const rel = strip(e.fileName);
        const target = path.resolve(dest, rel);
        if (!rel || (target !== dest && !target.startsWith(dest + path.sep))) { z.readEntry(); return; } // fuori dalla destinazione: ignorata
        if (/\/$/.test(e.fileName)) { fs.mkdirSync(target, { recursive: true }); z.readEntry(); return; }
        if (e.isEncrypted()) { encrypted++; z.readEntry(); return; }
        fs.mkdirSync(path.dirname(target), { recursive: true });
        z.openReadStream(e, (err, rs) => {
          if (err) return reject(err);
          const ws = fs.createWriteStream(target);
          rs.on('error', reject); ws.on('error', reject);
          ws.on('close', () => { try { const t = e.getLastModDate(); fs.utimesSync(target, t, t); } catch {} files++; z.readEntry(); });
          rs.pipe(ws);
        });
      });
      z.readEntry();
    });
  } catch (e) {
    throw new Error(`estrazione interrotta: ${e.message}`);
  } finally { z.close(); }
  if (encrypted && !files) { fs.rmSync(dest, { recursive: true, force: true }); throw new Error('l’archivio è protetto da password: non supportato'); }
  const notes = [`${files} file estratti.`];
  if (encrypted) notes.push(`${encrypted} file protetti da password non estratti.`);
  return { outputs: [dest], notes };
}

module.exports = { zipPaths, extract };
