/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded dark tile holding a white page with a folded top-right
 * corner (a teal dog-ear) and three short "text line" bars — a book/page
 * glyph, deliberately different in both shape and palette from
 * WebHighlighter's bars-on-a-highlight mark, so the two extensions are
 * unmistakable side by side in a toolbar. Rendered with 4x4 supersampling so
 * the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [22, 27, 31]; // dark slate, distinct from WebHighlighter's neutral #1F1F1F
const PAGE = [255, 255, 255];
const INK = [46, 58, 66]; // text-line bars on the page
const ACCENT = [45, 182, 166]; // teal fold
const SAMPLES = 4;

const CORNER_RADIUS = 0.22;
const PAGE_RADIUS = 0.05;

// Page bounds, as fractions of the icon size.
const PAGE_X0 = 0.28;
const PAGE_X1 = 0.76;
const PAGE_Y0 = 0.16;
const PAGE_Y1 = 0.84;
const FOLD = 0.16; // size of the dog-ear, along the page's top-right corner

const LINES = [
  [0.36, 0.68, 0.62],
  [0.36, 0.68, 0.71],
];

function insideRoundedRect(x, y, x0, y0, x1, y1, radius) {
  const rx = Math.min(Math.max(x, x0 + radius), x1 - radius);
  const ry = Math.min(Math.max(y, y0 + radius), y1 - radius);
  if (x >= x0 + radius && x <= x1 - radius) return y >= y0 && y <= y1;
  if (y >= y0 + radius && y <= y1 - radius) return x >= x0 && x <= x1;
  const dx = x - rx;
  const dy = y - ry;
  return dx * dx + dy * dy <= radius * radius;
}

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  return insideRoundedRect(x, y, 0, 0, size, size, r);
}

/** Point-in-triangle via sign test (the dog-ear fold at the page's corner). */
function insideFoldTriangle(x, y, size) {
  const x1 = PAGE_X1 * size;
  const y0 = PAGE_Y0 * size;
  const fold = FOLD * size;
  const ax = x1 - fold, ay = y0;
  const bx = x1, by = y0;
  const cx = x1, cy = y0 + fold;

  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function insidePage(x, y, size) {
  return insideRoundedRect(x, y, PAGE_X0 * size, PAGE_Y0 * size, PAGE_X1 * size, PAGE_Y1 * size, PAGE_RADIUS * size);
}

function insideLine(x, y, size) {
  for (const [x0, x1, yc] of LINES) {
    const height = 0.055;
    const half = (height * size) / 2;
    const left = x0 * size;
    const right = x1 * size;
    if (x < left || x > right || y < yc * size - half || y > yc * size + half) continue;
    const cx = Math.min(Math.max(x, left + half), right - half);
    const dx = x - cx;
    const dy = y - yc * size;
    if (dx * dx + dy * dy <= half * half) return true;
  }
  return false;
}

function colorAt(x, y, size) {
  if (insideFoldTriangle(x, y, size)) return ACCENT;
  if (insideLine(x, y, size)) return INK;
  if (insidePage(x, y, size)) return PAGE;
  return null; // tile shows through
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tileCoverage = 0;
      const sum = [0, 0, 0];
      const total = SAMPLES * SAMPLES;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedTile(x, y, size)) continue;
          tileCoverage++;
          const color = colorAt(x, y, size) ?? TILE;
          for (let c = 0; c < 3; c++) sum[c] += color[c];
        }
      }

      const alpha = tileCoverage / total;
      const offset = (py * size + px) * 4;
      if (alpha === 0) continue;

      for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(sum[c] / tileCoverage);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/* ── PNG encoding (identical approach to every other extension's gen-icons.mjs) ── */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, renderRgba(size)));
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}
