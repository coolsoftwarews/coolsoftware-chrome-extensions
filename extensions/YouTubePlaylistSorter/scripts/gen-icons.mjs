/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded near-black tile with a small up/down sort arrow on the
 * left and three horizontal bars of increasing length on the right — a
 * sorted list, in one glyph. Deliberately distinct from this portfolio's
 * other YouTube extensions (Subscription Groups uses a folder/columns rail
 * icon set; Pro Filters uses a filter funnel) — this one reads as "sort",
 * not "filter" or "group", at both 16px and 128px.
 *
 * Same dependency-free approach as every other extension in this portfolio:
 * 4x4 supersampled antialiasing against a rounded-square tile, hand-rolled
 * PNG chunks over raw zlib deflate.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [17, 17, 20]; // near-black, faint blue tint
const BAR = [255, 71, 71]; // red — echoes YouTube without copying its exact red
const INK = [255, 255, 255];
const SAMPLES = 4;
const CORNER_RADIUS = 0.22;

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Horizontal rounded bars: [xStart, xEnd, yCenter, height, colour]. */
const BARS = [
  [0.44, 0.6, 0.28, 0.12, BAR],
  [0.44, 0.74, 0.5, 0.12, BAR],
  [0.44, 0.88, 0.72, 0.12, BAR],
];

function barColorAt(x, y, size) {
  for (const [x0, x1, yc, height, color] of BARS) {
    const half = (height * size) / 2;
    const left = x0 * size;
    const right = x1 * size;
    if (x < left || x > right || y < yc * size - half || y > yc * size + half) continue;
    const cx = Math.min(Math.max(x, left + half), right - half);
    const dx = x - cx;
    const dy = y - yc * size;
    if (dx * dx + dy * dy <= half * half) return color;
  }
  return null;
}

/** Even-odd point-in-polygon (ray casting), points as fractions of the icon size. */
function pointInPolygon(px, py, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// Two small triangles stacked into an up/down "sort" arrow, left of the bars.
const ARROW_UP = [
  [0.26, 0.18],
  [0.34, 0.18],
  [0.3, 0.09],
];
const ARROW_DOWN = [
  [0.26, 0.24],
  [0.34, 0.24],
  [0.3, 0.33],
];
// A slim connecting stem so the two triangles read as one arrow glyph.
const ARROW_STEM = [
  [0.285, 0.19],
  [0.315, 0.19],
  [0.315, 0.23],
  [0.285, 0.23],
];

function arrowAt(xFrac, yFrac) {
  if (pointInPolygon(xFrac, yFrac, ARROW_UP)) return INK;
  if (pointInPolygon(xFrac, yFrac, ARROW_DOWN)) return INK;
  if (pointInPolygon(xFrac, yFrac, ARROW_STEM)) return INK;
  return null;
}

function colorAt(x, y, size) {
  const xFrac = x / size;
  const yFrac = y / size;
  return arrowAt(xFrac, yFrac) ?? barColorAt(x, y, size) ?? TILE;
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
          const color = colorAt(x, y, size);
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

/* ── PNG encoding (verbatim pattern from the portfolio's other icon scripts) ── */

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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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
