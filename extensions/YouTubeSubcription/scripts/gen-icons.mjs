#!/usr/bin/env node
/**
 * Generate the extension icon set into ./icons.
 *
 * Hand-rolled PNG writer plus a tiny supersampling rasteriser so the build keeps
 * zero image dependencies.
 *
 * The mark is a folder — "a group of channels" — with a bar chart cut out of it
 * — "the stats". 16 and 32 use hand-snapped, whole-pixel geometry so the bars
 * stay crisp at toolbar size; 48 and 128 scale the fluid proportions.
 */

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];

/** Supersampling factor. 4 => 16 coverage samples per pixel. */
const SS = 4;

/* ── Palette ─────────────────────────────────────────────────────────── */

const RED_TOP = [0xff, 0x33, 0x24];
const RED_BOTTOM = [0xbf, 0x00, 0x0c];
const WHITE = [0xff, 0xff, 0xff];

/* ── Geometry, in 0..1 units of the icon's edge ──────────────────────── */

const TILE_RADIUS = 0.215;

const FLUID = {
  body: { x0: 0.155, y0: 0.365, x1: 0.845, y1: 0.79, r: 0.055 },
  tab: { x0: 0.155, y0: 0.245, x1: 0.475, y1: 0.42, r: 0.05 },
  base: 0.715,
  bars: [
    { x0: 0.265, x1: 0.375, top: 0.605 },
    { x0: 0.4425, x1: 0.5525, top: 0.535 },
    { x0: 0.62, x1: 0.73, top: 0.465 },
  ],
};

/**
 * At 16 and 32 the fluid geometry lands between pixels and the mark turns to
 * mush, so those two sizes get hand-snapped variants on a whole-pixel grid.
 */
const SNAPPED = {
  16: {
    tileRadius: 3.6,
    body: { x0: 2, y0: 6, x1: 14, y1: 13, r: 1.2 },
    tab: { x0: 2, y0: 4, x1: 7, y1: 7, r: 1 },
    base: 12,
    bars: [
      { x0: 4, x1: 6, top: 10 },
      { x0: 7, x1: 9, top: 9 },
      { x0: 10, x1: 12, top: 8 },
    ],
  },
  32: {
    tileRadius: 7,
    body: { x0: 4, y0: 12, x1: 28, y1: 26, r: 2.4 },
    tab: { x0: 4, y0: 8, x1: 14, y1: 14, r: 2 },
    base: 24,
    bars: [
      { x0: 8, x1: 12, top: 20 },
      { x0: 14, x1: 18, top: 18 },
      { x0: 20, x1: 24, top: 16 },
    ],
  },
};

/** Geometry for one size, always returned in pixel units. */
function geometry(size) {
  const snapped = SNAPPED[size];
  if (snapped) return snapped;

  const s = (v) => v * size;
  const scaleRect = (r) => ({
    x0: s(r.x0),
    y0: s(r.y0),
    x1: s(r.x1),
    y1: s(r.y1),
    r: s(r.r),
  });
  return {
    tileRadius: s(TILE_RADIUS),
    body: scaleRect(FLUID.body),
    tab: scaleRect(FLUID.tab),
    base: s(FLUID.base),
    bars: FLUID.bars.map((b) => ({ x0: s(b.x0), x1: s(b.x1), top: s(b.top) })),
  };
}

/* ── Rasteriser ──────────────────────────────────────────────────────── */

/** Signed containment test for an axis-aligned rounded rectangle. */
function inRoundedRect(px, py, { x0, y0, x1, y1, r }) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRect(px, py, { x0, y0, x1, y1 }) {
  return px >= x0 && px <= x1 && py >= y0 && py <= y1;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Coverage-sample one pixel. Returns { tile, mark } in 0..1 — how much of the
 * pixel is inside the red tile, and how much of it is white folder.
 */
function sample(x, y, size, g) {
  const tileRect = { x0: 0, y0: 0, x1: size, y1: size, r: g.tileRadius };
  let tile = 0;
  let mark = 0;

  for (let sy = 0; sy < SS; sy++) {
    for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS;
      const py = y + (sy + 0.5) / SS;

      if (!inRoundedRect(px, py, tileRect)) continue;
      tile++;

      const inFolder = inRoundedRect(px, py, g.body) || inRoundedRect(px, py, g.tab);
      if (!inFolder) continue;

      const inBar = g.bars.some((b) =>
        inRect(px, py, { x0: b.x0, y0: b.top, x1: b.x1, y1: g.base }),
      );
      if (!inBar) mark++;
    }
  }

  const total = SS * SS;
  return { tile: tile / total, mark: mark / total };
}

function pixels(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const g = geometry(size);

  for (let y = 0; y < size; y++) {
    // Vertical gradient across the tile face.
    const t = size === 1 ? 0 : y / (size - 1);
    const bg = [
      Math.round(lerp(RED_TOP[0], RED_BOTTOM[0], t)),
      Math.round(lerp(RED_TOP[1], RED_BOTTOM[1], t)),
      Math.round(lerp(RED_TOP[2], RED_BOTTOM[2], t)),
    ];

    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const { tile, mark } = sample(x, y, size, g);

      if (tile === 0) {
        rgba[i + 3] = 0;
        continue;
      }

      // Composite white mark over the red face, then apply tile coverage as alpha.
      const k = Math.min(mark / tile, 1);
      rgba[i] = Math.round(lerp(bg[0], WHITE[0], k));
      rgba[i + 1] = Math.round(lerp(bg[1], WHITE[1], k));
      rgba[i + 2] = Math.round(lerp(bg[2], WHITE[2], k));
      rgba[i + 3] = Math.round(tile * 255);
    }
  }
  return rgba;
}

/* ── PNG encoding ────────────────────────────────────────────────────── */

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

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
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(iconsDir, { recursive: true });
for (const size of SIZES) {
  await writeFile(resolve(iconsDir, `icon${size}.png`), encodePng(size, pixels(size)));
}
console.log(`wrote ${SIZES.length} icons → icons/`);
