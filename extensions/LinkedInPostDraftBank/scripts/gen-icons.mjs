/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded deep-plum tile with a white document (a cut top-right
 * corner reads as "a page") and an amber pen stroke crossing it diagonally —
 * a document/pen motif, deliberately distinct from this portfolio's other
 * LinkedIn extensions (LinkedIn Creator Watchlist's eye on a near-black navy
 * tile, LinkedIn Lead Finder's person+target on a dark navy tile): different
 * tile colour *and* different mark, not just a recolor. Rendered with 4x4
 * supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [36, 27, 54]; // #241B36 — deep plum, distinct from this portfolio's LinkedIn navy tiles
const WHITE = [255, 255, 255];
const AMBER = [242, 183, 5]; // #F2B705 — matches the truncation overlay's warning accent
const GRAY = [176, 176, 184];
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

/** A rectangle with rounded corners, given as fractions of the icon size. */
function insideRoundedBox(x, y, left, right, top, bottom, r) {
  if (x < left - r || x > right + r || y < top - r || y > bottom + r) return false;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function sign(px, py, ax, ay, bx, by) {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

// Document box, as fractions of the icon size.
const DOC = { left: 0.26, right: 0.66, top: 0.16, bottom: 0.8, r: 0.03 };
const NOTCH = 0.13; // dog-eared corner size, fraction of icon size

// Two short "text line" hints near the bottom of the page.
const LINES = [
  [0.32, 0.5, 0.62, 0.035],
  [0.32, 0.46, 0.69, 0.035],
];

// The pen: a diagonal stroke crossing the page's lower-right corner.
const PEN = { ax: 0.32, ay: 0.74, bx: 0.78, by: 0.26, radius: 0.045 };

function colorAt(x, y, size) {
  const fx = x / size;
  const fy = y / size;

  // Pen stroke takes priority — it's drawn "on top" of the page.
  if (distToSegment(x, y, PEN.ax * size, PEN.ay * size, PEN.bx * size, PEN.by * size) <= PEN.radius * size) {
    return AMBER;
  }

  const notchAx = DOC.right - NOTCH,
    notchAy = DOC.top;
  const notchBx = DOC.right,
    notchBy = DOC.top;
  const notchCx = DOC.right,
    notchCy = DOC.top + NOTCH;
  const inNotch = pointInTriangle(fx, fy, notchAx, notchAy, notchBx, notchBy, notchCx, notchCy);

  if (
    !inNotch &&
    insideRoundedBox(x, y, DOC.left * size, DOC.right * size, DOC.top * size, DOC.bottom * size, DOC.r * size)
  ) {
    for (const [x0, x1, yc, height] of LINES) {
      const half = (height * size) / 2;
      if (x >= x0 * size && x <= x1 * size && y >= yc * size - half && y <= yc * size + half) return GRAY;
    }
    return WHITE;
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
          const color = colorAt(x, y, size) ?? TILE;
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

  // One filter byte (0 = None) per scanline.
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
