/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded dark tile (Reddit's own near-black) with a lightbulb —
 * the PRD's own emoji for a match (💡) — inside a magnifying-glass ring, so
 * the icon reads as "find the idea", not "watch the feed" (PRD §10: the name
 * and mark should both avoid promising monitoring). Rendered with 4x4
 * supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [26, 26, 27]; // near-black, close to Reddit's own dark surface
const RING = [255, 255, 255];
const BULB = [255, 165, 0]; // warm orange — the "opportunity" colour
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

/** A magnifying glass: a ring plus a handle, both drawn as distance checks. */
function ringHandleColorAt(x, y, size) {
  const cx = size * 0.42;
  const cy = size * 0.42;
  const outerR = size * 0.26;
  const innerR = size * 0.185;
  const dxRing = x - cx;
  const dyRing = y - cy;
  const distRing = Math.sqrt(dxRing * dxRing + dyRing * dyRing);
  if (distRing <= outerR && distRing >= innerR) return RING;

  // Handle: a short diagonal bar from the ring's lower-right edge outward.
  const handleWidth = size * 0.09;
  const startX = cx + outerR * Math.SQRT1_2;
  const startY = cy + outerR * Math.SQRT1_2;
  const endX = size * 0.82;
  const endY = size * 0.82;
  const dx = endX - startX;
  const dy = endY - startY;
  const len = Math.sqrt(dx * dx + dy * dy);
  const t = Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / (len * len)));
  const px = startX + t * dx;
  const py = startY + t * dy;
  const distHandle = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
  if (distHandle <= handleWidth / 2 && t >= 0 && t <= 1) return RING;

  return null;
}

/** The bulb: a small filled circle sitting inside the ring, the "match found" mark. */
function bulbColorAt(x, y, size) {
  const cx = size * 0.42;
  const cy = size * 0.42;
  const r = size * 0.1;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r ? BULB : null;
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
          const color = bulbColorAt(x, y, size) ?? ringHandleColorAt(x, y, size) ?? TILE;
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
