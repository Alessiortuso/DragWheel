// Genera l'icona dell'app (build/icon.png, 512x512): una ruota a petali. Uso: node tools/make-icon.js
const fs = require('fs'), path = require('path');
const sharp = require('sharp');

const C = 256, petals = 6, pieces = [];
const pt = (r, deg) => [C + r * Math.cos((deg * Math.PI) / 180), C + r * Math.sin((deg * Math.PI) / 180)];
for (let i = 0; i < petals; i++) {
  const a0 = i * 60 + 4, a1 = i * 60 + 56, [x0, y0] = pt(210, a0), [x1, y1] = pt(210, a1), [x2, y2] = pt(112, a1), [x3, y3] = pt(112, a0);
  pieces.push(`<path d="M${x0} ${y0} A210 210 0 0 1 ${x1} ${y1} L${x2} ${y2} A112 112 0 0 0 ${x3} ${y3} Z" fill="url(#p)" stroke="#fff3df" stroke-opacity=".7" stroke-width="5" stroke-linejoin="round"/>`);
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7cf8e"/><stop offset="1" stop-color="#f1a98f"/></linearGradient>
    <radialGradient id="d" cx=".5" cy=".4" r=".7"><stop offset="0" stop-color="#e98a3c"/><stop offset="1" stop-color="#c9602a"/></radialGradient>
  </defs>
  <circle cx="${C}" cy="${C}" r="244" fill="#d9a85a" stroke="#fff3df" stroke-width="6"/>
  ${pieces.join('\n  ')}
  <circle cx="${C}" cy="${C}" r="92" fill="url(#d)" stroke="#fff3df" stroke-width="6"/>
  <circle cx="${C}" cy="${C}" r="24" fill="#fff3df"/>
</svg>`;
sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, '..', 'build', 'icon.png')).then(() => console.log('build/icon.png creata'));
