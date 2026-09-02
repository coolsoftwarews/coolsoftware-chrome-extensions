/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: two lines of text with an arrow pulling down out of them — "the
 * words, taken with you". On a blue tile rather than YouTube's red, so the two
 * CoolSoftware extensions are told apart at a glance in a toolbar that already
 * has a red one in it.
 *
 * Rendered with 4x4 supersampling. 16 and 32 use hand-snapped, whole-pixel
 * geometry because the fluid proportions land between pixels at that size and
 * the arrow turns to mush.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

/* ── Palette ─────────────────────────────────────────────────────────── */

const TILE_TOP = [0x4a, 0x66, 0xff];
const TILE_BOTTOM = [0x16, 0x27, 0xc4];
const INK = [0xff, 0xff, 0xff];

/* ── Geometry ────────────────────────────────────────────────────────── */

/** Proportional geometry, in 0..1 units of the icon's edge. */
const FLUID = {
  cornerRadius: 0.215,
  bars: [
    { x0: 0.24, x1: 0.76, y0: 0.16, y1: 0.265 },
    { x0: 0.24, x1: 0.585, y0: 0.315, y1: 0.42 },
  ],
  stem: { x0: 0.435, x1: 0.565, y0: 0.46, y1: 0.7 },
  head: { apex: [0.5, 0.87], left: [0.285, 0.635], right: [0.715, 0.635] },
};

/** Whole-pixel variants for the two sizes where half a pixel is visible. */
const SNAPPED = {
  16: {
    cornerRadius: 3.6,
    bars: [
      { x0: 3, x1: 13, y0: 3, y1: 5 },
      { x0: 3, x1: 9, y0: 6, y1: 8 },
    ],
    stem: { x0: 7, x1: 10, y0: 9, y1: 12 },
    head: { apex: [8.5, 14], left: [5, 11], right: [12, 11] },
  },
  32: {
    cornerRadius: 7,
    bars: [
      { x0: 6, x1: 26, y0: 6, y1: 10 },
      { x0: 6, x1: 18, y0: 12, y1: 16 },
    ],
    stem: { x0: 14, x1: 20, y0: 18, y1: 24 },
    head: { apex: [17, 28], left: [10, 22], right: [24, 22] },
  },
};

/** Geometry for one size, always in pixel units. */
function geometry(size) {
  const snapped = SNAPPED[size];
  if (snapped) return snapped;

  const s = (v) => v * size;
  const scaleRect = (r) => ({ x0: s(r.x0), x1: s(r.x1), y0: s(r.y0), y1: s(r.y1) });
  const scalePoint = ([x, y]) => [s(x), s(y)];
  return {
    cornerRadius: s(FLUID.cornerRadius),
    bars: FLUID.bars.map(scaleRect),
    stem: scaleRect(FLUID.stem),
    head: {
      apex: scalePoint(FLUID.head.apex),
      left: scalePoint(FLUID.head.left),
      right: scalePoint(FLUID.head.right),
    },
  };
}

/* ── Shape tests ─────────────────────────────────────────────────────── */

function insideRoundedTile(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideRect(x, y, { x0, x1, y0, y1 }) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** Half-plane sign, used to test a point against a triangle edge. */
function edge(px, py, a, b) {
  return (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
}

function insideTriangle(x, y, { apex, left, right }) {
  const d1 = edge(x, y, left, right);
  const d2 = edge(x, y, right, apex);
  const d3 = edge(x, y, apex, left);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  // Inside when every edge agrees on a side, whichever winding the points have.
  return !(negative && positive);
}

function insideMark(x, y, g) {
  if (g.bars.some((bar) => insideRect(x, y, bar))) return true;
  if (insideRect(x, y, g.stem)) return true;
  return insideTriangle(x, y, g.head);
}

/* ── Raster ──────────────────────────────────────────────────────────── */

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function renderRgba(size) {
  const g = geometry(size);
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;
  const total = SAMPLES * SAMPLES;

  for (let py = 0; py < size; py++) {
    const t = size === 1 ? 0 : py / (size - 1);
    const tile = [
      Math.round(lerp(TILE_TOP[0], TILE_BOTTOM[0], t)),
      Math.round(lerp(TILE_TOP[1], TILE_BOTTOM[1], t)),
      Math.round(lerp(TILE_TOP[2], TILE_BOTTOM[2], t)),
    ];

    for (let px = 0; px < size; px++) {
      let inTile = 0;
      let inMark = 0;

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedTile(x, y, size, g.cornerRadius)) continue;
          inTile++;
          if (insideMark(x, y, g)) inMark++;
        }
      }

      const i = (py * size + px) * 4;
      if (inTile === 0) {
        pixels[i + 3] = 0;
        continue;
      }

      // White mark composited over the tile face, then tile coverage as alpha.
      const k = Math.min(inMark / inTile, 1);
      pixels[i] = Math.round(lerp(tile[0], INK[0], k));
      pixels[i + 1] = Math.round(lerp(tile[1], INK[1], k));
      pixels[i + 2] = Math.round(lerp(tile[2], INK[2], k));
      pixels[i + 3] = Math.round((inTile / total) * 255);
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

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  // One filter byte (0 = none) per scanline, as the PNG spec requires.
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[12] = 0; // interlace: none

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(outDir, { recursive: true });
for (const size of SIZES) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), encodePng(size, renderRgba(size)));
}
console.log(`wrote ${SIZES.length} icons → src/icons/`);
