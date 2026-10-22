// Aspetto delle finestre di lavoro: vetro smerigliato di Windows 11 (acrilico) con barra del titolo integrata,
// come le finestre semitrasparenti di macOS. Con il tema chiaro l'acrilico lascia trasparire i colori dello sfondo.
const { nativeTheme } = require('electron');

nativeTheme.themeSource = 'light';

const glassOptions = () => ({
  backgroundMaterial: 'acrylic',
  backgroundColor: '#00000000',
  titleBarStyle: 'hidden',
  titleBarOverlay: { color: '#00000000', symbolColor: '#2b1006', height: 40 }, // pulsanti di sistema sopra il contenuto
});

module.exports = { glassOptions };
