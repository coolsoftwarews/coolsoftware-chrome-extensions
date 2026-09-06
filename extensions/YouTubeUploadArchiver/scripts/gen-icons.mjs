/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded deep-teal tile with a white thumbnail-frame rectangle
 * (a still image, never a playable stream — the one thing this extension
 * archives from a video) and a small amber archive-tray bar beneath it (the
 * "saved to a local log" half). Deliberately distinct from every other
 * YouTube-platform icon already in this portfolio: YouTubeChapterNotes uses
 * a note/pencil glyph, YouTubeHighlightMarker a highlighter stroke,
 * YouTubeSubcription a group-tile grid — this is the only one built around a
 * static picture frame, which is the point (thumbnail + metadata, not the
 * video). Rendered with 4x4 supersampling so the 16px icon still reads
 * cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [15, 61, 62]; // #0F3D3E — deep teal
const FRAME = [255, 255, 255];
const GLASS = [15, 61, 62]; // thumbnail "glass" reads as the tile colour, framed in white
const ACCENT = [242, 169, 59]; // #F2A93B — warm amber archive-tray accent
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

/** The thumbnail frame: a rounded-rect outline, white, occupying the upper
 *  two-thirds of the tile. */
function insideFrameOutline(x, y, size) {
  const left = 0.16 * size;
  const right = 0.84 * size;
  const top = 0.16 * size;
  const bottom = 0.62 * size;
  const border = 0.045 * size;
  const outer = x >= left && x <= right && y >= top && y <= bottom;
  const inner = x >= left + border && x <= right - border && y >= top + border && y <= bottom - border;
  return outer && !inner;
}

function insideFrameGlass(x, y, size) {
  const left = 0.16 * size;
  const right = 0.84 * size;
  const top = 0.16 * size;
  const bottom = 0.62 * size;
  const border = 0.045 * size;
  return x >= left + border && x <= right - border && y >= top + border && y <= bottom - border;
}

/** A small muted play triangle inside the frame's "glass" — reads as "this
 *  is a video's thumbnail", never as a control that plays anything. */
function insideMutedTriangle(x, y, size) {
  const cx = 0.5 * size;
  const cy = 0.39 * size;
  const s = 0.09 * size;
  const px = x - cx;
  const py = y - cy;
  // Equilateral-ish triangle pointing right.
  return px >= -s * 0.6 && px <= s && Math.abs(py) <= (s - px) * 0.6 && px <= s * (1 - Math.abs(py) / (s * 0.6));
}

/** The archive tray: a rounded amber bar beneath the frame. */
function insideArchiveBar(x, y, size) {
  const left = 0.16 * size;
  const right = 0.84 * size;
  const top = 0.70 * size;
  const bottom = 0.80 * size;
  return x >= left && x <= right && y >= top && y <= bottom;
}

function colorAt(x, y, size) {
  if (insideArchiveBar(x, y, size)) return ACCENT;
  if (insideFrameOutline(x, y, size)) return FRAME;
  if (insideMutedTriangle(x, y, size) && insideFrameGlass(x, y, size)) return FRAME;
  if (insideFrameGlass(x, y, size)) return GLASS;
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
