// Dalla pagina "come la si vede" (punti, origine in alto a sinistra, rotazione /Rotate già applicata: è lo spazio
// in cui lavora l'editor) alle coordinate PDF (origine in basso a sinistra del CropBox, pagina non ruotata).

const rotationOf = (page) => (((page.getRotation().angle % 360) + 360) % 360);

function displaySize(page) {
  const { width, height } = page.getCropBox();
  return rotationOf(page) % 180 ? { width: height, height: width } : { width, height };
}

function toPdfPoint(page, dx, dy) {
  const { x: x0, y: y0, width: W, height: H } = page.getCropBox();
  switch (rotationOf(page)) {
    case 90: return [x0 + dy, y0 + dx];
    case 180: return [x0 + W - dx, y0 + dy];
    case 270: return [x0 + W - dy, y0 + H - dx];
    default: return [x0 + dx, y0 + H - dy];
  }
}

// rettangolo { x, y, w, h } -> [x1, y1, x2, y2] in coordinate PDF
function toPdfRect(page, r) {
  const [ax, ay] = toPdfPoint(page, r.x, r.y), [bx, by] = toPdfPoint(page, r.x + r.w, r.y + r.h);
  return [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
}

module.exports = { rotationOf, displaySize, toPdfPoint, toPdfRect };
