/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a white briefcase (body + handle loop) on a LinkedIn-blue tile,
 * with a small green "tracked" checkmark badge in the corner — a
 * briefcase/checklist motif, deliberately distinct in both shape and tile
 * color from LinkedInCreatorWatchlist's near-black tile + blue eye mark, so
 * the two LinkedIn extensions in this portfolio are unmistakable side by
 * side in a toolbar. Rendered with 4x4 supersampling so the 16px icon still
 * reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [10, 102, 194]; // #0A66C2 — LinkedIn blue
const CASE_WHITE = [255, 255, 255];
const BADGE_BG = [15, 138, 90]; // a "tracked/offer" green, distinct from the tile
const BADGE_MARK = [255, 255, 255];
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

function insideRoundedRect(x, y, x0, y0, x1, y1, radiusFrac, size) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const r = radiusFrac * size;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby || 1;
  let t = ((px - ax) * abx + (py - ay) * aby) / lengthSq;
  t = Math.min(1, Math.max(0, t));
  const cx = ax + t * abx;
  const cy = ay + t * aby;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

/* ── Briefcase geometry, as fractions of the icon size ─────────────────── */

const BODY = { x0: 0.2, y0: 0.44, x1: 0.8, y1: 0.82 };
const BODY_RADIUS = 0.05;
const HANDLE_OUTER = { x0: 0.4, y0: 0.24, x1: 0.6, y1: 0.46 };
const HANDLE_INNER = { x0: 0.445, y0: 0.24, x1: 0.555, y1: 0.4 };
const SEAM_Y0 = 0.585;
const SEAM_Y1 = 0.625;
const CLASP = { x0: 0.465, y0: 0.55, x1: 0.535, y1: 0.66 };

function insideHandle(x, y, size) {
  const px = x / size;
  const py = y / size;
  const outer = insideRect(px, py, HANDLE_OUTER.x0, HANDLE_OUTER.y0, HANDLE_OUTER.x1, HANDLE_OUTER.y1);
  if (!outer) return false;
  const inner = insideRect(px, py, HANDLE_INNER.x0, HANDLE_INNER.y0, HANDLE_INNER.x1, HANDLE_INNER.y1);
  return !inner;
}

function insideBody(x, y, size) {
  return insideRoundedRect(x, y, BODY.x0 * size, BODY.y0 * size, BODY.x1 * size, BODY.y1 * size, BODY_RADIUS, size);
}

/** The seam line + clasp are cut through the white body so the tile color shows the case is "closed". */
function insideSeamCut(x, y, size) {
  const px = x / size;
  const py = y / size;
  if (py >= SEAM_Y0 && py <= SEAM_Y1 && px >= BODY.x0 && px <= BODY.x1) return true;
  return insideRect(px, py, CLASP.x0, CLASP.y0, CLASP.x1, CLASP.y1);
}

/* ── "Tracked" badge: a small filled circle with a white checkmark ─────── */

const BADGE_CX = 0.79;
const BADGE_CY = 0.79;
const BADGE_R = 0.185;
const CHECK_THICKNESS = 0.032;

function insideBadge(x, y, size) {
  return insideCircle(x, y, BADGE_CX * size, BADGE_CY * size, BADGE_R * size);
}

function insideCheckmark(x, y, size) {
  const thickness = CHECK_THICKNESS * size;
  const ax = (BADGE_CX - 0.075) * size;
  const ay = BADGE_CY * size;
  const bx = (BADGE_CX - 0.02) * size;
  const by = (BADGE_CY + 0.06) * size;
  const cx = (BADGE_CX + 0.09) * size;
  const cy = (BADGE_CY - 0.08) * size;
  return distanceToSegment(x, y, ax, ay, bx, by) <= thickness || distanceToSegment(x, y, bx, by, cx, cy) <= thickness;
}

function colorAt(x, y, size) {
  if (insideBadge(x, y, size)) return insideCheckmark(x, y, size) ? BADGE_MARK : BADGE_BG;
  if (insideHandle(x, y, size)) return CASE_WHITE;
  if (insideBody(x, y, size)) return insideSeamCut(x, y, size) ? TILE : CASE_WHITE;
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
