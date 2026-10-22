// Prepara i modelli di rimozione sfondo in models/ (si può rilanciare: salta quelli già presenti e verificati)
//  - isnet_medium.onnx  (Veloce)  modello ISNet (Apache-2.0, https://github.com/xuebinqin/DIS), preso dal pacchetto npm
//                                 @imgly/background-removal-node, che si scarica solo qui in una cartella temporanea
//  - birefnet_lite.onnx (Preciso) scaricato da Hugging Face, onnx-community/BiRefNet_lite-ONNX (MIT)
// Ogni file è verificato con il suo SHA-256: se non coincide viene scartato.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync, execSync } = require('child_process');

const DIR = path.join(__dirname, '..', 'models');
fs.mkdirSync(DIR, { recursive: true });

const MODELS = {
  'isnet_medium.onnx': { sha256: 'b6e8497ba978a6f5fbb647e419d2696cd80df5a23cb6a8ea532021911bd76acb' },
  'birefnet_lite.onnx': { sha256: '5600024376f572a557870a5eb0afb1e5961636bef4e1e22132025467d0f03333', url: 'https://huggingface.co/onnx-community/BiRefNet_lite-ONNX/resolve/main/onnx/model.onnx' },
};
const IMGLY = '@imgly/background-removal-node@1.4.5';

const sha256 = (file) => new Promise((resolve, reject) => {
  const h = crypto.createHash('sha256');
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});
const verified = async (file, want) => fs.existsSync(file) && (await sha256(file)) === want;

function download(url, dest, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'dragwheel' } }, (r) => {
      if ([301, 302, 307, 308].includes(r.statusCode) && redirects) { r.resume(); return resolve(download(new URL(r.headers.location, url).href, dest, redirects - 1)); }
      if (r.statusCode !== 200) { r.resume(); return reject(new Error(`HTTP ${r.statusCode}`)); }
      const f = fs.createWriteStream(dest);
      r.pipe(f);
      f.on('finish', () => f.close(resolve));
      f.on('error', reject);
    }).on('error', reject);
  });
}

// Il modello è diviso in blocchi dentro il pacchetto: si scarica il pacchetto (npm pack), si estrae e si ricompone
function extractIsnet(out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-isnet-'));
  try {
    const tgz = execSync(`npm pack ${IMGLY} --silent --pack-destination "${tmp}"`, { encoding: 'utf8' }).trim().split(/\r?\n/).pop();
    execFileSync('tar', ['-xzf', tgz], { cwd: tmp });   // percorso relativo: tar GNU scambia "C:" per un computer remoto
    const dist = path.join(tmp, 'package', 'dist');
    const res = JSON.parse(fs.readFileSync(path.join(dist, 'resources.json'), 'utf8'))['/models/medium'];
    const fd = fs.openSync(out + '.part', 'w');
    for (const c of res.chunks) fs.writeSync(fd, fs.readFileSync(path.join(dist, c.hash)));
    fs.closeSync(fd);
    fs.renameSync(out + '.part', out);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

(async () => {
  for (const [name, m] of Object.entries(MODELS)) {
    const out = path.join(DIR, name);
    if (await verified(out, m.sha256)) { console.log(`${name} già presente e verificato`); continue; }
    console.log(`preparo ${name}…`);
    if (m.url) await download(m.url, out + '.part').then(() => fs.renameSync(out + '.part', out)); else extractIsnet(out);
    if (!(await verified(out, m.sha256))) { fs.rmSync(out, { force: true }); throw new Error(`${name}: il file non corrisponde al checksum atteso, scartato`); }
    console.log(`${name} pronto (${(fs.statSync(out).size / 1e6).toFixed(1)} MB, verificato)`);
  }
})().catch((e) => { console.error('ERRORE', e.message); process.exit(1); });
