// "Vetro" della ruota: una foto dello schermo scattata un attimo prima che la ruota compaia. La ruota la mostra sfocata
// dietro la cornice, come la trasparenza smerigliata di macOS (una finestra circolare non può usare la sfocatura di Windows).
// La foto resta in memoria pochi secondi; alla ruota arriva solo il ritaglio sotto di essa.
const { desktopCapturer, screen } = require('electron');

const MAX_AGE = 6000;
let shot = null, inflight = null;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Avvia lo scatto dello schermo (quello del cursore); se ne è già in corso uno non ne parte un altro
function capture() {
  if (inflight) return inflight;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const f = display.scaleFactor;
  inflight = desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(display.size.width * f), height: Math.round(display.size.height * f) } })
    .then((srcs) => {
      const s = srcs.find((x) => String(x.display_id) === String(display.id)) || srcs[0];
      shot = s && !s.thumbnail.isEmpty() ? { image: s.thumbnail, display, at: Date.now() } : null;
      const mine = shot;
      setTimeout(() => { if (shot === mine) shot = null; }, MAX_AGE + 500).unref(); // la foto non resta in memoria se non serve
    })
    .catch(() => { shot = null; })
    .finally(() => { inflight = null; });
  return inflight;
}

// Aspetta (al massimo maxWait ms) uno scatto in corso e lo restituisce se è recente
async function latest(maxWait = 160) {
  if (inflight) await Promise.race([inflight, wait(maxWait)]);
  return shot && Date.now() - shot.at < MAX_AGE ? shot : null;
}

// Ritaglio della foto sotto la finestra (bounds in coordinate logiche dello schermo) come data URL JPEG
function cropUnder(s, bounds) {
  const f = s.display.scaleFactor, size = s.image.getSize();
  const x = Math.round((bounds.x - s.display.bounds.x) * f), y = Math.round((bounds.y - s.display.bounds.y) * f);
  const w = Math.round(bounds.width * f), h = Math.round(bounds.height * f);
  if (x < 0 || y < 0 || x + w > size.width || y + h > size.height) return null; // la finestra non sta tutta in questo schermo
  return `data:image/jpeg;base64,${s.image.crop({ x, y, width: w, height: h }).toJPEG(82).toString('base64')}`;
}

function discard() { shot = null; }

module.exports = { capture, latest, cropUnder, discard };
