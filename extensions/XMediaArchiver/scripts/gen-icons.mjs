/**
 * Generates the extension icons as PNGs with no image dependency — the same
 * dependency-free 4x4-supersampled encoder every extension in this
 * portfolio uses (ported from WebHighlighter: raw zlib deflate + hand-rolled
 * PNG chunks, no image library).
 *
 * The mark: a white download arrow (shaft + arrowhead) dropping into an
 * open bracket/tray, with a small amber "media" dot accent at the top right
 * standing in for a photo/lens — "save the media file", the product in one
 * shape. Tile colour is a deep teal-green [12,74,64], distinct from every
 * other X extension already in this portfolio (XBookmarkOrganizer's deep
 * indigo, XConversationSaver's/XVelocityFinder's near-black blue-greys,
 * XCardExporter's deep plum) — a different hue family, not just a
 * different glyph, so the toolbar icon reads as unmistakably its own
 * product at a glance.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [12, 74, 64]; // deep teal-green
const GLYPH = [255, 255, 255];
const ACCENT = [245, 166, 53]; // warm amber, distinct from any accent already in the portfolio
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

/** The arrow's straight shaft. */
function isShaft(x, y, size) {
  return x >= 0.45 * size && x <= 0.55 * size && y >= 0.16 * size && y <= 0.5 * size;
}

/** The arrow's downward-pointing head, as a triangle. */
function isArrowhead(x, y, size) {
  return withinTriangle(x, y, 0.5 * size, 0.64 * size, 0.32 * size, 0.46 * size, 0.68 * size, 0.46 * size);
}

/** The open tray/bracket the arrow drops into: a bottom bar plus two short
 *  upward side arms — deliberately open at the top, like a "download to
 *  here" tray glyph. */
function isTray(x, y, size) {
  const bottom = x >= 0.18 * size && x <= 0.82 * size && y >= 0.78 * size && y <= 0.85 * size;
  const left = x >= 0.18 * size && x <= 0.26 * size && y >= 0.6 * size && y <= 0.85 * size;
  const right = x >= 0.74 * size && x <= 0.82 * size && y >= 0.6 * size && y <= 0.85 * size;
  return bottom || left || right;
}

/** Small accent dot, top-right — stands in for a photo/lens ("media"). */
function isAccentDot(x, y, size) {
  const cx = 0.74 * size;
  const cy = 0.26 * size;
  const r = 0.09 * size;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function colorAt(x, y, size) {
  if (isAccentDot(x, y, size)) return ACCENT;
  if (isShaft(x, y, size) || isArrowhead(x, y, size) || isTray(x, y, size)) return GLYPH;
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
