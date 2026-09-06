/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded dark tile with a 3×3 spreadsheet grid, one cell picked
 * out in the product's accent green — "select a cell, get a table" in one
 * glyph. Rendered with 4×4 supersampling so the 16px icon still reads clean.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [31, 31, 31]; // #1F1F1F
const CELL = [255, 255, 255];
const ACCENT = [52, 211, 153]; // #34D399
const SAMPLES = 4;

const CORNER_RADIUS = 0.22;
const MARGIN = 0.17;
const GAP = 0.05;
const CELL_RADIUS = 0.05;

const COLS = 3;
const ROWS = 3;
/** Zero-indexed [col, row] of the cell drawn in the accent colour. */
const ACCENT_CELL = [2, 0];

function insideRoundedRect(x, y, left, top, w, h, r) {
  const cx = Math.min(Math.max(x, left + r), left + w - r);
  const cy = Math.min(Math.max(y, top + r), top + h - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  return insideRoundedRect(x, y, 0, 0, size, size, r);
}

function cellColorAt(x, y, size) {
  const usable = 1 - 2 * MARGIN;
  const cellSize = (usable - (COLS - 1) * GAP) / COLS;
  const cellSizeY = (usable - (ROWS - 1) * GAP) / ROWS;

  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const left = (MARGIN + col * (cellSize + GAP)) * size;
      const top = (MARGIN + row * (cellSizeY + GAP)) * size;
      const w = cellSize * size;
      const h = cellSizeY * size;
      if (x < left || x > left + w || y < top || y > top + h) continue;
      if (!insideRoundedRect(x, y, left, top, w, h, CELL_RADIUS * size)) continue;
      const isAccent = col === ACCENT_CELL[0] && row === ACCENT_CELL[1];
      return isAccent ? ACCENT : CELL;
    }
  }
  return null;
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let tile = 0;
      const sum = [0, 0, 0];
      const total = SAMPLES * SAMPLES;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedTile(x, y, size)) continue;
          tile++;
          const color = cellColorAt(x, y, size) ?? TILE;
          for (let c = 0; c < 3; c++) sum[c] += color[c];
        }
      }

      const alpha = tile / total;
      const offset = (py * size + px) * 4;
      if (alpha === 0) continue;

      for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(sum[c] / tile);
      pixels[offset + 3] = Math.round(alpha * 255);
    }
  }

  return pixels;
}

/* ── PNG encoding ────────────────────────────────────────────────────── */

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
