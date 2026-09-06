/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a plum tile with three white "spec sheet" bars — a listing
 * broken down into its parts (title / tags / price), the middle one picked
 * out in gold — plus a small gold magnifying glass badge overlapping the
 * bottom-right corner for "analyze". Different palette and a distinct badge
 * shape from WebHighlighter's dark+yellow bars, so it reads as a different
 * product at a glance even though both are "structured text" marks.
 *
 * Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [43, 30, 46]; // #2B1E2E — deep plum
const INK = [255, 255, 255];
const GOLD = [244, 185, 66]; // #F4B942
const SAMPLES = 4;

/** [xStart, xEnd, yCenter, height, colour] as fractions of the icon size. */
const BARS = [
  [0.18, 0.72, 0.28, 0.09, INK],
  [0.18, 0.66, 0.48, 0.11, GOLD],
  [0.18, 0.58, 0.68, 0.09, INK],
];

const CORNER_RADIUS = 0.22;

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

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

/** Distance from point (x,y) to the segment (x1,y1)-(x2,y2). */
function distToSegment(x, y, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / lenSq;
  t = Math.min(Math.max(t, 0), 1);
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(x - px, y - py);
}

/** The magnifying-glass badge in the bottom-right corner: a gold ring plus a
 *  short diagonal handle, drawn over the tile background (not the bars). */
function magnifierColorAt(x, y, size) {
  const cx = 0.72 * size;
  const cy = 0.72 * size;
  const rOuter = 0.19 * size;
  const rInner = 0.12 * size;
  const dist = Math.hypot(x - cx, y - cy);
  if (dist <= rOuter && dist >= rInner) return GOLD;

  const handleWidth = 0.045 * size;
  const hx1 = cx + rOuter * 0.62;
  const hy1 = cy + rOuter * 0.62;
  const hx2 = cx + rOuter * 1.55;
  const hy2 = cy + rOuter * 1.55;
  if (distToSegment(x, y, hx1, hy1, hx2, hy2) <= handleWidth) {
    // Clip the handle to stay inside the tile so it never floats off the edge.
    if (x <= size && y <= size) return GOLD;
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
          const color = magnifierColorAt(x, y, size) ?? barColorAt(x, y, size) ?? TILE;
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
