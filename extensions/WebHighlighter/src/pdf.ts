/**
 * A minimal PDF writer — no dependencies.
 *
 * Ported unchanged from the YouTube Transcript Export extension, which is the
 * point: PRD §2 budgets this product on the assumption that the export layer
 * is reused rather than rebuilt. A headless renderer or an embedded font would
 * cost megabytes; a plain PDF 1.4 with the two standard Helvetica faces costs
 * a few kilobytes and opens in every viewer.
 *
 * Consequence of using a standard font: the encoding is WinAnsi, so glyphs
 * outside Latin-1 cannot be drawn. Those are replaced and reported back through
 * `unsupportedCharacters` so the panel can steer the user to Markdown/TXT.
 */

/** Helvetica advance widths (1/1000 em) for ASCII 32-126. */
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const BOLD_RATIO = 1.06; // close enough for wrapping short bold header lines

export interface PdfLine {
  label: string;
  text: string;
}

export interface PdfDocumentInput {
  title: string;
  header: string[];
  lines: PdfLine[];
}

export interface PdfResult {
  blob: Blob;
  /** Characters that could not be encoded, deduplicated. Empty on a clean export. */
  unsupportedCharacters: string[];
}

const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const MARGIN = 56;
const BODY_SIZE = 10;
const BODY_LEADING = 14;
const TITLE_SIZE = 16;
const HEADER_SIZE = 9.5;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function charWidth(code: number, bold: boolean): number {
  let width: number;
  if (code >= 32 && code <= 126) width = HELVETICA_WIDTHS[code - 32];
  else if (code === 160) width = 278; // nbsp
  else width = 556; // Latin-1 accented glyphs sit close to this
  return bold ? width * BOLD_RATIO : width;
}

function measure(text: string, size: number, bold: boolean): number {
  let total = 0;
  for (let i = 0; i < text.length; i++) total += charWidth(text.charCodeAt(i), bold);
  return (total * size) / 1000;
}

/** Greedy word wrap; a single word longer than the line is broken on character boundaries. */
function wrap(text: string, size: number, bold: boolean, maxWidth: number): string[] {
  const out: string[] = [];
  let line = '';

  const pushWordChunks = (word: string) => {
    let chunk = '';
    for (const ch of word) {
      if (measure(chunk + ch, size, bold) > maxWidth && chunk) {
        out.push(chunk);
        chunk = ch;
      } else {
        chunk += ch;
      }
    }
    line = chunk;
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? line + ' ' + word : word;
    if (measure(candidate, size, bold) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) out.push(line);
    if (measure(word, size, bold) > maxWidth) pushWordChunks(word);
    else line = word;
  }

  if (line) out.push(line);
  return out.length ? out : [''];
}

/**
 * Maps a string onto WinAnsi. Anything unrepresentable becomes '?' and is
 * recorded, since silently dropping characters would make a Japanese transcript
 * export as a page of blanks with no explanation.
 */
function toWinAnsi(text: string, unsupported: Set<string>): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 8217 || code === 8216) out += "'";
    else if (code === 8220 || code === 8221) out += '"';
    else if (code === 8211 || code === 8212) out += '-';
    else if (code === 8230) out += '...';
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) out += ch;
    else {
      unsupported.add(ch);
      out += '?';
    }
  }
  return out;
}

function escapePdfString(text: string): string {
  return text.replace(/([()\\])/g, '\\$1');
}

interface PageState {
  ops: string[];
  y: number;
}

export function generatePdf(doc: PdfDocumentInput): PdfResult {
  const unsupported = new Set<string>();
  const pages: PageState[] = [];
  let page: PageState = { ops: [], y: PAGE_HEIGHT - MARGIN };
  pages.push(page);

  const newPage = () => {
    page = { ops: [], y: PAGE_HEIGHT - MARGIN };
    pages.push(page);
  };

  const draw = (text: string, x: number, size: number, bold: boolean) => {
    page.ops.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${page.y.toFixed(2)} Tm (${escapePdfString(text)}) Tj ET`
    );
  };

  const advance = (amount: number) => {
    page.y -= amount;
    if (page.y < MARGIN) newPage();
  };

  // Title
  for (const line of wrap(toWinAnsi(doc.title, unsupported), TITLE_SIZE, true, CONTENT_WIDTH)) {
    draw(line, MARGIN, TITLE_SIZE, true);
    advance(TITLE_SIZE + 6);
  }
  advance(4);

  // Header block
  for (const entry of doc.header) {
    for (const line of wrap(toWinAnsi(entry, unsupported), HEADER_SIZE, false, CONTENT_WIDTH)) {
      draw(line, MARGIN, HEADER_SIZE, false);
      advance(HEADER_SIZE + 3);
    }
  }
  if (doc.header.length) {
    advance(6);
    page.ops.push(
      `0.8 w 0.6 G ${MARGIN} ${page.y.toFixed(2)} m ${(PAGE_WIDTH - MARGIN).toFixed(2)} ${page.y.toFixed(2)} l S 0 G`
    );
    advance(16);
  }

  // Body. Timestamps sit in a fixed gutter so the text column stays aligned.
  const labelWidth = doc.lines.some(l => l.label)
    ? Math.max(...doc.lines.map(l => measure(l.label, BODY_SIZE, true))) + 8
    : 0;
  const textWidth = CONTENT_WIDTH - labelWidth;

  for (const line of doc.lines) {
    const wrapped = wrap(toWinAnsi(line.text, unsupported), BODY_SIZE, false, textWidth);

    // Keep a label with the first line of its paragraph across a page break.
    if (page.y - BODY_LEADING < MARGIN) newPage();

    if (line.label) draw(toWinAnsi(line.label, unsupported), MARGIN, BODY_SIZE, true);
    draw(wrapped[0], MARGIN + labelWidth, BODY_SIZE, false);
    advance(BODY_LEADING);

    for (const rest of wrapped.slice(1)) {
      draw(rest, MARGIN + labelWidth, BODY_SIZE, false);
      advance(BODY_LEADING);
    }
    advance(4);
  }

  return { blob: assemble(pages), unsupportedCharacters: Array.from(unsupported) };
}

/* ── File assembly ───────────────────────────────────────────────────── */

function assemble(pages: PageState[]): Blob {
  const objects: string[] = [];
  const addObject = (body: string): number => {
    objects.push(body);
    return objects.length; // 1-based object number
  };

  // Reserve 1 = catalog, 2 = page tree; both need child ids we do not have yet.
  addObject('');
  addObject('');
  const fontRegular = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageIds: number[] = [];
  for (const p of pages) {
    const content = p.ops.join('\n');
    const contentId = addObject(`<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH.toFixed(2)} ${PAGE_HEIGHT.toFixed(2)}] ` +
        `/Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
  }

  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Blob([latin1Bytes(pdf).buffer as ArrayBuffer], { type: 'application/pdf' });
}

/** Every byte we emit is Latin-1, so string length in bytes equals character count. */
function byteLength(text: string): number {
  return text.length;
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}
