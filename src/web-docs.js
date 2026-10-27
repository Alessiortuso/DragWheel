// Documentazione: Markdown -> HTML (pagina unica con stile) o PDF, HTML -> PDF.
const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const { uniquePath } = require('./converter');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const CSS = `
  :root { color-scheme: light; }
  body { font: 15px/1.6 "Segoe UI", -apple-system, Helvetica, Arial, sans-serif; color: #1f2328; max-width: 860px; margin: 0 auto; padding: 32px 24px 64px; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.5em 0 .6em; font-weight: 650; }
  h1 { font-size: 2em; padding-bottom: .3em; border-bottom: 1px solid #d8dee4; } h2 { font-size: 1.5em; padding-bottom: .3em; border-bottom: 1px solid #d8dee4; }
  h1:first-child { margin-top: 0; }
  a { color: #0969da; } img { max-width: 100%; }
  code, pre, kbd { font-family: "Cascadia Mono", Consolas, "Courier New", monospace; font-size: .88em; }
  code { background: #eff1f3; padding: .15em .35em; border-radius: 4px; }
  pre { background: #f6f8fa; border: 1px solid #e3e6ea; padding: 12px 14px; border-radius: 8px; overflow: auto; line-height: 1.45; }
  pre code { background: none; padding: 0; font-size: 1em; }
  blockquote { margin: 0; padding: 0 1em; color: #59636e; border-left: .25em solid #d1d9e0; }
  table { border-collapse: collapse; margin: 1em 0; display: block; overflow: auto; } th, td { border: 1px solid #d1d9e0; padding: 6px 12px; } th { background: #f6f8fa; font-weight: 600; } tr:nth-child(2n) td { background: #fafbfc; }
  hr { border: 0; border-top: 1px solid #d1d9e0; margin: 2em 0; }
  li > input[type=checkbox] { margin-right: .4em; }
  @media print { body { max-width: none; padding: 0; font-size: 11pt; } pre, table, img, blockquote { break-inside: avoid; } h1, h2, h3 { break-after: avoid; } a { color: inherit; } }
`;

// Il "front matter" YAML in cima (--- ... ---) non si stampa; il suo title, se c'è, diventa il titolo
function frontMatter(md) {
  const m = /^---\r?\n([\s\S]*?)\r?\n(---|\.\.\.)\r?\n/.exec(md);
  if (!m) return { body: md, title: null };
  const t = /^title:\s*["']?(.+?)["']?\s*$/m.exec(m[1]);
  return { body: md.slice(m[0].length), title: t ? t[1] : null };
}

function markdownToHtml(md, fallbackTitle) {
  const { body, title: fm } = frontMatter(md.replace(/^﻿/, ''));
  const html = marked.parse(body, { gfm: true, breaks: false });
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = fm || (h1 ? h1[1].replace(/<[^>]+>/g, '') : fallbackTitle);
  return `<!doctype html>\n<html lang="it">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${esc(title)}</title>\n<style>${CSS}</style>\n</head>\n<body>\n${html}</body>\n</html>\n`;
}

// file: .md/.markdown/.html/.htm; target: 'html' | 'pdf'
async function convert(file, target) {
  const ext = path.extname(file).slice(1).toLowerCase(), dir = path.dirname(file), base = path.basename(file, path.extname(file));
  const isMd = ext === 'md' || ext === 'markdown';
  const notes = [];
  if (target === 'html') {
    if (!isMd) throw new Error('il file è già HTML');
    const out = uniquePath(dir, base, 'html');
    fs.writeFileSync(out, markdownToHtml(fs.readFileSync(file, 'utf8'), base), 'utf8');
    return { outputs: [out], notes };
  }
  if (target === 'pdf') {
    const { htmlToPdf, htmlFileToPdf } = require('./print-pdf');
    const out = uniquePath(dir, base, 'pdf');
    if (isMd) await htmlToPdf(markdownToHtml(fs.readFileSync(file, 'utf8'), base), out, { base: dir });
    else { await htmlFileToPdf(file, out); notes.push('JavaScript non viene eseguito e le risorse online non vengono scaricate: le pagine che dipendono da questi possono apparire incomplete.'); }
    return { outputs: [out], notes };
  }
  throw new Error(`formato di uscita sconosciuto: ${target}`);
}

module.exports = { convert, markdownToHtml };
