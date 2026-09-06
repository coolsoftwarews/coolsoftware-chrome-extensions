#!/usr/bin/env node
/**
 * Generates the four PNG icons with a hand-rolled encoder (same technique as
 * every other extension in this portfolio — raw zlib deflate + hand-rolled
 * PNG chunks, no image library, no binary assets checked into git).
 *
 * The mark is a white speech bubble with three short "comment line" cutouts
 * and a small red unread-style accent dot — a digest motif, deliberately
 * distinct from this portfolio's other YouTube extensions: YouTubeProFilters
 * (red tile, descending filter bars), YouTubeSubcription (red tile, folder +
 * bar-chart cutout), YouTubeTranscription (blue tile, text lines + down
 * arrow). This one is a dark charcoal tile so it doesn't compete with any of
 * the three reds already in the toolbar.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'src/icons');

const TILE_TOP = [0x24, 0x2a, 0x33];
const TILE_BOTTOM = [0x14, 0x17, 0x1c];
const WHITE = [255, 255, 255, 255];
const ACCENT = [0xe3, 0x3a, 0x2e, 255];
const TRANSPARENT = [0, 0, 0, 0];

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function tileColor(y, size) {
  const t = y / size;
  return [
    Math.round(lerp(TILE_TOP[0], TILE_BOTTOM[0], t)),
    Math.round(lerp(TILE_TOP[1], TILE_BOTTOM[1], t)),
    Math.round(lerp(TILE_TOP[2], TILE_BOTTOM[2], t)),
    255,
  ];
}

function inRoundedRect(x, y, left, top, right, bottom, radius) {
  if (x < left || x > right || y < top || y > bottom) return false;
  const nearLeft = x < left + radius;
  const nearRight = x > right - radius;
  const nearTop = y < top + radius;
  const nearBottom = y > bottom - radius;

  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const cx = nearLeft ? left + radius : right - radius;
    const cy = nearTop ? top + radius : bottom - radius;
    return Math.hypot(x - cx, y - cy) <= radius;
  }
  return true;
}

/** Point-in-triangle via sign-of-area (the bubble's speech tail). */
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function pixel(x, y, size) {
  const unit = size / 16;
  const radius = 3 * unit;

  // Rounded-corner tile test (same shape as every other extension's icon).
  const dx = Math.min(x, size - 1 - x);
  const dy = Math.min(y, size - 1 - y);
  if (dx < radius && dy < radius) {
    const distance = Math.hypot(radius - dx, radius - dy);
    if (distance > radius) return TRANSPARENT;
  }

  const ux = x / unit;
  const uy = y / unit;

  const bubble = inRoundedRect(ux, uy, 2.5, 3.2, 13.5, 10.6, 1.8);
  const tail = inTriangle(ux, uy, 4.2, 10.2, 6.4, 10.2, 4.2, 12.6);
  const inBubble = bubble || tail;

  if (inBubble) {
    // Three short comment-line cutouts read through to the tile colour.
    const lines = [{ y: 5.4 }, { y: 7 }, { y: 8.6 }];
    for (const line of lines) {
      if (uy >= line.y && uy < line.y + 0.9 && ux >= 4 && ux < 11.5) {
        return tileColor(y, size);
      }
    }
    return WHITE;
  }

  // Small accent dot — an "unread" mark sitting just outside the bubble's top-right corner.
  const accentCx = 12.6;
  const accentCy = 2.6;
  if (Math.hypot(ux - accentCx, uy - accentCy) <= 1.5) return ACCENT;

  return tileColor(y, size);
}

function encodePng(size) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let offset = 0;
  for (let y = 0; y < size; y += 1) {
    raw[offset++] = 0; // filter type: none
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = pixel(x, y, size);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
      raw[offset++] = a;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

await mkdir(outdir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  await writeFile(resolve(outdir, `icon-${size}.png`), encodePng(size));
}
console.log(`wrote 4 icons → ${outdir}`);
