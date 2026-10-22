// Selettore del formato di salvataggio, condiviso dalle finestre degli strumenti.
// FormatPicker.mount(elemento, { withSame }) -> { get(), set({ format, quality, background }) }
(function () {
  const FORMATS = ['png', 'jpg', 'webp', 'avif', 'tiff', 'bmp'];
  const QUALITY = { jpg: 92, webp: 90, avif: 60 }; // formati con compressione regolabile
  const NO_ALPHA = new Set(['jpg', 'bmp']); // senza trasparenza: serve un colore di riempimento

  function mount(el, { withSame = false } = {}) {
    el.classList.add('fp');
    el.innerHTML = `
      <label>Formato <select class="fp-fmt">${withSame ? '<option value="same">Come l’originale</option>' : ''}${FORMATS.map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('')}</select></label>
      <label class="fp-q" hidden>Qualità <input type="range" class="fp-qr" min="40" max="100" step="1"><output class="fp-qo"></output></label>
      <label class="fp-bg" hidden title="JPG e BMP non hanno trasparenza: le zone trasparenti vengono riempite con questo colore">Riempi trasparenza con <input type="color" class="fp-bgc" value="#ffffff"></label>`;
    const sel = el.querySelector('.fp-fmt'), qWrap = el.querySelector('.fp-q'), qr = el.querySelector('.fp-qr'), qo = el.querySelector('.fp-qo');
    const bgWrap = el.querySelector('.fp-bg'), bgc = el.querySelector('.fp-bgc');

    function refresh(resetQuality) {
      const f = sel.value;
      qWrap.hidden = !(f in QUALITY);
      bgWrap.hidden = !NO_ALPHA.has(f);
      if (f in QUALITY && resetQuality) qr.value = QUALITY[f];
      qo.textContent = qr.value;
    }
    sel.addEventListener('change', () => refresh(true));
    qr.addEventListener('input', () => { qo.textContent = qr.value; });
    refresh(true);

    return {
      get() {
        const f = sel.value;
        return { format: f === 'same' ? null : f, quality: f in QUALITY ? +qr.value : undefined, background: bgc.value };
      },
      set(o) {
        if (!o) return;
        const f = o.format || (withSame ? 'same' : 'png');
        if ([...sel.options].some((x) => x.value === f)) sel.value = f;
        refresh(true);
        if (o.quality && sel.value in QUALITY) { qr.value = o.quality; qo.textContent = qr.value; }
        if (o.background) bgc.value = o.background;
      },
    };
  }
  window.FormatPicker = { mount };
})();
