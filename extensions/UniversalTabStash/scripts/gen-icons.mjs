/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: three stacked browser-tab cards, offset diagonally like a deck of
 * cards, with the front-most card picked out in the panel's accent blue — a
 * stashed set of tabs, one glyph. Rendered with 4x4 supersampling so the 16px
 * icon still reads cleanly. Same technique as WebHighlighter's gen-icons.mjs.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [31, 31, 31]; // #1F1F1F
const BACK_CARD = [90, 92, 96]; // muted grey — the stashed, "behind" tabs
const MID_CARD = [140, 143, 148];
const FRONT_CARD = [26, 115, 232]; // #1A73E8 — the panel's accent blue
const NOTCH = [255, 255, 255];
const SAMPLES = 4;

const CORNER_RADIUS = 0.22; // outer tile

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/**
 * Three rounded "tab card" rectangles, each as fractions of the icon size,
 * drawn back-to-front so later entries sit on top of earlier ones — a simple
 * painter's algorithm that reads as depth even at 16px.
 */
const CARDS = [
  { x: 0.16, y: 0.16, w: 0.56, h: 0.36, r: 0.06, color: BACK_CARD },
  { x: 0.22, y: 0.28, w: 0.56, h: 0.36, r: 0.06, color: MID_CARD },
  { x: 0.28, y: 0.4, w: 0.56, h: 0.36, r: 0.06, color: FRONT_CARD },
];

/** A small notch at the top-left of the front card — the browser "active tab"
 *  affordance, so the shape reads as a tab and not just a generic card. */
const NOTCH_RECT = { x: 0.28, y: 0.4, w: 0.2, h: 0.09, r: 0.03 };

function insideRoundedRect(x, y, rect, size) {
  const rx0 = rect.x * size;
  const ry0 = rect.y * size;
  const rw = rect.w * size;
  const rh = rect.h * size;
  const radius = rect.r * size;

  if (x < rx0 || x > rx0 + rw || y < ry0 || y > ry0 + rh) return false;

  const cx = Math.min(Math.max(x, rx0 + radius), rx0 + rw - radius);
  const cy = Math.min(Math.max(y, ry0 + radius), ry0 + rh - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function colorAt(x, y, size) {
  let color = null;
  for (const card of CARDS) {
    if (insideRoundedRect(x, y, card, size)) color = card.color;
  }
  if (color === FRONT_CARD && insideRoundedRect(x, y, NOTCH_RECT, size)) color = NOTCH;
  return color;
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
