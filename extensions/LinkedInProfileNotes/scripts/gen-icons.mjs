/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark teal tile — a different hue from both LinkedIn siblings'
 * blue/navy marks (LinkedInCreatorWatchlist's eye, LinkedInLeadFinder's
 * person+target) — holding a small amber sticky note with a folded corner and
 * a pin dot. Sticky note + pin reads as "a note attached to this person",
 * distinct at a glance from "watching content" or "found a lead". Rendered
 * with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [15, 34, 30]; // #0F221E — dark teal, distinct from both LinkedIn siblings' blue/navy
const NOTE = [255, 213, 74]; // #FFD54A — warm amber sticky note
const NOTE_FOLD = [214, 173, 51]; // #D6AD33 — the folded-corner shade, darker than the note face
const NOTE_LINE = [15, 34, 30]; // matches TILE so the "text" lines read as ink on the note
const PIN = [214, 74, 51]; // #D64A33 — a small warm pin dot, distinct from the amber note
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

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** True inside the sticky note's square, sized relative to the tile. */
function insideNoteSquare(x, y, size) {
  const left = size * 0.24;
  const right = size * 0.8;
  const top = size * 0.28;
  const bottom = size * 0.82;
  return x >= left && x <= right && y >= top && y <= bottom;
}

/** The folded corner: a small triangle cut from the note's top-right. */
function insideFoldTriangle(x, y, size) {
  const right = size * 0.8;
  const top = size * 0.28;
  const foldSize = size * 0.16;
  // Triangle bounded by the note's top edge, right edge, and the fold's diagonal.
  if (x < right - foldSize || x > right || y < top || y > top + foldSize) return false;
  return x - (right - foldSize) >= foldSize - (y - top);
}

/** One of three short horizontal "text" lines drawn on the note face. */
function insideTextLine(x, y, size, lineIndex) {
  const left = size * 0.32;
  const right = size * 0.72;
  const lineHeight = size * 0.045;
  const startY = size * 0.42 + lineIndex * size * 0.13;
  if (x < left || x > right) return false;
  return y >= startY && y <= startY + lineHeight;
}

function insidePin(x, y, size) {
  return inCircle(x, y, size * 0.28, size * 0.24, size * 0.075);
}

/** The colour drawn at a point, or null when only the tile shows through. */
function colorAt(x, y, size) {
  if (insidePin(x, y, size)) return PIN;
  if (insideNoteSquare(x, y, size)) {
    if (insideFoldTriangle(x, y, size)) return NOTE_FOLD;
    for (let i = 0; i < 3; i++) {
      if (insideTextLine(x, y, size, i)) return NOTE_LINE;
    }
    return NOTE;
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
