/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded navy tile with an amber lightbulb — the 💡 "opportunity"
 * chip this product paints on a matching post, turned into a badge. Navy
 * (not black, not Facebook blue) keeps it visually distinct from both
 * WebHighlighter's dark/yellow tile and Meta Ad Winner's icon, which shares
 * this product's platform but not its shape. Rendered with 4x4 supersampling
 * so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [17, 33, 61]; // #11213D — navy
const BULB = [255, 196, 61]; // #FFC43D — amber
const BULB_SHADE = [217, 155, 20]; // subtle depth on the glass
const BASE = [214, 219, 226]; // #D6DBE2 — the socket
const RAY = [255, 214, 128]; // lighter amber for the idea rays
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

function inRoundedRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  if (x < x0 - r || x > x1 + r || y < y0 - r || y > y1 + r) return false;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** The bulb: a circle (glass) + a socket (rounded rect) + three idea rays. */
function bulbColorAt(x, y, size) {
  const bulbCx = size * 0.5;
  const bulbCy = size * 0.42;
  const bulbR = size * 0.2;

  // Rays first (they sit behind/around the glass, at the top corners).
  const rayR = size * 0.035;
  const rays = [
    [bulbCx - bulbR * 1.05, bulbCy - bulbR * 0.85],
    [bulbCx + bulbR * 1.05, bulbCy - bulbR * 0.85],
    [bulbCx, bulbCy - bulbR * 1.35],
  ];
  for (const [rx, ry] of rays) {
    if (inCircle(x, y, rx, ry, rayR)) return RAY;
  }

  // The socket, drawn before the glass so the glass's bottom edge overlaps it.
  const socketX0 = bulbCx - bulbR * 0.42;
  const socketX1 = bulbCx + bulbR * 0.42;
  const socketY0 = bulbCy + bulbR * 0.55;
  const socketY1 = bulbCy + bulbR * 1.15;
  if (inRoundedRect(x, y, socketX0, socketY0, socketX1, socketY1, size * 0.02)) return BASE;

  if (inCircle(x, y, bulbCx, bulbCy, bulbR)) {
    // A soft lower-right shade for a little depth, cheap and cheerful.
    return inCircle(x, y, bulbCx + bulbR * 0.3, bulbCy + bulbR * 0.3, bulbR * 0.75) ? BULB : BULB_SHADE;
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
          const color = bulbColorAt(x, y, size) ?? TILE;
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
