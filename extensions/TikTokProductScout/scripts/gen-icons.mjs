/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark rounded tile with a magnifying glass (the "scout" in the
 * name) and a small hot-pink flare where the lens meets the handle — the
 * ratio badge's 🔥 in miniature, and the one bit of colour that reads as
 * "TikTok-adjacent" without borrowing TikTok's own mark. Rendered with 4x4
 * supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [17, 15, 15]; // near-black, warmer than pure grey
const GLASS = [255, 255, 255];
const FLARE = [255, 44, 85]; // TikTok-adjacent hot pink, used sparingly
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

// Lens centre and radius, as fractions of the icon size.
const LENS_CX = 0.42;
const LENS_CY = 0.4;
const LENS_R = 0.2;
const STROKE = 0.085;

// Handle: a short segment from the lens's lower-right edge out to the corner.
const HANDLE_LEN = 0.28;
const HANDLE_ANGLE = Math.PI / 4; // 45°, pointing down-right

function distToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, (apx * abx + apy * aby) / lenSq));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function colorAt(x, y, size) {
  const nx = x / size;
  const ny = y / size;

  const lensCx = LENS_CX * size;
  const lensCy = LENS_CY * size;
  const lensR = LENS_R * size;
  const stroke = STROKE * size;

  const distToCenter = Math.hypot(x - lensCx, y - lensCy);

  // Flare: a small filled dot sitting on the lens ring at its lower-right,
  // where the badge's 🔥 would sit relative to the ratio number.
  const flareCx = lensCx + lensR * Math.cos(HANDLE_ANGLE - 0.15);
  const flareCy = lensCy + lensR * Math.sin(HANDLE_ANGLE - 0.15);
  const flareR = size * 0.075;
  if (Math.hypot(x - flareCx, y - flareCy) <= flareR) return FLARE;

  // Ring.
  if (Math.abs(distToCenter - lensR) <= stroke / 2) return GLASS;

  // Handle, starting just outside the ring so it doesn't double-draw the stroke.
  const startX = lensCx + (lensR + stroke * 0.3) * Math.cos(HANDLE_ANGLE);
  const startY = lensCy + (lensR + stroke * 0.3) * Math.sin(HANDLE_ANGLE);
  const endX = lensCx + (lensR + HANDLE_LEN * size) * Math.cos(HANDLE_ANGLE);
  const endY = lensCy + (lensR + HANDLE_LEN * size) * Math.sin(HANDLE_ANGLE);
  if (distToSegment(x, y, startX, startY, endX, endY) <= stroke / 2.4) return GLASS;

  void nx;
  void ny;
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
