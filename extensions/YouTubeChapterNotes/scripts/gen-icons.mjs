/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a deep violet rounded tile (distinct from both YouTube siblings
 * already in this portfolio — YouTubeTranscription's blue gradient and
 * YouTubeProFilters' YouTube-red funnel) with a white horizontal timeline
 * and a single amber map-pin marker sitting on it — a chapter marker
 * dropped onto a scrubber, which is the whole product in one glyph.
 * Rendered with 4x4 supersampling so the 16px icon still reads cleanly.
 * Same dependency-free PNG encoder (raw zlib deflate + hand-rolled PNG
 * chunks) used by every other extension in this portfolio.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [43, 28, 74]; // #2B1C4A deep violet
const TIMELINE = [235, 230, 245]; // near-white, faint violet cast
const PIN = [255, 176, 32]; // #FFB020 amber
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

/** Standard ray-casting point-in-polygon test, points as [x,y] fractions of size. */
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// The timeline: a horizontal bar, roughly two thirds down the tile.
const TIMELINE_X0 = 0.16;
const TIMELINE_X1 = 0.84;
const TIMELINE_Y0 = 0.62;
const TIMELINE_Y1 = 0.685;

// The pin: a circular head plus a tapering tail that touches the timeline —
// a classic map-pin silhouette, built the same way RedditVoiceOfCustomer's
// bookmark ribbon is (circle test + polygon test, unioned).
const PIN_CENTER = [0.435, 0.37];
const PIN_RADIUS = 0.155;
const PIN_TAIL_TOP_Y = 0.46;
const PIN_TAIL_HALF_WIDTH = 0.075;
const PIN_TIP = [0.435, TIMELINE_Y0 + (TIMELINE_Y1 - TIMELINE_Y0) / 2];
const PIN_TAIL_POLYGON = [
  [PIN_CENTER[0] - PIN_TAIL_HALF_WIDTH, PIN_TAIL_TOP_Y],
  [PIN_CENTER[0] + PIN_TAIL_HALF_WIDTH, PIN_TAIL_TOP_Y],
  PIN_TIP,
];

// A small knocked-out dot in the pin's head, so it doesn't read as a plain
// blob at larger sizes.
const PIN_HOLE_CENTER = PIN_CENTER;
const PIN_HOLE_RADIUS = 0.05;

function colorAt(xFrac, yFrac) {
  const dxPin = xFrac - PIN_CENTER[0];
  const dyPin = yFrac - PIN_CENTER[1];
  const inPinHead = dxPin * dxPin + dyPin * dyPin <= PIN_RADIUS * PIN_RADIUS;
  const inPinTail = pointInPolygon(xFrac, yFrac, PIN_TAIL_POLYGON);

  if (inPinHead || inPinTail) {
    const dxHole = xFrac - PIN_HOLE_CENTER[0];
    const dyHole = yFrac - PIN_HOLE_CENTER[1];
    if (dxHole * dxHole + dyHole * dyHole <= PIN_HOLE_RADIUS * PIN_HOLE_RADIUS) return TILE;
    return PIN;
  }

  if (xFrac >= TIMELINE_X0 && xFrac <= TIMELINE_X1 && yFrac >= TIMELINE_Y0 && yFrac <= TIMELINE_Y1) {
    return TIMELINE;
  }

  return TILE;
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
          const color = colorAt(x / size, y / size);
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
