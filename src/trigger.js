// Quando mostrare la ruota: tasto sinistro premuto + tasto di attivazione premuto + il mouse si è mosso (trascinamento).
// Logica pura, alimentata dagli eventi di uiohook (vedi main.js), così si può provare senza tastiera e mouse veri.
const KEYS = {
  space: { label: 'Barra spaziatrice', codes: [57] },
  shift: { label: 'Shift', codes: [42, 54] },
  ctrl: { label: 'Ctrl', codes: [29, 3613] },
  alt: { label: 'Alt', codes: [56, 3640] },
};

function createDragTrigger({ onShow, onRelease, onArm = () => {}, isVisible, key = 'space', threshold = 12 }) {
  let codes = new Set(KEYS[key].codes), held = false, down = null, last = null, armed = false;
  // "Armato" = tasto sinistro e tasto di attivazione già premuti, anche se il mouse non si è ancora mosso: serve a preparare la ruota in anticipo
  const arm = () => { if (down && held && !armed) { armed = true; onArm(); } };
  // Il tasto può arrivare prima o dopo l'inizio del trascinamento: si controlla a ogni evento utile
  const maybeShow = () => {
    if (down && held && last && !isVisible() && Math.hypot(last.x - down.x, last.y - down.y) > threshold) onShow();
  };
  return {
    setKey(k) { if (KEYS[k]) { codes = new Set(KEYS[k].codes); held = false; } },
    keydown(e) { if (codes.has(e.keycode)) { held = true; arm(); maybeShow(); } },
    keyup(e) { if (codes.has(e.keycode)) { held = false; armed = false; } },
    mousedown(e) { if (e.button === 1) { down = { x: e.x, y: e.y }; last = { x: e.x, y: e.y }; arm(); } },
    mouseup(e) { if (e.button === 1) { down = null; armed = false; onRelease(); } },
    mousemove(e) { last = { x: e.x, y: e.y }; maybeShow(); },
  };
}

module.exports = { KEYS, createDragTrigger };
