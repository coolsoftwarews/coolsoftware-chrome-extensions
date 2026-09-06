/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a rounded deep-indigo tile with a white folder silhouette (the
 * "organize" half of this product) and a small amber tag/dot accent
 * overlapping its bottom-right corner (the "tag" half) — a folder+tag glyph,
 * deliberately distinct from XConversationSaver's dark-navy bookmark-ribbon
 * mark, XThreadUnroll's dark-teal reading-page mark, and WebHighlighter's
 * dark-tile-with-yellow-bars mark — a different hue family (indigo/violet)
 * from every other X-platform extension's icon in this portfolio, not just a
 * different shape. Rendered with 4x4 supersampling so the 16px icon still
 * reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [37, 27, 74]; // #251B4A — deep indigo, distinct from XConversationSaver's navy #15202B and XThreadUnroll's dark teal
const FOLDER = [255, 255, 255];
const ACCENT = [245, 166, 35]; // #F5A623 — amber, distinct from any coral/pink accent already in the portfolio
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

/** The folder tab: a trapezoid whose right edge slants down from the peak to
 *  meet the body's top edge — the classic manila-folder-tab silhouette. */
function insideFolderTab(x, y, size) {
  const left = 0.16 * size;
  const top = 0.22 * size;
  const bottom = 0.34 * size;
  const peakRight = 0.40 * size;
  const baseRight = 0.54 * size;
  if (x < left || y < top || y > bottom) return false;
  const t = (y - top) / (bottom - top);
  const rightEdge = peakRight + (baseRight - peakRight) * t;
  return x <= rightEdge;
}

/** The folder body — a simple rounded rectangle beneath the tab. */
function insideFolderBody(x, y, size) {
  const left = 0.16 * size;
  const right = 0.84 * size;
  const top = 0.34 * size;
  const bottom = 0.80 * size;
  const r = 0.05 * size;
  if (x < left || x > right || y < top || y > bottom) return false;
  // Only the top-right corner needs rounding (top-left meets the tab, bottom
  // corners sit near the tile edge and read fine square at icon sizes).
  if (x > right - r && y < top + r) {
    const dx = x - (right - r);
    const dy = y - (top + r);
    return dx * dx + dy * dy <= r * r;
  }
  return true;
}

function insideFolder(x, y, size) {
  return insideFolderTab(x, y, size) || insideFolderBody(x, y, size);
}

/** A small tag/dot accent overlapping the folder's bottom-right corner. */
function insideAccent(x, y, size) {
  const cx = 0.68 * size;
  const cy = 0.66 * size;
  const r = 0.115 * size;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function colorAt(x, y, size) {
  if (insideAccent(x, y, size)) return ACCENT;
  if (insideFolder(x, y, size)) return FOLDER;
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
