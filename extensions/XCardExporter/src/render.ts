/**
 * The canvas half of the rendering pipeline. DOM/canvas-bound, so it isn't
 * covered by scripts/selftest.mjs (no canvas in Node) - everything it does
 * with numbers instead lives in layout.ts, which is fully unit-tested. This
 * file's only job is: load the avatar (or don't), call computeCardLayout,
 * and draw exactly what it says.
 *
 * PRD S5's canvas-taint handling lives here: the avatar is requested with
 * crossOrigin="anonymous", a failed/slow load falls back to an initials
 * circle before any drawing happens, and the final toDataURL() call is
 * still wrapped so a taint that only shows up at export time re-renders
 * clean instead of throwing all the way out to the user.
 */

import { CardInput, TemplateConfig } from './types';
import { computeCardLayout, LayoutConfig } from './layout';
import { CARD_WIDTH } from './templates';
import { initialsFor, looksLikeAvatarUrl } from './avatar';

const SCALE = 2; // export at 2x for crisp text on retina displays (PRD S6)
const AVATAR_LOAD_TIMEOUT_MS = 2500;

export interface RenderResult {
  dataUrl: string;
  usedFallbackAvatar: boolean;
}

function loadAvatarImage(url: string): Promise<HTMLImageElement | null> {
  if (!url || !looksLikeAvatarUrl(url)) return Promise.resolve(null);

  return new Promise(resolve => {
    let settled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';

    const finish = (result: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    setTimeout(() => finish(null), AVATAR_LOAD_TIMEOUT_MS);
    img.src = url;
  });
}

function drawAvatarCircle(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  input: CardInput,
  x: number,
  y: number,
  size: number,
  config: TemplateConfig
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();

  if (image) {
    ctx.drawImage(image, x, y, size, size);
  } else {
    ctx.fillStyle = config.accent;
    ctx.fillRect(x, y, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = `600 ${Math.round(size * 0.36)}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(initialsFor(input.author, input.handle), x + size / 2, y + size / 2 + 1);
  }
  ctx.restore();
}

function safeToDataUrl(canvas: HTMLCanvasElement): string | null {
  try {
    return canvas.toDataURL('image/png');
  } catch {
    // SecurityError from a tainted canvas (PRD S5) - caller re-renders
    // without the avatar rather than surfacing a broken export.
    return null;
  }
}

export async function renderCard(input: CardInput, config: TemplateConfig, avatarUrl: string): Promise<RenderResult> {
  const layoutConfig: LayoutConfig = {
    width: CARD_WIDTH,
    padding: 28,
    avatarSize: 56,
    lineHeight: 30,
    maxLines: config.maxLines,
    showMetrics: config.showMetrics,
  };

  const measureCanvas = document.createElement('canvas');
  const measureCtx = measureCanvas.getContext('2d')!;
  const bodyFont = `400 20px system-ui, -apple-system, "Segoe UI", sans-serif`;
  measureCtx.font = bodyFont;

  const layout = computeCardLayout(input, layoutConfig, s => measureCtx.measureText(s).width);

  let avatarImage = await loadAvatarImage(avatarUrl);
  let usedFallbackAvatar = !avatarImage;

  const draw = (image: HTMLImageElement | null): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = layout.width * SCALE;
    canvas.height = layout.height * SCALE;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(SCALE, SCALE);
    ctx.direction = layout.direction;
    ctx.textAlign = layout.direction === 'rtl' ? 'right' : 'left';

    ctx.fillStyle = config.background;
    ctx.fillRect(0, 0, layout.width, layout.height);

    drawAvatarCircle(ctx, image, input, layout.avatarX, layout.avatarY, layout.avatarSize, config);

    const textX = layout.direction === 'rtl' ? layout.width - layout.padding : layout.nameX;

    ctx.fillStyle = config.cardText;
    ctx.font = '700 19px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(input.author || input.handle || 'Unknown', textX, layout.nameY);

    ctx.fillStyle = config.mutedText;
    ctx.font = '400 16px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillText(input.handle, textX, layout.handleY);

    if (layout.dateText) {
      ctx.fillStyle = config.mutedText;
      ctx.font = '400 14px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(layout.dateText, layout.padding, layout.dateY);
    }

    ctx.fillStyle = config.cardText;
    ctx.font = bodyFont;
    const bodyX = layout.direction === 'rtl' ? layout.width - layout.textX : layout.textX;
    layout.textLines.forEach((line, i) => {
      ctx.fillText(line, bodyX, layout.textStartY + i * layout.lineHeight);
    });

    if (layout.showMetrics && layout.metricsText) {
      ctx.fillStyle = config.mutedText;
      ctx.font = '400 15px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(layout.metricsText, layout.padding, layout.metricsY);
    }

    return canvas;
  };

  let canvas = draw(avatarImage);
  let dataUrl = safeToDataUrl(canvas);

  if (dataUrl === null && avatarImage) {
    // Canvas was tainted despite the CORS-mode load succeeding - re-render
    // clean, without the avatar, rather than failing the export.
    usedFallbackAvatar = true;
    avatarImage = null;
    canvas = draw(null);
    dataUrl = safeToDataUrl(canvas);
  }

  if (dataUrl === null) {
    throw new Error('Could not render this card.');
  }

  return { dataUrl, usedFallbackAvatar };
}
