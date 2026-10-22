// Preferenze dell'utente (userData/prefs.json): tasto di attivazione, ultimo formato scelto negli strumenti
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'prefs.json');
function read() { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { return {}; } }
function update(fn) { try { const p = read(); fn(p); fs.writeFileSync(file(), JSON.stringify(p, null, 2)); } catch {} }

module.exports = { read, update };
