// Operazioni sulla maschera (canale alfa): usate sia dall'anteprima nella finestra sia dal salvataggio a piena
// risoluzione, così quello che vedi è quello che viene salvato. Funziona in Node e nel browser.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AlphaOps = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // Media su finestra (2r+1)² con bordi normalizzati (come cv2.blur), in tempo costante per raggio
  function boxBlur(src, w, h, r, dst) {
    dst = dst || new Float32Array(w * h);
    if (r <= 0) { dst.set(src); return dst; }
    const tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
      for (let x = 0; x < w; x++) {
        if (x > 0) { if (x + r < w) sum += src[row + x + r]; if (x - r - 1 >= 0) sum -= src[row + x - r - 1]; }
        tmp[row + x] = sum / (Math.min(w - 1, x + r) - Math.max(0, x - r) + 1);
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
      for (let y = 0; y < h; y++) {
        if (y > 0) { if (y + r < h) sum += tmp[(y + r) * w + x]; if (y - r - 1 >= 0) sum -= tmp[(y - r - 1) * w + x]; }
        dst[y * w + x] = sum / (Math.min(h - 1, y + r) - Math.max(0, y - r) + 1);
      }
    }
    return dst;
  }

  // Filtro guidato (He et al.): fa seguire alla maschera p i bordi veri dell'immagine guida I (valori 0..1)
  function guidedFilter(I, p, w, h, r, eps) {
    const n = w * h;
    const meanI = boxBlur(I, w, h, r), meanP = boxBlur(p, w, h, r);
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = I[i] * I[i];
    const corrI = boxBlur(t, w, h, r);
    for (let i = 0; i < n; i++) t[i] = I[i] * p[i];
    const corrIp = boxBlur(t, w, h, r);
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const varI = corrI[i] - meanI[i] * meanI[i], cov = corrIp[i] - meanI[i] * meanP[i];
      a[i] = cov / (varI + eps);
      b[i] = meanP[i] - a[i] * meanI[i];
    }
    const meanA = boxBlur(a, w, h, r), meanB = boxBlur(b, w, h, r);
    const q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, meanA[i] * I[i] + meanB[i]));
    return q;
  }

  // Sfocatura gaussiana approssimata con 3 passaggi di media; sigma in pixel
  function blurAlpha(a, w, h, sigma) {
    if (sigma <= 0.05) return a;
    const r = Math.max(1, Math.round(sigma * 0.8));
    let f = Float32Array.from(a);
    for (let k = 0; k < 3; k++) f = boxBlur(f, w, h, r);
    const out = new Uint8Array(a.length);
    for (let i = 0; i < out.length; i++) out[i] = Math.round(f[i]);
    return out;
  }

  // Espande (r > 0) o restringe (r < 0) il bordo del soggetto di |r| pixel (finestra quadrata, separabile)
  function shiftEdge(a, w, h, r) {
    const R = Math.round(Math.abs(r));
    if (!R) return a;
    const grow = r > 0;
    const pick = grow ? Math.max : Math.min;
    const pass = (src, horizontal) => {
      const dst = new Uint8Array(src.length);
      const len = horizontal ? w : h, lines = horizontal ? h : w, stride = horizontal ? 1 : w, lineStride = horizontal ? w : 1;
      for (let l = 0; l < lines; l++) {
        const base = l * lineStride;
        for (let i = 0; i < len; i++) {
          let v = grow ? 0 : 255;
          for (let k = Math.max(0, i - R); k <= Math.min(len - 1, i + R); k++) v = pick(v, src[base + k * stride]);
          dst[base + i * stride] = v;
        }
      }
      return dst;
    };
    return pass(pass(a, true), false);
  }

  // Parametri di rifinitura: edge (px, + espande / - restringe) e soft (px di sfumatura); scale riporta i px a un'altra risoluzione
  function adjust(base, w, h, edge, soft, scale = 1) {
    let a = shiftEdge(base, w, h, edge * scale);
    a = blurAlpha(a, w, h, soft * scale);
    return a;
  }

  // Pennello: keep = quanto ripristinare (0..255), remove = quanto cancellare; il risultato non distrugge la maschera di base
  function compose(adjusted, keep, remove, out) {
    out = out || new Uint8Array(adjusted.length);
    for (let i = 0; i < adjusted.length; i++) {
      let a = adjusted[i];
      if (keep[i]) a += ((255 - a) * keep[i]) / 255;
      if (remove[i]) a = (a * (255 - remove[i])) / 255;
      out[i] = a + 0.5;
    }
    return out;
  }

  return { boxBlur, guidedFilter, blurAlpha, shiftEdge, adjust, compose };
});
