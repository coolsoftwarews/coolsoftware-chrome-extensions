/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark teal tile with a white rounded "page" (the reading view
 * this product produces) and a bright green circular "roll" end poking out
 * from behind its left edge — the thread being pulled out flat. Three dark
 * horizontal bars inside the page stand in for lines of unrolled text.
 * Deliberately distinct from every other extension's mark in this portfolio
 * (WebHighlighter's bars-on-navy, XConversationSaver's bookmark ribbon,
 * PinterestOpportunityFinder's flame) — a document/scroll glyph, not a
 * bookmark or a chart. The accent green matches panel.css's --accent, same
 * "icon and in-product colour agree" choice PinterestOpportunityFinder's
 * build made. Rendered with 4x4 supersampling so the 16px icon still reads.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [10, 46, 42]; // #0A2E2A — dark teal, distinct from siblings' navy/near-black tiles
const PAGE = [255, 255, 255];
const LINE = [10, 46, 42]; // same as TILE — reads as dark text on the white page
const ACCENT = [61, 220, 151]; // #3DDC97 — matches panel.css's --accent
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

const PAGE_LEFT = 0.3;
const PAGE_RIGHT = 0.82;
const PAGE_TOP = 0.22;
const PAGE_BOTTOM = 0.78;
const PAGE_RADIUS = 0.05;

function insidePage(x, y, size) {
  const left = PAGE_LEFT * size;
  const right = PAGE_RIGHT * size;
  const top = PAGE_TOP * size;
  const bottom = PAGE_BOTTOM * size;
  const r = PAGE_RADIUS * size;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = Math.min(Math.max(y, top + r), bottom - r);
  const dx = x - cx;
  const dy = y - cy;
  if (x < left || x > right || y < top || y > bottom) return false;
  if ((x < left + r || x > right - r) && (y < top + r || y > bottom - r)) return dx * dx + dy * dy <= r * r;
  return true;
}

function insideScrollCap(x, y, size) {
  const cx = PAGE_LEFT * size;
  const cy = 0.5 * size;
  const r = 0.16 * size;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

const LINE_BANDS = [
  [0.34, 0.39],
  [0.47, 0.52],
  [0.6, 0.65],
];

function insideLine(x, y, size) {
  const left = (PAGE_LEFT + 0.06) * size;
  const right = (PAGE_RIGHT - 0.06) * size;
  if (x < left || x > right) return false;
  return LINE_BANDS.some(([top, bottom]) => y >= top * size && y <= bottom * size);
}

function colorAt(x, y, size) {
  if (insidePage(x, y, size)) {
    return insideLine(x, y, size) ? LINE : PAGE;
  }
  if (insideScrollCap(x, y, size)) return ACCENT;
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
