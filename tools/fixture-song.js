// Brano di prova per la separazione voce / musica: voce sintetica di Windows (SAPI) sopra una base di toni e rumore.
// Restituisce { mix, voice, base } (percorsi) oppure null se la sintesi vocale non è disponibile.
const fs = require('fs'), path = require('path');
const { spawnSync } = require('child_process');
const { FFMPEG } = require('../src/video/ffmpeg');

const sh = (args) => { const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args]); if (r.status) throw new Error(String(r.stderr)); };

function makeSong(d, name = 'brano.mp3') {
  const speech = path.join(d, 'voce.wav');
  const ps = spawnSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${speech}'); $s.Speak('Questa è una prova di separazione della voce dalla musica. Il cantante parla sopra la base strumentale, e il programma deve riuscire a distinguerli.'); $s.Dispose()`]);
  if (ps.status || !fs.existsSync(speech)) return null;
  const voice = path.join(d, 'voce44.wav'), base = path.join(d, 'base.wav'), mix = path.join(d, name);
  sh(['-i', speech, '-ar', '44100', '-ac', '2', voice]);
  sh(['-f', 'lavfi', '-i', 'sine=f=220:d=14,tremolo=f=3:d=.6', '-f', 'lavfi', '-i', 'sine=f=277:d=14', '-f', 'lavfi', '-i', 'sine=f=330:d=14', '-f', 'lavfi', '-i', 'anoisesrc=d=14:c=pink:a=0.5,highpass=f=3000,tremolo=f=8:d=1',
    '-filter_complex', '[0][1][2]amix=inputs=3,volume=2.2[a];[3]volume=.35[d];[a][d]amix=inputs=2:normalize=0,aformat=sample_rates=44100:channel_layouts=stereo[m]', '-map', '[m]', base]);
  sh(['-i', base, '-i', voice, '-filter_complex', '[1]volume=1.5[v];[0][v]amix=inputs=2:normalize=0:duration=longest[o]', '-map', '[o]', '-ar', '44100', '-ac', '2', '-metadata', 'title=Brano di prova', '-metadata', 'artist=Test', mix]);
  return { mix, voice, base };
}
module.exports = { makeSong };
