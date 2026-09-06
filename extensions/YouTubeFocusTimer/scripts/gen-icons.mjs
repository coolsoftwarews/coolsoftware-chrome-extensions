/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a deep-teal tile with a white stopwatch ring (a crown button on
 * top, two clock hands pointing to a few minutes past the hour) and a small
 * warm-red dot on the rim marking where an eye-catching distraction surface
 * would sit — a timer/report glyph, deliberately distinct from
 * YouTubeProFilters' bars-in-a-tile and the portfolio's other
 * magnifying-glass/flame/ribbon marks. Rendered with 4x4 supersampling so
 * the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [12, 33, 41]; // #0C2129 — deep teal, distinct from the portfolio's slate/near-black tiles
const RING = [255, 255, 255]; // white stopwatch ring + hands
const ACCENT = [255, 79, 79]; // #FF4F4F — the "distraction" marker dot
const SAMPLES = 4;

const CORNER_RADIUS = 0.22;

const CENTER = [0.5, 0.56];
const OUTER_R = 0.34;
const RING_THICKNESS = 0.055;

const CROWN = { x0: 0.44, x1: 0.56, y0: 0.12, y1: 0.2 };
const HAND_MINUTE = { angle: -20, length: 0.27, width: 0.045 }; // degrees from 12 o'clock
const HAND_HOUR = { angle: 70, length: 0.16, width: 0.055 };

const ACCENT_CENTER = [0.78, 0.28];
const ACCENT_RADIUS = 0.075;

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideRing(x, y, size) {
  const cx = CENTER[0] * size;
  const cy = CENTER[1] * size;
  const outer = OUTER_R * size;
  const inner = (OUTER_R - RING_THICKNESS) * size;
  const d = Math.hypot(x - cx, y - cy);
  return d <= outer && d >= inner;
}

function insideCrown(x, y, size) {
  return (
    x >= CROWN.x0 * size && x <= CROWN.x1 * size && y >= CROWN.y0 * size && y <= CROWN.y1 * size
  );
}

/** Distance from point (x,y) to the segment from the clock center along `angle` degrees (0 = 12 o'clock, clockwise) for `length` * size, given a half-width in size units. */
function insideHand(x, y, size, hand) {
  const cx = CENTER[0] * size;
  const cy = CENTER[1] * size;
  const rad = (hand.angle * Math.PI) / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  const len = hand.length * size;
  const halfWidth = (hand.width * size) / 2;

  const px = x - cx;
  const py = y - cy;
  const along = px * dx + py * dy; // projection onto the hand direction
  const perp = px * -dy + py * dx; // perpendicular distance

  return along >= -halfWidth && along <= len && Math.abs(perp) <= halfWidth;
}

function insideAccent(x, y, size) {
  const cx = ACCENT_CENTER[0] * size;
  const cy = ACCENT_CENTER[1] * size;
  const r = ACCENT_RADIUS * size;
  return Math.hypot(x - cx, y - cy) <= r;
}

function colorAt(x, y, size) {
  if (insideAccent(x, y, size)) return ACCENT;
  if (insideCrown(x, y, size)) return RING;
  if (insideRing(x, y, size)) return RING;
  if (insideHand(x, y, size, HAND_MINUTE)) return RING;
  if (insideHand(x, y, size, HAND_HOUR)) return RING;
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
