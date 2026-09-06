/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a flag-on-a-pin marker — a stem, a triangular flag near the top,
 * and a small dot at the base where the pin meets the timeline. It's the
 * shape a "marker" or "in/out point" reads as at a glance, and it is
 * deliberately not the arrow this portfolio's Transcript extension already
 * uses, nor any shape shared with a sibling extension's toolbar icon.
 *
 * Amber tile rather than YouTube's red or the Transcript extension's blue,
 * so three YouTube extensions in the same toolbar stay tellable apart.
 *
 * Rendered with 4x4 supersampling for anti-aliased edges at every size.
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

const TILE_TOP = [0xff, 0x9d, 0x2e];
const TILE_BOTTOM = [0xb4, 0x5c, 0x00];
const INK = [0x24, 0x13, 0x00];

/* ── Geometry (0..1 units of the icon's edge) ───────────────────────── */

const GEOMETRY = {
  cornerRadius: 0.215,
  stem: { x0: 0.44, x1: 0.56, y0: 0.2, y1: 0.8 },
  flag: { apex: [0.8, 0.32], topLeft: [0.44, 0.18], bottomLeft: [0.44, 0.44] },
  dot: { cx: 0.5, cy: 0.82, r: 0.09 },
};

function geometry(size) {
  const s = v => v * size;
  const scaleRect = r => ({ x0: s(r.x0), x1: s(r.x1), y0: s(r.y0), y1: s(r.y1) });
  const scalePoint = ([x, y]) => [s(x), s(y)];
  return {
    cornerRadius: s(GEOMETRY.cornerRadius),
    stem: scaleRect(GEOMETRY.stem),
    flag: {
      apex: scalePoint(GEOMETRY.flag.apex),
      topLeft: scalePoint(GEOMETRY.flag.topLeft),
      bottomLeft: scalePoint(GEOMETRY.flag.bottomLeft),
    },
    dot: { cx: s(GEOMETRY.dot.cx), cy: s(GEOMETRY.dot.cy), r: s(GEOMETRY.dot.r) },
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

function insideCircle(x, y, { cx, cy, r }) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function edge(px, py, a, b) {
  return (b[0] - a[0]) * (py - a[1]) - (b[1] - a[1]) * (px - a[0]);
}

function insideTriangle(x, y, { apex, topLeft, bottomLeft }) {
  const d1 = edge(x, y, topLeft, bottomLeft);
  const d2 = edge(x, y, bottomLeft, apex);
  const d3 = edge(x, y, apex, topLeft);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

function insideMark(x, y, g) {
  if (insideRect(x, y, g.stem)) return true;
  if (insideTriangle(x, y, g.flag)) return true;
  return insideCircle(x, y, g.dot);
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
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[12] = 0;

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
