/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded terracotta tile (nods to Etsy's own palette without
 * copying it) with a small magnifying glass over three ascending bars — "find
 * the shape of a market", not "shop". Rendered with 4x4 supersampling so the
 * 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [39, 27, 22]; // #271B16 — deep terracotta-brown
const BARS_COLOR = [255, 255, 255];
const ACCENT = [242, 133, 45]; // #F2852D — warm orange, the "find" mark
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

/**
 * Three ascending bars (a tiny bar chart — "read the niche") sitting behind a
 * magnifying-glass ring drawn in the accent colour.
 */
const BARS = [
  [0.24, 0.36, 0.62, 0.2],
  [0.4, 0.52, 0.5, 0.32],
  [0.56, 0.68, 0.38, 0.44],
];

function barColorAt(x, y, size) {
  for (const [x0, x1, yBottomFrac, heightFrac] of BARS) {
    const left = x0 * size;
    const right = x1 * size;
    const bottom = 0.74 * size;
    const top = bottom - heightFrac * size;
    if (x < left || x > right || y < top || y > bottom) continue;
    return BARS_COLOR;
  }
  return null;
}

/** A ring (magnifying glass) plus a short handle, in the accent colour. */
function glassColorAt(x, y, size) {
  const cx = 0.62 * size;
  const cy = 0.36 * size;
  const outerR = 0.2 * size;
  const innerR = 0.13 * size;
  const dx = x - cx;
  const dy = y - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist <= outerR && dist >= innerR) return ACCENT;

  // Handle: a short diagonal stroke from the ring's lower-right edge.
  const hx0 = cx + innerR * 0.75;
  const hy0 = cy + innerR * 0.75;
  const hx1 = 0.86 * size;
  const hy1 = 0.86 * size;
  const t = ((x - hx0) * (hx1 - hx0) + (y - hy0) * (hy1 - hy0)) / ((hx1 - hx0) ** 2 + (hy1 - hy0) ** 2);
  if (t < 0 || t > 1) return null;
  const px = hx0 + t * (hx1 - hx0);
  const py = hy0 + t * (hy1 - hy0);
  const perpDist = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
  return perpDist <= 0.045 * size ? ACCENT : null;
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
          const color = glassColorAt(x, y, size) ?? barColorAt(x, y, size) ?? TILE;
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
