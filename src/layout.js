// Ricostruisce l'impaginazione da testo con coordinate: colonne, tabelle, paragrafi, elenchi, figure.
// Funzioni pure (nessuna dipendenza da Electron): si possono provare su dati salvati.
// Coordinate PDF: y cresce verso l'alto; item = { str, x, y (linea di base), size, w, bold, italic }.

const BULLET = /^[•▪●·◦‣]\s*|^[–-]\s+/;
const NUMBERED = /^\d{1,2}[.)]\s/;

const sizeOf = (items) => Math.max(...items.map((i) => i.size));
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)] || 0; };

function groupLines(items) {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - it.y) <= Math.max(1.5, 0.3 * it.size)) last.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

const lineText = (l) => l.items.map((i) => i.str).join('');

// Cerca una "grondaia" verticale libera che separi due colonne di testo che scorre
function detectGutter(lines) {
  if (lines.length < 8) return null;
  const all = lines.flatMap((l) => l.items);
  const minX = Math.min(...all.map((i) => i.x)), maxX = Math.max(...all.map((i) => i.x + i.w));
  const span = maxX - minX;
  if (span < 200) return null;
  const crosses = (l, x) => l.items.some((i) => i.x < x && i.x + i.w > x);
  let best = null, run = null;
  for (let x = minX + 0.3 * span; x <= maxX - 0.3 * span; x += 2) {
    const free = lines.filter((l) => crosses(l, x)).length <= 0.1 * lines.length;
    if (free) { if (!run) run = { x0: x, x1: x }; run.x1 = x; } else { if (run && (!best || run.x1 - run.x0 > best.x1 - best.x0)) best = run; run = null; }
  }
  if (run && (!best || run.x1 - run.x0 > best.x1 - best.x0)) best = run;
  if (!best || best.x1 - best.x0 < 12) return null;
  const mid = (best.x0 + best.x1) / 2;
  const left = lines.filter((l) => l.items.every((i) => i.x + i.w <= mid));
  const right = lines.filter((l) => l.items.every((i) => i.x >= mid));
  if (left.length < 6 || right.length < 6) return null;
  const avg = (ls) => ls.reduce((n, l) => n + lineText(l).length, 0) / ls.length;
  if (avg(left) < 28 || avg(right) < 28) return null; // celle di tabella: brevi
  const ends = left.map((l) => l.items[l.items.length - 1]).map((i) => i.x + i.w);
  if (median(ends) < best.x0 - 0.35 * (best.x0 - minX)) return null; // testo non giustificato verso la grondaia
  return { mid };
}

// Colonne: prima tutta la colonna sinistra, poi la destra; le righe a tutta larghezza spezzano le zone
function readingOrder(lines, gutter) {
  if (!gutter) return lines;
  const out = [];
  let zone = null;
  const flush = () => { if (zone) out.push(...zone.left, ...zone.right); zone = null; };
  for (const l of lines) {
    if (l.items.some((i) => i.x < gutter.mid && i.x + i.w > gutter.mid)) { flush(); out.push(l); continue; }
    zone ||= { left: [], right: [] };
    const L = l.items.filter((i) => i.x + i.w / 2 < gutter.mid), R = l.items.filter((i) => i.x + i.w / 2 >= gutter.mid);
    if (L.length) zone.left.push({ y: l.y, items: L });
    if (R.length) zone.right.push({ y: l.y, items: R });
  }
  flush();
  return out;
}

function addRun(runs, text, it) {
  const last = runs[runs.length - 1];
  if (last && last.bold === it.bold && last.italic === it.italic) last.text += text;
  else runs.push({ text, bold: it.bold, italic: it.italic });
}

// Una riga diventa celle: le lacune larghe separano le colonne di una eventuale tabella
function toCells(line) {
  const size = sizeOf(line.items);
  const gap = Math.max(size * 1.05, 8); // il padding di una cella di tabella è ~16pt, uno spazio tra parole ~3pt
  const cells = [];
  let cur = null;
  for (const it of line.items) {
    const d = cur ? it.x - cur.endX : 0;
    if (!cur || d > gap) { cur = { x: it.x, endX: it.x + it.w, runs: [] }; cells.push(cur); }
    else if (d > size * 0.12 && !it.str.startsWith(' ') && !cur.runs[cur.runs.length - 1].text.endsWith(' ')) addRun(cur.runs, ' ', it);
    addRun(cur.runs, it.str, it);
    cur.endX = it.x + it.w;
  }
  for (const c of cells) {
    c.runs[0].text = c.runs[0].text.replace(/^\s+/, '');
    c.runs[c.runs.length - 1].text = c.runs[c.runs.length - 1].text.replace(/\s+$/, '');
    c.runs = c.runs.filter((r) => r.text);
  }
  return { y: line.y, size, marker: line.items[0].bullet === true, cells: cells.filter((c) => c.runs.length) };
}

// Colonne di tabella = intervalli x occupati dalle celle, uniti se si sovrappongono (regge i numeri allineati a destra)
function columnsOf(cells) {
  const iv = cells.map((c) => [c.x, c.endX]).sort((a, b) => a[0] - b[0]);
  const cols = [];
  for (const [a, b] of iv) {
    const last = cols[cols.length - 1];
    if (last && a <= last.b + 3) last.b = Math.max(last.b, b); else cols.push({ a, b });
  }
  return cols;
}
const colIndex = (cols, cell) => {
  const c = (cell.x + cell.endX) / 2;
  const i = cols.findIndex((k) => c >= k.a - 3 && c <= k.b + 3);
  return i < 0 ? cols.length - 1 : i;
};

// Una vera tabella ha celle allineate (a sinistra o a destra) nella stessa colonna; le lacune casuali di un testo giustificato no
function alignedColumns(rows, cols) {
  const first = rows.map((r) => r.lines[0].cells);
  return cols.every((col, ci) => {
    if (ci === 0) return true;
    const cells = first.map((cs) => cs.find((c) => (c.x + c.endX) / 2 >= col.a - 3 && (c.x + c.endX) / 2 <= col.b + 3)).filter(Boolean);
    if (cells.length < 2) return false;
    const near = (vals) => Math.max(...vals.map((v) => vals.filter((w) => Math.abs(w - v) <= 4).length));
    return Math.max(near(cells.map((c) => c.x)), near(cells.map((c) => c.endX))) >= 0.6 * first.length;
  });
}

function takeTable(L, start) {
  const rows = [{ lines: [L[start]] }];
  let j = start + 1;
  while (j < L.length) {
    const prev = L[j - 1], line = L[j], gap = prev.y - line.y;
    const cols = columnsOf(rows.flatMap((r) => r.lines.flatMap((l) => l.cells)));
    const aligned = line.cells.every((c) => cols.some((k) => c.x >= k.a - 4 && c.x <= k.b + 4));
    if (gap > 0 && gap < prev.size * 1.55 && aligned) rows[rows.length - 1].lines.push(line); // seconda riga di una cella
    else if (line.cells.length >= 2 && gap > 0 && gap <= line.size * 4.5) rows.push({ lines: [line] });
    else break;
    j++;
  }
  if (rows.length < 2 || rows.filter((r) => r.lines[0].cells.length >= 2).length < 2) return null;
  const allCells = rows.flatMap((r) => r.lines.flatMap((l) => l.cells));
  const cols = columnsOf(allCells);
  if (cols.length < 2 || !alignedColumns(rows, cols)) return null;
  const grid = rows.map((r) => {
    const out = cols.map(() => []);
    for (const l of r.lines) for (const c of l.cells) {
      const cell = out[colIndex(cols, c)];
      if (cell.length) cell.push({ text: ' ', bold: false, italic: false });
      cell.push(...c.runs);
    }
    return out;
  });
  const first = rows[0].lines[0], lastLines = rows[rows.length - 1].lines;
  return {
    table: { type: 'table', topY: first.y + first.size, bottomY: lastLines[lastLines.length - 1].y - 2, x0: cols[0].a, x1: cols[cols.length - 1].b, cols, rows: grid, size: first.size },
    next: j,
  };
}

const runsText = (runs) => runs.map((r) => r.text).join('');

function buildBlocks(L) {
  const blocks = [];
  let cur = null;
  const lineRuns = (l) => {
    const runs = [];
    l.cells.forEach((c, i) => { if (i) runs.push({ text: ' ', bold: false, italic: false }); runs.push(...c.runs); });
    return runs;
  };
  for (let i = 0; i < L.length; i++) {
    const l = L[i];
    if (!l.cells.length) continue;
    if (l.cells.length >= 2) {
      const t = takeTable(L, i);
      if (t) { blocks.push(t.table); cur = null; i = t.next - 1; continue; }
    }
    const runs = lineRuns(l);
    const bold = runs.every((r) => r.bold || !r.text.trim());
    const bullet = BULLET.test(runsText(runs)) || l.marker;
    const numbered = NUMBERED.test(runsText(runs));
    // salto verso l'alto = cambio colonna; se la frase riprende in minuscolo, è lo stesso paragrafo
    const jumpUp = cur && l.y > cur.lastY + 1;
    const continues = jumpUp && /^[a-zà-ü]/.test(runsText(runs)) && !/[.!?:;]\s*$/.test(runsText(cur.runs))
      && Math.abs(cur.size - l.size) <= 1 && bold === cur.bold && !bullet && !numbered;
    const newPara = !cur || (jumpUp && !continues) || cur.lastY - l.y > Math.max(l.size, cur.size) * 1.7
      || Math.abs(cur.size - l.size) > 1 || bold !== cur.bold || bullet || numbered;
    if (newPara) {
      cur = { type: 'p', runs: [], size: l.size, bold, topY: l.y + l.size, lastY: l.y, x: l.x ?? l.cells[0].x, bullet: false };
      if (bullet) { cur.bullet = true; runs[0].text = runs[0].text.replace(BULLET, ''); }
      blocks.push(cur);
    } else {
      cur.runs.push({ text: ' ', bold: false, italic: false });
      cur.lastY = l.y;
    }
    cur.runs.push(...runs.filter((r) => r.text));
    cur.lastY = l.y;
  }
  return blocks;
}

// Intestazioni e piè di pagina che si ripetono (numeri di pagina, titoli correnti)
function repeatedMargins(pages) {
  if (pages.length < 2) return pages.map(() => new Set());
  const key = (l) => lineText(l).replace(/\d+/g, '#').trim();
  // solo righe a una cella: una riga di tabella che cade nel margine non è un piè di pagina
  const inMargin = (p, l) => (l.y > p.height * 0.93 || l.y < p.height * 0.07) && toCells(l).cells.length === 1;
  const counts = new Map();
  pages.forEach((p) => new Set(groupLines(p.items.filter((i) => i.str.trim())).filter((l) => inMargin(p, l)).map(key)).forEach((k) => counts.set(k, (counts.get(k) || 0) + 1)));
  return pages.map((p) => new Set(groupLines(p.items.filter((i) => i.str.trim())).filter((l) => inMargin(p, l) && counts.get(key(l)) >= 2).map((l) => l.y)));
}

function layoutPage(page, dropY = new Set()) {
  const lines = groupLines(page.items.filter((i) => i.str.trim() !== '')).filter((l) => !dropY.has(l.y) && lineText(l).trim());
  const ordered = readingOrder(lines, detectGutter(lines));
  const blocks = buildBlocks(ordered.map(toCells));
  const tables = blocks.filter((b) => b.type === 'table');
  for (const f of page.figures || []) {
    const area = f.w * f.h;
    const overlap = tables.reduce((n, t) => {
      const w = Math.max(0, Math.min(f.x + f.w, t.x1 + 6) - Math.max(f.x, t.x0 - 6));
      const h = Math.max(0, Math.min(f.top, t.topY + 6) - Math.max(f.top - f.h, t.bottomY - 6));
      return n + w * h;
    }, 0);
    if (overlap / area > 0.4) continue;
    const at = blocks.findIndex((b) => b.topY < f.top - 1);
    blocks.splice(at < 0 ? blocks.length : at, 0, { type: 'figure', topY: f.top, w: f.w, h: f.h, png: Buffer.from(f.png, 'base64') });
  }
  return blocks;
}

// Un paragrafo spezzato dal cambio pagina si ricompone
function joinAcrossPages(blocks) {
  const out = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (b.type === 'p' && b.startsPage && prev && prev.type === 'p' && !b.bullet
      && !/[.!?:;]\s*$/.test(runsText(prev.runs)) && /^[a-zà-ü]/.test(runsText(b.runs)) && Math.abs(prev.size - b.size) <= 1 && prev.bold === b.bold) {
      prev.runs.push({ text: ' ', bold: false, italic: false }, ...b.runs);
    } else out.push(b);
  }
  return out;
}

function layoutDocument(pages) {
  const drops = repeatedMargins(pages);
  const blocks = [];
  pages.forEach((p, i) => {
    const b = layoutPage(p, drops[i]);
    if (b[0]) b[0].startsPage = true;
    blocks.push(...b);
  });
  const merged = joinAcrossPages(blocks);
  const sizes = [];
  for (const b of merged) if (b.type === 'p') for (let k = 0; k < Math.ceil(runsText(b.runs).length / 20); k++) sizes.push(b.size);
  return { blocks: merged, bodySize: median(sizes) || 11 };
}

module.exports = { layoutDocument, layoutPage, groupLines, detectGutter };
