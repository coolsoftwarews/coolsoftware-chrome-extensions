/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded dark tile with a small ascending bar chart — three bars
 * near the profile's median, and a fourth that spikes well above them in
 * TikTok's accent pink, capped with a small triangular "flame" tip. That's
 * the product in one glyph — an outlier breaking out above the baseline —
 * and it reads distinctly from the other products in this platform pair
 * (this one is about content that broke out; the commercial-intelligence
 * pair uses a different mark and colour entirely).
 *
 * Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [18, 18, 23]; // #121217 — near-black, TikTok's own tile colour
const BASELINE_BAR = [37, 244, 238]; // #25F4EE — TikTok cyan, the "normal" bars
const OUTLIER_BAR = [254, 44, 85]; // #FE2C55 — TikTok pink/red, the breakout bar
const SAMPLES = 4;

const BASELINE_Y = 0.8;

/** Bars as [xStart, xEnd, height, colour]; the last one is the outlier. */
const BARS = [
  [0.14, 0.29, 0.2, BASELINE_BAR],
  [0.35, 0.5, 0.26, BASELINE_BAR],
  [0.56, 0.71, 0.22, BASELINE_BAR],
  [0.77, 0.92, 0.56, OUTLIER_BAR],
];

/** A small triangular tip on the outlier bar — the "spike broke out" accent. */
const SPIKE = { xStart: 0.77, xEnd: 0.92, tipHeight: 0.1 };

const CORNER_RADIUS = 0.22;
const BAR_CORNER_RADIUS = 0.02;

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideBar(x, y, size, xStart, xEnd, height) {
  const left = xStart * size;
  const right = xEnd * size;
  const top = (BASELINE_Y - height) * size;
  const bottom = BASELINE_Y * size;
  const r = Math.min(BAR_CORNER_RADIUS * size, (right - left) / 2, (bottom - top) / 2);

  if (x < left || x > right || y < top || y > bottom) return false;
  // Round only the top corners, so the bar still sits flush on the baseline.
  if (y > top + r) return true;
  const cx = Math.min(Math.max(x, left + r), right - r);
  const cy = top + r;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideSpikeTip(x, y, size) {
  const left = SPIKE.xStart * size;
  const right = SPIKE.xEnd * size;
  const mid = (left + right) / 2;
  const tipTop = (BASELINE_Y - BARS[3][2] - SPIKE.tipHeight) * size;
  const barTop = (BASELINE_Y - BARS[3][2]) * size;
  if (y < tipTop || y > barTop) return false;
  // Linear taper from the bar's full width down to a point.
  const progress = (y - tipTop) / (barTop - tipTop);
  const halfWidth = ((right - left) / 2) * progress;
  return Math.abs(x - mid) <= halfWidth;
}

/** The colour drawn at a point, or null when only the tile shows through. */
function colorAt(x, y, size) {
  for (const [xStart, xEnd, height, color] of BARS) {
    if (insideBar(x, y, size, xStart, xEnd, height)) return color;
  }
  if (insideSpikeTip(x, y, size)) return OUTLIER_BAR;
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
