/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark rounded tile holding a tilted sticky note with a folded
 * corner, pinned down by a small red pin — a sticky-note/pin motif, distinct
 * from WebHighlighter's three-bars-with-a-highlight glyph in this same
 * portfolio. Rendered with 4x4 supersampling so the 16px icon still reads
 * cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [30, 41, 59]; // #1E293B — a deep slate, distinct from WebHighlighter's near-black tile
const NOTE = [255, 209, 71]; // #FFD147 — warm sticky-note yellow
const NOTE_FOLD = [214, 158, 46]; // darker gold for the dog-eared corner
const PIN = [220, 38, 38]; // #DC2626 — the pin
const PIN_SHINE = [255, 255, 255];
const SAMPLES = 4;

const CORNER_RADIUS = 0.22;
/** The note tilts a few degrees off-axis — a straight square would read as a
 * generic card, not a sticky note. */
const ROTATION = (-9 * Math.PI) / 180;

function insideRoundedTile(x, y, size) {
  const r = CORNER_RADIUS * size;
  const cx = Math.min(Math.max(x, r), size - r);
  const cy = Math.min(Math.max(y, r), size - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** The tilted note square, with its bottom-right corner folded over. */
function noteColorAt(x, y, size) {
  const cx = size * 0.5;
  const cy = size * 0.58;
  const half = size * 0.3;

  const dx = x - cx;
  const dy = y - cy;
  // Un-rotate the pixel into the note's own axis-aligned frame.
  const cos = Math.cos(-ROTATION);
  const sin = Math.sin(-ROTATION);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  if (lx < -half || lx > half || ly < -half || ly > half) return null;

  const fold = half * 0.55;
  const distFromCorner = half - lx + (half - ly);
  if (distFromCorner < fold) return NOTE_FOLD;
  return NOTE;
}

/** A small pin holding the note down, drawn on top and unrotated. */
function pinColorAt(x, y, size) {
  const px = size * 0.5;
  const py = size * 0.26;
  const r = size * 0.08;
  const dx = x - px;
  const dy = y - py;
  if (dx * dx + dy * dy > r * r) return null;

  const sx = px - r * 0.35;
  const sy = py - r * 0.35;
  const sr = r * 0.32;
  if ((x - sx) * (x - sx) + (y - sy) * (y - sy) <= sr * sr) return PIN_SHINE;
  return PIN;
}

function glyphColorAt(x, y, size) {
  return pinColorAt(x, y, size) ?? noteColorAt(x, y, size);
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
          const color = glyphColorAt(x, y, size) ?? TILE;
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
