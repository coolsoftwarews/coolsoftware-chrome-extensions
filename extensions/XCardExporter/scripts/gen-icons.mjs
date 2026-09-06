/**
 * Generates the extension icons as PNGs with no image dependency — the same
 * dependency-free 4x4-supersampled encoder every extension in this
 * portfolio uses (ported from WebHighlighter: raw zlib deflate + hand-rolled
 * PNG chunks, no image library).
 *
 * The mark: a white picture frame (rounded rect outline) holding a small
 * mountain-and-sun glyph — "export this post as a picture", the product in
 * one shape. Tile colour is a deep plum (distinct from the other X
 * extensions already in this portfolio: XConversationSaver's [21,32,43]
 * blue-grey and XVelocityFinder's [11,15,20] near-black) with a warm coral
 * accent for the sun, so the toolbar icon reads as unmistakably different
 * from its X siblings at a glance.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [42, 24, 48]; // deep plum
const FRAME = [255, 255, 255];
const SKY = [255, 255, 255];
const MOUNTAIN = [201, 168, 255]; // soft lavender
const SUN = [255, 138, 101]; // warm coral
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

// The frame is a rounded rectangle outline; everything strictly inside its
// inner edge is the "photo" area where the sun/mountain glyph is drawn.
const FRAME_OUTER = 0.16;
const FRAME_INNER = 0.24;
const FRAME_RADIUS = 0.08;

function insideRoundedRect(x, y, size, inset, radius) {
  const left = inset * size;
  const top = inset * size;
  const w = size - inset * size * 2; // square icon, so width == height
  const right = left + w;
  const bottom = top + w;
  const r = radius * size;

  if (x < left || x > right || y < top || y > bottom) return false;

  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function isFrameOutline(x, y, size) {
  return insideRoundedRect(x, y, size, FRAME_OUTER, FRAME_RADIUS) && !insideRoundedRect(x, y, size, FRAME_INNER, FRAME_RADIUS * 0.7);
}

function isPhotoArea(x, y, size) {
  return insideRoundedRect(x, y, size, FRAME_INNER, FRAME_RADIUS * 0.7);
}

/** A simple two-peak mountain silhouette, drawn as two overlapping
 *  triangles via half-plane tests — cheap and legible down to 16px. */
function isMountain(x, y, size) {
  const baseY = 0.68 * size;
  if (y < 0.4 * size || y > baseY) return false;
  // Left (taller) peak.
  const leftPeakX = 0.36 * size;
  const leftBaseL = 0.24 * size;
  const leftBaseR = 0.5 * size;
  const leftPeakY = 0.4 * size;
  if (withinTriangle(x, y, leftBaseL, baseY, leftPeakX, leftPeakY, leftBaseR, baseY)) return true;
  // Right (shorter) peak, overlapping the first.
  const rightPeakX = 0.62 * size;
  const rightBaseL = 0.46 * size;
  const rightBaseR = 0.76 * size;
  const rightPeakY = 0.48 * size;
  if (withinTriangle(x, y, rightBaseL, baseY, rightPeakX, rightPeakY, rightBaseR, baseY)) return true;
  return false;
}

function sign(x1, y1, x2, y2, x3, y3) {
  return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
}

function withinTriangle(px, py, x1, y1, x2, y2, x3, y3) {
  const d1 = sign(px, py, x1, y1, x2, y2);
  const d2 = sign(px, py, x2, y2, x3, y3);
  const d3 = sign(px, py, x3, y3, x1, y1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function isSun(x, y, size) {
  const cx = 0.68 * size;
  const cy = 0.32 * size;
  const r = 0.09 * size;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function colorAt(x, y, size) {
  if (isFrameOutline(x, y, size)) return FRAME;
  if (isPhotoArea(x, y, size)) {
    if (isSun(x, y, size)) return SUN;
    if (isMountain(x, y, size)) return MOUNTAIN;
    return SKY;
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
