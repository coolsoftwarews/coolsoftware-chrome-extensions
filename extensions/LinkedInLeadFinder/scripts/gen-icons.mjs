/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded LinkedIn-blue tile with a simple "person" silhouette and
 * a small orange target/dot at the lower right — engagement turned into a
 * prospect. Deliberately different from LinkedIn Creator Watchlist's mark (a
 * different product on the same platform): that one is about content, this
 * one is a person + a target, in a colour LinkedIn Creator Watchlist does not
 * use. Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [0, 40, 77]; // #00284D — a dark navy, distinct from LinkedIn's own blue
const PERSON = [255, 255, 255];
const TARGET_RING = [255, 255, 255];
const TARGET_DOT = [255, 140, 26]; // #FF8C1A — warm accent, reads as "lead found"
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

function inCircle(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function inRing(x, y, cx, cy, rOuter, rInner) {
  const dx = x - cx;
  const dy = y - cy;
  const d2 = dx * dx + dy * dy;
  return d2 <= rOuter * rOuter && d2 >= rInner * rInner;
}

/** A simple head-and-shoulders silhouette, sized as fractions of the icon. */
function inPerson(x, y, size) {
  const headCx = size * 0.42;
  const headCy = size * 0.36;
  const headR = size * 0.16;
  if (inCircle(x, y, headCx, headCy, headR)) return true;

  // Shoulders: a wide rounded rectangle-ish arc beneath the head.
  const shoulderCx = size * 0.4;
  const shoulderCy = size * 0.86;
  const shoulderR = size * 0.32;
  if (y < size * 0.58) return false;
  return inCircle(x, y, shoulderCx, shoulderCy, shoulderR) && y <= size * 0.8;
}

/** Target: a ring plus a filled dot, lower right — "found". */
function targetColorAt(x, y, size) {
  const cx = size * 0.74;
  const cy = size * 0.72;
  const outer = size * 0.26;
  const ringWidth = size * 0.055;
  const dotR = size * 0.09;

  if (inCircle(x, y, cx, cy, dotR)) return TARGET_DOT;
  if (inRing(x, y, cx, cy, outer, outer - ringWidth)) return TARGET_RING;
  return null;
}

function colorAt(x, y, size) {
  const target = targetColorAt(x, y, size);
  if (target) return target;
  if (inPerson(x, y, size)) return PERSON;
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
