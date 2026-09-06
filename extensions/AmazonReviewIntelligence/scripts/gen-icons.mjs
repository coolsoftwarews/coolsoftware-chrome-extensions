/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a white speech bubble — the customer's voice — with a five-point
 * star knocked out of it, showing the tile's purple-to-teal gradient through
 * the cut. Purple/teal rather than WebHighlighter's dark tile or
 * YouTubeTranscription's blue, so this reads as a different product on the
 * same platform as the Amazon Product Opportunity Overlay at a glance.
 *
 * Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const SIZES = [16, 32, 48, 128];
const SAMPLES = 4;

const TILE_TOP = [0x6a, 0x3f, 0xd6]; // purple
const TILE_BOTTOM = [0x0f, 0x7a, 0x6c]; // teal
const INK = [255, 255, 255];
const CORNER_RADIUS = 0.215;

/* ── Geometry (fractions of the icon's edge) ────────────────────────── */

const BUBBLE = { x0: 0.16, x1: 0.84, y0: 0.16, y1: 0.62, r: 0.09 };
const TAIL = [
  [0.30, 0.60],
  [0.42, 0.60],
  [0.26, 0.80],
];
const STAR_CENTER = [0.5, 0.40];
const STAR_OUTER_R = 0.165;
const STAR_INNER_R = STAR_OUTER_R * 0.4;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function insideRoundedTile(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideRoundedRect(x, y, x0, x1, y0, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  if (x >= x0 + r && x <= x1 - r) return y >= y0 && y <= y1;
  if (y >= y0 + r && y <= y1 - r) return x >= x0 && x <= x1;
  return dx * dx + dy * dy <= r * r;
}

/** Even-odd point-in-polygon test — works for the non-convex star outline. */
function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function starPoints(cx, cy, outerR, innerR) {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

function renderRgba(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const step = 1 / SAMPLES;
  const total = SAMPLES * SAMPLES;

  const bubble = { x0: BUBBLE.x0 * size, x1: BUBBLE.x1 * size, y0: BUBBLE.y0 * size, y1: BUBBLE.y1 * size, r: BUBBLE.r * size };
  const tail = TAIL.map(([x, y]) => [x * size, y * size]);
  const star = starPoints(STAR_CENTER[0] * size, STAR_CENTER[1] * size, STAR_OUTER_R * size, STAR_INNER_R * size);
  const tileRadius = CORNER_RADIUS * size;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let inTile = 0;
      const sum = [0, 0, 0];

      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const x = px + (sx + 0.5) * step;
          const y = py + (sy + 0.5) * step;
          if (!insideRoundedTile(x, y, size, tileRadius)) continue;
          inTile++;

          const t = size === 1 ? 0 : y / size;
          const tileColor = [
            Math.round(lerp(TILE_TOP[0], TILE_BOTTOM[0], t)),
            Math.round(lerp(TILE_TOP[1], TILE_BOTTOM[1], t)),
            Math.round(lerp(TILE_TOP[2], TILE_BOTTOM[2], t)),
          ];

          const onBubble = insideRoundedRect(x, y, bubble.x0, bubble.x1, bubble.y0, bubble.y1, bubble.r) || insidePolygon(x, y, tail);
          const onStar = insidePolygon(x, y, star);
          const color = onBubble && !onStar ? INK : tileColor;

          for (let c = 0; c < 3; c++) sum[c] += color[c];
        }
      }

      const alpha = inTile / total;
      const offset = (py * size + px) * 4;
      if (alpha === 0) continue;

      for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(sum[c] / inTile);
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

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
for (const size of SIZES) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, encodePng(size, renderRgba(size)));
  console.log(`Wrote ${path.relative(process.cwd(), file)}`);
}
