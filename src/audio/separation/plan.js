// Nomi dei file prodotti dalla separazione voce / musica
const path = require('path');
const { uniquePath } = require('../../converter');
const { TARGETS: FORMATS } = require('../codecs');

const LABELS = { vocals: 'voce', music: 'musica', drums: 'batteria', bass: 'basso', other: 'altro' };
const ORDER = ['vocals', 'music', 'drums', 'bass', 'other'];

// options: { targets: ['vocals','music',...], format: 'same' | 'mp3' | ..., bitrate, bitDepth }
function plan(file, options = {}) {
  const targets = ORDER.filter((t) => (options.targets || []).includes(t));
  if (!targets.length) throw new Error('scegli almeno un risultato (voce, musica…)');
  const e = path.extname(file).slice(1).toLowerCase();
  const same = ['m4a', 'm4b', 'mp4', 'aac'].includes(e) ? 'm4a' : e === 'oga' ? 'ogg' : FORMATS.includes(e) ? e : 'mp3';
  const format = !options.format || options.format === 'same' ? same : options.format;
  if (!FORMATS.includes(format)) throw new Error('formato di uscita sconosciuto');
  const dir = path.dirname(file), base = path.basename(file, path.extname(file)), outputs = {};
  for (const t of targets) outputs[t] = uniquePath(dir, `${base} (${LABELS[t]})`, format);
  return { file, targets, format, bitrate: +options.bitrate || 0, bitDepth: +options.bitDepth || 16, outputs, list: targets.map((t) => outputs[t]) };
}
module.exports = { plan };
