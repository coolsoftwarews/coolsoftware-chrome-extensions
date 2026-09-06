/**
 * Generates the extension icons as PNGs with no image dependency.
 *
 * The mark: a dark rounded tile with two overlapping "card" shapes — a
 * research library, not a single pin — and a small red "+" badge on the
 * front card's corner, echoing the in-page "+ Save to research" button.
 * Deliberately not a magnifying glass or a ring: this is the *workflow*
 * product on Pinterest, not the intelligence one (Opportunity Finder), so the
 * mark needs to read as "save/collect" rather than "find". Rendered with 4x4
 * supersampling so the 16px icon still reads cleanly.
 */

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '..', 'src', 'icons');

const TILE = [22, 23, 27]; // near-black, faint blue-grey undertone — distinct from Opportunity Finder's red-black
const CARD_BACK = [150, 154, 163]; // muted, sits behind
const CARD_FRONT = [255, 255, 255];
const BADGE = [230, 0, 35]; // Pinterest red, matches the panel accent and the in-page save button
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

/** Axis-aligned rounded rect in normalized [0,1] coordinates. */
function insideRoundedRect(nx, ny, x0, y0, x1, y1, radius) {
  const cx = Math.min(Math.max(nx, x0 + radius), x1 - radius);
  const cy = Math.min(Math.max(ny, y0 + radius), y1 - radius);
  const dx = nx - cx;
  const dy = ny - cy;
  if (nx >= x0 + radius && nx <= x1 - radius) return ny >= y0 && ny <= y1;
  if (ny >= y0 + radius && ny <= y1 - radius) return nx >= x0 && nx <= x1;
  return dx * dx + dy * dy <= radius * radius;
}

// Two overlapping cards: a smaller one behind and up-left, a larger one in
// front and down-right — reads as "a stack of saved things" even at 16px.
const BACK_CARD = { x0: 0.2, y0: 0.16, x1: 0.62, y1: 0.58, radius: 0.05 };
const FRONT_CARD = { x0: 0.32, y0: 0.34, x1: 0.82, y1: 0.78, radius: 0.06 };

const BADGE_CENTER = [0.78, 0.28];
const BADGE_R = 0.16;
const BADGE_MARK_HALF_LENGTH = 0.08;
const BADGE_MARK_HALF_WIDTH = 0.018;

function markColorAt(x, y, size) {
  const nx = x / size;
  const ny = y / size;

  const dxBadge = nx - BADGE_CENTER[0];
  const dyBadge = ny - BADGE_CENTER[1];
  const badgeDist2 = dxBadge * dxBadge + dyBadge * dyBadge;
  if (badgeDist2 <= BADGE_R * BADGE_R) {
    // A "+" cut out of the badge circle.
    const inHorizontal = Math.abs(dyBadge) <= BADGE_MARK_HALF_WIDTH && Math.abs(dxBadge) <= BADGE_MARK_HALF_LENGTH;
    const inVertical = Math.abs(dxBadge) <= BADGE_MARK_HALF_WIDTH && Math.abs(dyBadge) <= BADGE_MARK_HALF_LENGTH;
    return inHorizontal || inVertical ? BADGE_MARK : BADGE;
  }

  if (insideRoundedRect(nx, ny, FRONT_CARD.x0, FRONT_CARD.y0, FRONT_CARD.x1, FRONT_CARD.y1, FRONT_CARD.radius)) {
    return CARD_FRONT;
  }
  if (insideRoundedRect(nx, ny, BACK_CARD.x0, BACK_CARD.y0, BACK_CARD.x1, BACK_CARD.y1, BACK_CARD.radius)) {
    return CARD_BACK;
  }
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
          const color = markColorAt(x, y, size) ?? TILE;
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
