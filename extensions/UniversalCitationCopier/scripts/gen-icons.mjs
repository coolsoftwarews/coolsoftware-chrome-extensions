/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark rounded tile with a stylized opening quotation mark
 * (two comma strokes, upper-left) and a single chain-link ring (lower-right)
 * — "quote this page, link included" in one glyph. Rendered with 4x4
 * supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [20, 27, 45]; // #14213D — dark navy, distinct from the portfolio's other extension icons
const ACCENT = [79, 140, 255]; // #4F8CFF — the popup's accent blue
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

/** Point-to-segment distance, for drawing a rounded "capsule" stroke. */
function distanceToSegment(x, y, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  const t = lenSq === 0 ? 0 : Math.min(1, Math.max(0, ((x - ax) * abx + (y - ay) * aby) / lenSq));
  const px = ax + t * abx;
  const py = ay + t * aby;
  const dx = x - px;
  const dy = y - py;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A single typographic comma stroke: a short capsule angled down-and-left,
 * which is what two of, side by side, read as an opening "quote mark.
 */
function insideComma(x, y, size, originXFrac, originYFrac) {
  const ax = originXFrac * size;
  const ay = originYFrac * size;
  const length = 0.15 * size;
  const angle = (65 * Math.PI) / 180; // down and slightly left
  const bx = ax - Math.sin(angle) * length * 0.5;
  const by = ay + Math.cos(angle) * length;
  const radius = 0.065 * size;
  return distanceToSegment(x, y, ax, ay, bx, by) <= radius;
}

/** A single chain-link ring: an annulus (a circle with its center hollowed out). */
function insideRing(x, y, size, cxFrac, cyFrac) {
  const cx = cxFrac * size;
  const cy = cyFrac * size;
  const outer = 0.155 * size;
  const inner = outer - 0.05 * size;
  const dist = Math.hypot(x - cx, y - cy);
  return dist <= outer && dist >= inner;
}

function colorAt(x, y, size) {
  if (insideComma(x, y, size, 0.32, 0.3) || insideComma(x, y, size, 0.47, 0.3)) return ACCENT;
  if (insideRing(x, y, size, 0.66, 0.68)) return ACCENT;
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
