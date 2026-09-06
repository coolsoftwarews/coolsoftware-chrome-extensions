/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded dark-green tile with a simple concentric focus
 * ring/target — hiding the noise, keeping the center — deliberately
 * distinct from LinkedInCreatorWatchlist's navy-tile blue eye and from any
 * magnifying-glass/lightning/bars motif used elsewhere in this portfolio.
 * Rendered with 4x4 supersampling for clean edges at every size.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [12, 30, 26]; // #0C1E1A — deep forest-green, distinct from other LinkedIn extensions' tiles
const RING = [52, 199, 149]; // #34C795 — calm mint-green accent
const DOT = [255, 255, 255];
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

/** A focus/target ring: an annulus (outer minus inner radius) centered on the tile. */
function ringWidth(x, y, size, outerFrac, innerFrac) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist <= size * outerFrac && dist >= size * innerFrac;
}

function insideCenterDot(x, y, size) {
  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.09;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Four short corner "brackets" pointing inward, like a camera focus
 * indicator — reinforces the "focus mode" idea distinctly from a plain ring.
 */
function insideCornerBracket(x, y, size) {
  const bracketLen = size * 0.16;
  const thickness = size * 0.055;
  const margin = size * 0.16;

  const corners = [
    { cx: margin, cy: margin, hDir: 1, vDir: 1 },
    { cx: size - margin, cy: margin, hDir: -1, vDir: 1 },
    { cx: margin, cy: size - margin, hDir: 1, vDir: -1 },
    { cx: size - margin, cy: size - margin, hDir: -1, vDir: -1 },
  ];

  for (const corner of corners) {
    const horizontal =
      x >= corner.cx - (corner.hDir > 0 ? 0 : bracketLen) &&
      x <= corner.cx + (corner.hDir > 0 ? bracketLen : 0) &&
      Math.abs(y - corner.cy) <= thickness / 2;
    const vertical =
      y >= corner.cy - (corner.vDir > 0 ? 0 : bracketLen) &&
      y <= corner.cy + (corner.vDir > 0 ? bracketLen : 0) &&
      Math.abs(x - corner.cx) <= thickness / 2;
    if (horizontal || vertical) return true;
  }
  return false;
}

/** The colour drawn at a point, or null when only the tile shows through. */
function colorAt(x, y, size) {
  if (insideCenterDot(x, y, size)) return DOT;
  if (ringWidth(x, y, size, 0.3, 0.24)) return RING;
  if (insideCornerBracket(x, y, size)) return RING;
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
