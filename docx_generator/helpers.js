const {
  Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat, PageBreak, TabStopType, TabStopPosition,
} = require('docx');

const C = {
  black:    '1A1A1A',
  navy:     '1F3864',
  blue:     '2E75B6',
  slate:    '374151',
  teal:     '0F6E56',
  amber:    '854F0B',
  red:      '993C1D',
  green:    '3B6D11',
  grey:     '666666',
  lightgrey:'888888',
  rowAlt:   'F0F4F8',
  rowHead:  '2E75B6',
  code:     '2D2D2D',
  codeBg:   'F4F6F8',
  noteBg:   'EBF4FB',
  noteBorder: '2E75B6',
  warnBg:   'FFF3E0',
  warnBorder: 'E67E22',
  todoBg:   'FFFBEA',
  todoBorder: 'C9A227',
  diagBg:   'F3F0FB',
  diagBorder: '6B4FBB',
};

const border1 = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const allBorders = { top: border1, bottom: border1, left: border1, right: border1 };

function sp(before = 0, after = 0) { return { spacing: { before, after } }; }

function H1(text, num) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text: (num ? num + '. ' : '') + text, font: 'Arial', size: 34, bold: true, color: C.navy })],
    ...sp(420, 140),
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: C.navy, space: 4 } },
  });
}
function H2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text, font: 'Arial', size: 26, bold: true, color: C.blue })],
    ...sp(260, 90),
  });
}
function H3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text, font: 'Arial', size: 22, bold: true, color: C.slate })],
    ...sp(180, 60),
  });
}
function H4(text) {
  return new Paragraph({
    children: [new TextRun({ text, font: 'Arial', size: 21, bold: true, color: C.slate, italics: true })],
    ...sp(140, 40),
  });
}

function run(text, opts = {}) { return new TextRun({ text, font: 'Arial', size: 22, color: C.black, ...opts }); }
function bold(text, color = C.black) { return run(text, { bold: true, color }); }
function italic(text) { return run(text, { italics: true }); }
function mono(text, color = C.code) { return new TextRun({ text, font: 'Courier New', size: 18, color }); }

function body(runsOrText, opts = {}) {
  const children = typeof runsOrText === 'string' ? [run(runsOrText, opts)] : runsOrText;
  return new Paragraph({ children, ...sp(0, 130), alignment: AlignmentType.JUSTIFIED });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    children: typeof text === 'string' ? [run(text)] : text,
    ...sp(0, 70),
  });
}
function numbered(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'numbers', level },
    children: typeof text === 'string' ? [run(text)] : text,
    ...sp(0, 70),
  });
}

function codeBlock(lines, lang = '') {
  const out = [];
  if (lang) {
    out.push(new Paragraph({
      children: [new TextRun({ text: lang, font: 'Courier New', size: 16, color: C.lightgrey, italics: true })],
      shading: { type: ShadingType.CLEAR, fill: C.codeBg },
      spacing: { before: 80, after: 0, line: 220 },
      indent: { left: 360 },
      border: { top: border1, left: border1, right: border1 },
    }));
  }
  lines.forEach((line, i) => {
    const isFirst = i === 0 && !lang;
    const isLast = i === lines.length - 1;
    out.push(new Paragraph({
      children: [new TextRun({ text: line.length ? line : ' ', font: 'Courier New', size: 18, color: C.code })],
      shading: { type: ShadingType.CLEAR, fill: C.codeBg },
      spacing: { before: isFirst ? 80 : 0, after: isLast ? 100 : 0, line: 230 },
      indent: { left: 360 },
      border: isFirst ? { top: border1, left: border1, right: border1 }
            : isLast ? { bottom: border1, left: border1, right: border1 }
            : { left: border1, right: border1 },
    }));
  });
  return out;
}

function spacer(n = 1) {
  return Array.from({ length: n }, () => new Paragraph({ children: [new TextRun('')], ...sp(0, 60) }));
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()], ...sp(0, 0) });
}

// Single-cell callout box
function callout(label, paragraphs, fillColor = C.noteBg, borderColor = C.noteBorder) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: borderColor };
  return new Table({
    width: { size: 9360, type: WidthType.DXA },
    columnWidths: [9360],
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: b, bottom: b, left: { ...b, size: 14 }, right: b },
        shading: { type: ShadingType.CLEAR, fill: fillColor },
        margins: { top: 130, bottom: 130, left: 220, right: 220 },
        children: [
          new Paragraph({ children: [new TextRun({ text: label, font: 'Arial', size: 20, bold: true, color: borderColor })], ...sp(0, 90) }),
          ...paragraphs,
        ],
      })],
    })],
  });
}

// Placeholder box for diagrams/images/snippets the user needs to insert
function placeholder(kind, title, descLines) {
  const map = {
    diagram: { label: '\u25A6 DIAGRAM PLACEHOLDER', fill: C.diagBg, border: C.diagBorder },
    image:   { label: '\u25A6 SCREENSHOT / IMAGE PLACEHOLDER', fill: C.diagBg, border: C.diagBorder },
    code:    { label: '\u2318 CODE SNIPPET TO INSERT', fill: C.todoBg, border: C.todoBorder },
    table:   { label: '\u25A6 TABLE / DATA TO INSERT', fill: C.diagBg, border: C.diagBorder },
  };
  const m = map[kind] || map.diagram;
  const paras = [
    new Paragraph({ children: [bold(title)], ...sp(0, 60) }),
    ...descLines.map(l => new Paragraph({ children: [run(l, { italics: true, color: C.grey, size: 20 })], ...sp(0, 40) })),
  ];
  return callout(m.label, paras, m.fill, m.border);
}

// Table builder
function makeTable(cols, rows, opts = {}) {
  const totalW = cols.reduce((s, c) => s + c.w, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: cols.map(c => new TableCell({
      borders: allBorders,
      width: { size: c.w, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: C.rowHead },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({
        children: [new TextRun({ text: c.label, font: 'Arial', size: 20, bold: true, color: 'FFFFFF' })],
      })],
    })),
  });
  const dataRows = rows.map((row, ri) => new TableRow({
    children: row.map((cell, ci) => {
      const content = Array.isArray(cell) ? cell : [cell];
      return new TableCell({
        borders: allBorders,
        width: { size: cols[ci].w, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: ri % 2 === 0 ? 'FFFFFF' : C.rowAlt },
        margins: { top: 70, bottom: 70, left: 120, right: 120 },
        children: content.map(c => typeof c === 'string'
          ? new Paragraph({ children: [new TextRun({ text: c, font: 'Arial', size: 19, color: C.black })], ...sp(0, 30) })
          : c
        ),
      });
    }),
  }));
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: cols.map(c => c.w),
    rows: [headerRow, ...dataRows],
    ...opts,
  });
}

module.exports = {
  C, sp, H1, H2, H3, H4, run, bold, italic, mono, body, bullet, numbered,
  codeBlock, spacer, pageBreak, callout, placeholder, makeTable, allBorders, border1,
};
