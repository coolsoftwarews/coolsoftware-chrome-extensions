/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark rounded tile with a simple download arrow (the "archive
 * your own video" action) and a small hot-pink dot at the arrow's tip — the
 * one bit of colour that reads as "TikTok-adjacent" without borrowing
 * TikTok's own mark. Rendered with 4x4 supersampling so the 16px icon still
 * reads cleanly. Same technique as TikTokProductScout's gen-icons.mjs.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [17, 15, 15]; // near-black, warmer than pure grey
const GLYPH = [255, 255, 255];
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

// Download arrow: a vertical stem with a chevron head, centred slightly
// above middle so the flare + baseline tray sit below it.
const STEM_X = 0.5;
const STEM_TOP = 0.24;
const STEM_BOTTOM = 0.56;
const STROKE = 0.09;

const HEAD_Y = STEM_BOTTOM;
const HEAD_HALF_WIDTH = 0.16;
const HEAD_HEIGHT = 0.16;

const TRAY_Y = 0.74;
const TRAY_HALF_WIDTH = 0.22;

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
  const stroke = STROKE * size;

  const stemX = STEM_X * size;
  const stemTop = STEM_TOP * size;
  const stemBottom = STEM_BOTTOM * size;

  // Flare: a small filled dot sitting where the arrowhead points, echoing
  // the ratio badges elsewhere in this portfolio's TikTok icon family.
  const flareCx = stemX + HEAD_HALF_WIDTH * size * 0.9;
  const flareCy = TRAY_Y * size;
  const flareR = size * 0.06;
  if (Math.hypot(x - flareCx, y - flareCy) <= flareR) return FLARE;

  // Stem.
  if (distToSegment(x, y, stemX, stemTop, stemX, stemBottom) <= stroke / 2) {
    return GLYPH;
  }

  // Arrowhead (two diagonal strokes forming a downward chevron).
  const headY = HEAD_Y * size;
  const leftStart = { x: stemX - HEAD_HALF_WIDTH * size, y: headY - HEAD_HEIGHT * size };
  const leftEnd = { x: stemX, y: headY };
  const rightStart = { x: stemX + HEAD_HALF_WIDTH * size, y: headY - HEAD_HEIGHT * size };
  const rightEnd = { x: stemX, y: headY };

  if (distToSegment(x, y, leftStart.x, leftStart.y, leftEnd.x, leftEnd.y) <= stroke / 2) return GLYPH;
  if (distToSegment(x, y, rightStart.x, rightStart.y, rightEnd.x, rightEnd.y) <= stroke / 2) return GLYPH;

  // Tray (a shallow "U" beneath the arrow — the download destination).
  const trayY = TRAY_Y * size;
  const trayLeft = { x: stemX - TRAY_HALF_WIDTH * size, y: trayY - size * 0.05 };
  const trayRight = { x: stemX + TRAY_HALF_WIDTH * size, y: trayY - size * 0.05 };
  const trayBottomLeft = { x: stemX - TRAY_HALF_WIDTH * size, y: trayY };
  const trayBottomRight = { x: stemX + TRAY_HALF_WIDTH * size, y: trayY };

  if (distToSegment(x, y, trayLeft.x, trayLeft.y, trayBottomLeft.x, trayBottomLeft.y) <= stroke / 2.4) return GLYPH;
  if (distToSegment(x, y, trayRight.x, trayRight.y, trayBottomRight.x, trayBottomRight.y) <= stroke / 2.4) return GLYPH;
  if (distToSegment(x, y, trayBottomLeft.x, trayBottomLeft.y, trayBottomRight.x, trayBottomRight.y) <= stroke / 2.4) return GLYPH;

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
