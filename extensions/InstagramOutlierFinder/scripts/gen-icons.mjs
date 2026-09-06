/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded dark tile with four ascending bars — a tiny bar chart —
 * where the last, tallest bar breaks into a warm accent colour. That's the
 * product in one glyph: everything reads flat except the one post that
 * spiked, which is exactly what the 🔥 badge language in the PRD is pointing
 * at. Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [20, 24, 33]; // #141821 — dark navy, distinct from the other extensions' near-black tiles
const BAR = [214, 219, 226]; // #D6DBE2 — neutral, for the non-outlier bars
const ACCENT = [255, 106, 44]; // #FF6A2C — warm outlier orange, echoes the 🔥 badge
const SAMPLES = 4;

/** Bars as fractions of the icon: [xStart, xEnd, topFrac, color]. Bottom is fixed. */
const BAR_BOTTOM = 0.82;
const BARS = [
  [0.14, 0.32, 0.52, BAR],
  [0.38, 0.56, 0.4, BAR],
  [0.62, 0.8, 0.28, BAR],
  [0.68, 0.86, 0.14, ACCENT],
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

/** The colour drawn at a point, or null when only the tile is there. */
function barColorAt(x, y, size) {
  for (const [x0, x1, topFrac, color] of BARS) {
    const left = x0 * size;
    const right = x1 * size;
    if (x < left || x > right) continue;
    const top = topFrac * size;
    const bottom = BAR_BOTTOM * size;
    const half = (right - left) / 2;
    // A capsule: flat sides, rounded top and bottom caps of radius `half`.
    const cy = Math.min(Math.max(y, top + half), bottom - half);
    const dx = x - (left + half);
    const dy = y - cy;
    if (y >= top - half && y <= bottom + half && dx * dx + dy * dy <= half * half) return color;
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
          const color = barColorAt(x, y, size) ?? TILE;
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
