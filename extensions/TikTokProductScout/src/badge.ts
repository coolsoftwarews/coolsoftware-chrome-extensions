/**
 * Renders and positions the per-video badge described in PRD §4:
 *
 *   🔥 6.2× · 340K · 🛒 shop link
 *
 * Badges are absolutely-positioned overlays pinned to a tile's bounding box —
 * never inserted into the tile itself — so they can never push TikTok's own
 * layout around (PRD §6: "zero layout shift; no interference with TikTok's
 * own scrolling"). Position is refreshed on a throttled animation frame
 * rather than on every scroll event, which is what keeps this from competing
 * with TikTok's own scroll performance.
 */

import { formatRatio } from './outlier';
import { markerBadgeLabel } from './markers';
import { ui } from './shell';
import { OutlierResult, ScannedVideo } from './types';

export interface BadgeHandle {
  el: HTMLDivElement;
  tile: HTMLElement;
  video: ScannedVideo;
}

const handles = new Map<string, BadgeHandle>();

function formatViews(views: number | null): string {
  if (views === null) return 'views n/a';
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${Math.round(views / 1000)}K`;
  return String(views);
}

function ratioClass(outlier: OutlierResult): string {
  if (outlier.ratio === null) return 'badge__ratio badge__ratio--pending';
  if (outlier.confidence === 'low-sample') return 'badge__ratio badge__ratio--low';
  return 'badge__ratio';
}

function renderContent(el: HTMLDivElement, video: ScannedVideo, outlier: OutlierResult, tracked: boolean, onTrack: (() => void) | null): void {
  el.replaceChildren();

  const flame = document.createElement('span');
  flame.textContent = '🔥';
  el.appendChild(flame);

  const ratio = document.createElement('span');
  ratio.className = ratioClass(outlier);
  ratio.textContent = formatRatio(outlier);
  el.appendChild(ratio);

  const dot1 = document.createElement('span');
  dot1.textContent = '·';
  el.appendChild(dot1);

  const views = document.createElement('span');
  views.textContent = formatViews(video.views);
  el.appendChild(views);

  const shopLabel = markerBadgeLabel(video.markers);
  if (shopLabel) {
    const dot2 = document.createElement('span');
    dot2.textContent = '·';
    el.appendChild(dot2);

    const shop = document.createElement('span');
    shop.className = 'badge__shop';
    shop.textContent = shopLabel;
    el.appendChild(shop);

    if (onTrack) {
      const track = document.createElement('button');
      track.type = 'button';
      track.className = 'badge__track';
      track.textContent = tracked ? 'Tracked' : '+ Track';
      track.setAttribute('aria-pressed', String(tracked));
      track.setAttribute('aria-label', tracked ? 'Product already tracked' : 'Track this product');
      track.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        onTrack();
      });
      el.appendChild(track);
    }
  }
}

export function upsertBadge(
  tile: HTMLElement,
  video: ScannedVideo,
  outlier: OutlierResult,
  tracked: boolean,
  onTrack: (() => void) | null
): BadgeHandle {
  const existing = handles.get(video.id);
  if (existing && existing.tile === tile) {
    existing.video = video;
    renderContent(existing.el, video, outlier, tracked, onTrack);
    return existing;
  }

  const el = document.createElement('div');
  el.className = 'badge';
  ui().appendChild(el);
  renderContent(el, video, outlier, tracked, onTrack);

  const handle: BadgeHandle = { el, tile, video };
  handles.set(video.id, handle);
  positionBadge(handle);
  return handle;
}

export function positionBadge(handle: BadgeHandle): void {
  if (!handle.tile.isConnected) {
    removeBadge(handle.video.id);
    return;
  }
  const rect = handle.tile.getBoundingClientRect();
  const visible = rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < window.innerHeight;
  handle.el.classList.toggle('badge--on', visible);
  if (!visible) return;

  const left = Math.max(4, rect.left + 8);
  const top = Math.max(4, rect.bottom - 28);
  handle.el.style.left = `${Math.round(left)}px`;
  handle.el.style.top = `${Math.round(top)}px`;
}

export function positionAll(): void {
  for (const handle of handles.values()) positionBadge(handle);
}

export function removeBadge(videoId: string): void {
  const handle = handles.get(videoId);
  if (!handle) return;
  handle.el.remove();
  handles.delete(videoId);
}

/** Drops badges whose tile has left the document — TikTok recycles feed nodes as the user scrolls. */
export function pruneDetached(): void {
  for (const [id, handle] of handles) {
    if (!handle.tile.isConnected) {
      handle.el.remove();
      handles.delete(id);
    }
  }
}

export function badgeCount(): number {
  return handles.size;
}
