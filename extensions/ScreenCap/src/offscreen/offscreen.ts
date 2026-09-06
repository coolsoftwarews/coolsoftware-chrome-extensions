/**
 * Screen Capture — offscreen document.
 *
 * The service worker has no DOM, so all canvas work (stitching frames,
 * cropping a region) happens here.
 */

import type { Rect, Tile } from '../shared/messages';

type Job =
  | { target: 'offscreen'; action: 'STITCH'; tiles: Tile[]; width: number; height: number }
  | { target: 'offscreen'; action: 'CROP'; dataUrl: string; rect: Rect };

chrome.runtime.onMessage.addListener((message: Job, _sender, sendResponse) => {
  if (message?.target !== 'offscreen') return false;

  const work = message.action === 'STITCH'
    ? stitch(message.tiles, message.width, message.height)
    : crop(message.dataUrl, message.rect);

  work
    .then((dataUrl) => sendResponse({ dataUrl }))
    .catch((error: Error) => sendResponse({ error: error.message }));
  return true;
});

/**
 * Draws each frame at the scroll offset it was taken from. Frames are painted
 * in order, so where the last short frame overlaps the one above it, the
 * newer pixels win — which is exactly what removes the seam.
 */
async function stitch(tiles: Tile[], width: number, height: number): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the image canvas.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  for (const tile of [...tiles].sort((a, b) => a.y - b.y)) {
    const bitmap = await loadBitmap(tile.dataUrl);
    const visibleHeight = Math.min(bitmap.height, height - tile.y);
    if (visibleHeight > 0) {
      ctx.drawImage(bitmap, 0, 0, bitmap.width, visibleHeight, 0, tile.y, bitmap.width, visibleHeight);
    }
    bitmap.close();
  }

  return canvas.toDataURL('image/png');
}

async function crop(dataUrl: string, rect: Rect): Promise<string> {
  const bitmap = await loadBitmap(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.min(rect.width, bitmap.width - rect.x));
  canvas.height = Math.max(1, Math.min(rect.height, bitmap.height - rect.y));

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the image canvas.');
  ctx.drawImage(bitmap, rect.x, rect.y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL('image/png');
}

async function loadBitmap(dataUrl: string): Promise<ImageBitmap> {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}
