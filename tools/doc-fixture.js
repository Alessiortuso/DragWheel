// Documenti Word di prova (titolo, testo spezzato in più parti, commento, modifiche registrate, elenco, tabella, foto, intestazione)
const path = require('path'), fs = require('fs');
const sharp = require('sharp');
const D = require('docx');

async function makeDoc(d, name, { title = 'Contratto', big = true } = {}) {
  // foto "vera": rumore, così il JPEG pesa e la compressione si vede
  const w = 2400, h = 1600, raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (Math.sin(i / 9000) * 60 + 128 + Math.random() * 60) & 255;
  const jpg = big ? await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 95 }).toBuffer() : await sharp({ create: { width: 200, height: 100, channels: 3, background: '#39c' } }).jpeg().toBuffer();
  const para = (children, opts = {}) => new D.Paragraph({ children, ...opts });
  const doc = new D.Document({
    creator: 'Mario Rossi', lastModifiedBy: 'Mario Rossi', title,
    comments: { children: [{ id: 0, author: 'Anna', date: new Date(), children: [para([new D.TextRun('Controllare la data')])] }] },
    numbering: { config: [{ reference: 'b', levels: [{ level: 0, format: D.LevelFormat.BULLET, text: '•', alignment: D.AlignmentType.LEFT }] }] },
    sections: [{
      headers: { default: new D.Header({ children: [para([new D.TextRun('Intestazione Cliente')])] }) },
      children: [
        para([new D.TextRun({ text: title, bold: true, size: 40 })], { heading: D.HeadingLevel.HEADING_1 }),
        para([new D.TextRun('Gentile '), new D.TextRun({ text: 'Clie', bold: true }), new D.TextRun({ text: 'nte', bold: true }), new D.TextRun(', ecco il preventivo. Il cliente paga il 30%.')]), // "Cliente" spezzato su più parti
        para([new D.CommentRangeStart(0), new D.TextRun('Scadenza: 31 dicembre'), new D.CommentRangeEnd(0), new D.TextRun({ children: [new D.CommentReference(0)] })]),
        para([new D.TextRun('Prezzo '), new D.DeletedTextRun({ text: 'vecchio', id: 101, author: 'Anna', date: new Date().toISOString() }), new D.InsertedTextRun({ text: 'nuovo', id: 102, author: 'Anna', date: new Date().toISOString() }), new D.TextRun(' concordato.')]),
        para([new D.TextRun('Primo punto')], { numbering: { reference: 'b', level: 0 } }),
        para([new D.TextRun('Secondo punto')], { numbering: { reference: 'b', level: 0 } }),
        new D.Table({ rows: [new D.TableRow({ children: [new D.TableCell({ children: [para([new D.TextRun('Voce')])] }), new D.TableCell({ children: [para([new D.TextRun('Importo')])] })] }), new D.TableRow({ children: [new D.TableCell({ children: [para([new D.TextRun('Totale')])] }), new D.TableCell({ children: [para([new D.TextRun('1.000')])] })] })] }),
        para([new D.ImageRun({ type: 'jpg', data: jpg, transformation: { width: 400, height: 267 } })]),
      ],
    }],
  });
  const f = path.join(d, name); fs.writeFileSync(f, await D.Packer.toBuffer(doc)); return f;
}

module.exports = { makeDoc };
