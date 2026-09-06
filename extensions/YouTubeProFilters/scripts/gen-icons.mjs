#!/usr/bin/env node
/**
 * Generates the four PNG icons with a hand-rolled encoder, so the repo needs
 * no image toolchain and no binary assets in git. The mark is a descending
 * three-bar filter over YouTube red — a funnel read at 16px.
 */
import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'public/icons');

const RED = [196, 48, 43, 255];
const WHITE = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

/** Rounded-square background, three centred bars of decreasing width. */
function pixel(x, y, size) {
  const unit = size / 16;
  const radius = 3 * unit;

  // Rounded corner test against the nearest corner circle.
  const dx = Math.min(x, size - 1 - x);
  const dy = Math.min(y, size - 1 - y);
  if (dx < radius && dy < radius) {
    const distance = Math.hypot(radius - dx, radius - dy);
    if (distance > radius) return TRANSPARENT;
  }

  const bars = [
    { top: 4, width: 10 },
    { top: 7.5, width: 6.5 },
    { top: 11, width: 3 },
  ];
  for (const bar of bars) {
    const top = bar.top * unit;
    const height = 1.8 * unit;
    const left = (size - bar.width * unit) / 2;
    if (y >= top && y < top + height && x >= left && x < left + bar.width * unit) return WHITE;
  }
  return RED;
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
  await writeFile(resolve(outdir, `icon${size}.png`), encodePng(size));
}
console.log(`wrote 4 icons → ${outdir}`);
