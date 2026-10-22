// Prova la logica del tasto di attivazione con eventi simulati. Uso: node tools/test-trigger.js
const { createDragTrigger, KEYS } = require('../src/trigger');
let fail = 0;
const ok = (n, c) => { console.log((c ? 'OK      ' : 'FALLITO ') + n); if (!c) fail++; };
const SPACE = 57, SHIFT = 42, CTRL = 29;
function make(key) {
  const log = { shown: 0, released: 0, armed: 0, visible: false };
  const t = createDragTrigger({ key, isVisible: () => log.visible, onArm: () => { log.armed++; }, onShow: () => { log.shown++; log.visible = true; }, onRelease: () => { log.released++; log.visible = false; } });
  return { t, log };
}
const press = (t, x, y) => t.mousedown({ button: 1, x, y });
const move = (t, x, y) => t.mousemove({ x, y });

{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); press(t, 100, 100); move(t, 160, 100);
  ok('spazio premuto prima, poi trascino -> ruota', log.shown === 1); }
{ const { t, log } = make('space'); press(t, 100, 100); move(t, 160, 100);
  ok('trascino senza spazio -> niente', log.shown === 0);
  t.keydown({ keycode: SPACE }); ok('premo spazio a trascinamento già iniziato (mouse fermo) -> ruota subito', log.shown === 1); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); press(t, 100, 100); move(t, 105, 103);
  ok('movimento sotto la soglia (12 px) -> niente', log.shown === 0); move(t, 130, 100); ok('oltre la soglia -> ruota', log.shown === 1); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); move(t, 500, 500); move(t, 700, 700);
  ok('spazio premuto senza tasto del mouse -> niente', log.shown === 0); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); t.keydown({ keycode: SPACE }); t.keydown({ keycode: SPACE }); press(t, 0, 0); move(t, 80, 0); move(t, 90, 0);
  ok('ripetizione automatica del tasto: la ruota compare una volta sola', log.shown === 1); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); t.keyup({ keycode: SPACE }); press(t, 0, 0); move(t, 80, 0);
  ok('spazio rilasciato prima -> niente', log.shown === 0); }
{ const { t, log } = make('space'); t.keydown({ keycode: SHIFT }); press(t, 0, 0); move(t, 80, 0);
  ok('con "spazio" scelto, Shift non attiva più nulla', log.shown === 0); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); press(t, 0, 0); move(t, 80, 0); t.mouseup({ button: 1 });
  ok('rilascio del mouse -> la ruota si chiude', log.released === 1 && !log.visible);
  move(t, 300, 0); ok('dopo il rilascio i movimenti non riaprono la ruota', log.shown === 1); }
{ const { t, log } = make('space'); t.setKey('shift'); t.keydown({ keycode: SHIFT }); press(t, 0, 0); move(t, 80, 0);
  ok('cambio tasto a Shift al volo', log.shown === 1); t.mouseup({ button: 1 }); t.keyup({ keycode: SHIFT });
  t.setKey('space'); t.keydown({ keycode: SHIFT }); press(t, 0, 0); move(t, 80, 0); ok('e di nuovo a Spazio', log.shown === 1); }
{ const { t, log } = make('ctrl'); t.keydown({ keycode: 3613 }); press(t, 0, 0); move(t, 80, 0); ok('Ctrl destro (3613) funziona', log.shown === 1); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); t.mousedown({ button: 2, x: 0, y: 0 }); move(t, 80, 0);
  ok('il tasto destro del mouse non conta', log.shown === 0); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); press(t, 0, 0);
  ok('scatto anticipato: spazio poi tasto mouse -> armato (mouse fermo, ruota non ancora visibile)', log.armed === 1 && log.shown === 0); }
{ const { t, log } = make('space'); press(t, 0, 0); t.keydown({ keycode: SPACE });
  ok('scatto anticipato: tasto mouse poi spazio -> armato', log.armed === 1); }
{ const { t, log } = make('space'); t.keydown({ keycode: SPACE }); t.keydown({ keycode: SPACE }); press(t, 0, 0); t.keydown({ keycode: SPACE });
  ok('ripetizione del tasto: armato una volta sola', log.armed === 1);
  t.mouseup({ button: 1 }); press(t, 0, 0); ok('nuovo trascinamento -> armato di nuovo', log.armed === 2); }
{ const { t, log } = make('space'); press(t, 0, 0); move(t, 100, 100); ok('senza tasto non si arma', log.armed === 0); }
console.log(Object.entries(KEYS).map(([k, v]) => `${k}=${v.codes}`).join(' '));
process.exit(fail ? 1 : 0);
