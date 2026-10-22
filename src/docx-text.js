const {
  Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell, HeadingLevel, WidthType,
  BorderStyle, ShadingType, LevelFormat, AlignmentType,
} = require('docx');
const { layoutDocument } = require('./layout');

const TABLE_WIDTH = 9000; // dxa, circa la larghezza utile di una pagina A4 con margini standard
const clampSize = (pt) => Math.round(Math.min(Math.max(pt, 8), 40) * 2);
const runsOf = (runs, size, forceBold) => runs.map((r) => new TextRun({ text: r.text, bold: forceBold || r.bold, italics: r.italic, size: clampSize(size) }));
const line = { style: BorderStyle.SINGLE, size: 4, color: '999999' };

function headingLevel(b, body) {
  if (b.size >= body * 1.6) return HeadingLevel.HEADING_1;
  if (b.size >= body * 1.25) return HeadingLevel.HEADING_2;
  return undefined;
}

function tableOf(t) {
  const widths = t.cols.map((c, i) => Math.max(c.b - c.a, 8) + (i < t.cols.length - 1 ? Math.max(t.cols[i + 1].a - c.b, 0) : 0));
  const total = widths.reduce((a, b) => a + b, 0);
  const dxa = widths.map((w) => Math.round((w / total) * TABLE_WIDTH));
  const header = t.rows[0].every((cell) => !cell.length || cell.every((r) => r.bold || !r.text.trim()));
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    columnWidths: dxa,
    borders: { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line },
    rows: t.rows.map((row, ri) => new TableRow({
      tableHeader: header && ri === 0,
      children: row.map((cell, ci) => new TableCell({
        width: { size: dxa[ci], type: WidthType.DXA },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        shading: header && ri === 0 ? { type: ShadingType.CLEAR, fill: 'E8EEF7', color: 'auto' } : undefined,
        children: [new Paragraph({ children: runsOf(cell, t.size) })],
      })),
    })),
  });
}

async function buildDocx(pages) {
  const { blocks, bodySize } = layoutDocument(pages);
  const children = [];
  for (const b of blocks) {
    if (b.type === 'table') {
      children.push(tableOf(b), new Paragraph({ spacing: { after: 80 }, children: [] }));
    } else if (b.type === 'figure') {
      const w = Math.min(Math.round(b.w * 1.333), 600);
      children.push(new Paragraph({ spacing: { after: 120 }, children: [new ImageRun({ type: 'png', data: b.png, transformation: { width: w, height: Math.round((b.h * w) / b.w) } })] }));
    } else {
      const heading = headingLevel(b, bodySize);
      children.push(new Paragraph({
        heading,
        spacing: { after: 120 },
        numbering: b.bullet ? { reference: 'bullets', level: 0 } : undefined,
        children: runsOf(b.runs, b.size, !!heading),
      }));
    }
  }
  return Packer.toBuffer(new Document({
    numbering: { config: [{ reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }] }] },
    sections: [{ children }],
  }));
}

module.exports = { buildDocx };
