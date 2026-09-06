/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark slate tile with three ascending bars (a market read
 * getting more crowded, left to right) and a small amber dot marking the
 * opportunity — a market-intelligence tool, not a highlighter or a saver.
 * Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [17, 24, 39]; // #111827 — dark slate, distinct from the highlighter's near-black
const BAR = [34, 197, 94]; // #22C55E — growth green
const DOT = [251, 191, 36]; // #FBBF24 — the opportunity marker
const SAMPLES = 4;

const CORNER_RADIUS = 0.22;
const BAR_BOTTOM = 0.78;

/** Three ascending bars, left to right: [xStart, xEnd, heightFraction]. */
const BARS = [
  [0.2, 0.38, 0.22],
  [0.44, 0.62, 0.38],
  [0.68, 0.86, 0.54],
];

const DOT_CENTER = [0.77, 0.2]; // above the tallest bar
const DOT_RADIUS = 0.09;

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideBar(x, y, size, bar) {
  const [x0, x1, height] = bar;
  const left = x0 * size;
  const right = x1 * size;
  const bottom = BAR_BOTTOM * size;
  const top = bottom - height * size;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function insideDot(x, y, size) {
  const cx = DOT_CENTER[0] * size;
  const cy = DOT_CENTER[1] * size;
  const r = DOT_RADIUS * size;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function colorAt(x, y, size) {
  if (insideDot(x, y, size)) return DOT;
  for (const bar of BARS) {
    if (insideBar(x, y, size, bar)) return BAR;
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
