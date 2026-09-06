/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a warm metaball-blended flame on a dark navy-blue tile — the
 * same 🔥 language the in-page ratio badge uses for an outlier post,
 * distinct from the bar-chart mark InstagramOutlierFinder uses and from the
 * other LinkedIn extensions in this portfolio (LinkedIn Creator Watchlist's
 * "+ Watch" button glyph, LinkedIn Engagement Lead Finder's own mark).
 * Three overlapping circles combined via an r²/d² influence field, summed
 * and thresholded at 1, with radii tapering toward the tip for a hand-drawn
 * teardrop. Rendered with 4x4 supersampling so the 16px icon still reads
 * cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [15, 22, 33]; // #0F1621 — dark navy-blue, distinct from Instagram/TikTok outlier tiles
const FLAME_OUTER = [255, 122, 42]; // #FF7A2A — warm outlier orange, echoes the 🔥 badge
const FLAME_INNER = [255, 196, 92]; // #FFC45C — hot core highlight
const SAMPLES = 4;
const CORNER_RADIUS = 0.22;

// Metaballs forming a teardrop flame: base wide, tapering to a small offset tip.
const BALLS = [
  { cx: 0.5, cy: 0.66, r: 0.22 },
  { cx: 0.47, cy: 0.48, r: 0.16 },
  { cx: 0.53, cy: 0.32, r: 0.1 },
  { cx: 0.49, cy: 0.2, r: 0.045 },
];

const INNER_BALLS = [
  { cx: 0.5, cy: 0.68, r: 0.11 },
  { cx: 0.49, cy: 0.54, r: 0.075 },
];

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function fieldAt(x, y, size, balls) {
  let sum = 0;
  for (const ball of balls) {
    const dx = x - ball.cx * size;
    const dy = y - ball.cy * size;
    const dist2 = dx * dx + dy * dy;
    const r2 = (ball.r * size) * (ball.r * size);
    sum += r2 / Math.max(dist2, 0.0001);
  }
  return sum;
}

/** null (no flame), or a colour blended toward the hot core where the inner field also fires. */
function flameColorAt(x, y, size) {
  if (fieldAt(x, y, size, BALLS) < 1) return null;
  return fieldAt(x, y, size, INNER_BALLS) >= 1 ? FLAME_INNER : FLAME_OUTER;
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
          const color = flameColorAt(x, y, size) ?? TILE;
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
