/**
 * Generates public/icons/icon-{16,32,48,128}.png.
 *
 * Written by hand (raw PNG + zlib from Node's stdlib) so the build has no
 * image dependency — the mark is a rounded blue tile with white capture
 * brackets, which stays readable at 16px.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
const SIZES = [16, 32, 48, 128];
const TILE = [37, 99, 235, 255]; // #2563eb
const MARK = [255, 255, 255, 255];

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(resolve(OUT_DIR, `icon-${size}.png`), encodePng(size, drawIcon(size)));
  console.log(`icon-${size}.png`);
}

/** Returns RGBA pixel data for one icon at the given size. */
function drawIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const radius = size * 0.22;
  const inset = size * 0.06;
  const thickness = Math.max(1, Math.round(size * 0.09));
  const armStart = size * 0.26;
  const armEnd = size * 0.74;
  const bracket = size * 0.42;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      if (!insideRoundedRect(x + 0.5, y + 0.5, inset, size - inset, radius)) continue;

      const color = isBracket(x + 0.5, y + 0.5) ? MARK : TILE;
      pixels.set(color, offset);
    }
  }
  return pixels;

  // Four corner brackets: two strokes per corner, clear of the tile edge.
  function isBracket(px, py) {
    const nearLeft = Math.abs(px - armStart) < thickness / 2;
    const nearRight = Math.abs(px - armEnd) < thickness / 2;
    const nearTop = Math.abs(py - armStart) < thickness / 2;
    const nearBottom = Math.abs(py - armEnd) < thickness / 2;

    const inVertical = py >= armStart - thickness / 2 && py <= bracket
      || py >= size - bracket && py <= armEnd + thickness / 2;
    const inHorizontal = px >= armStart - thickness / 2 && px <= bracket
      || px >= size - bracket && px <= armEnd + thickness / 2;

    return ((nearLeft || nearRight) && inVertical) || ((nearTop || nearBottom) && inHorizontal);
  }
}

function insideRoundedRect(x, y, min, max, radius) {
  if (x < min || x > max || y < min || y > max) return false;
  const cx = Math.min(Math.max(x, min + radius), max - radius);
  const cy = Math.min(Math.max(y, min + radius), max - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

/** Minimal PNG encoder: IHDR + IDAT (filter 0 per row) + IEND. */
function encodePng(size, pixels) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    Buffer.from(pixels.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
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
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([length, body, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return crc ^ 0xffffffff;
}
