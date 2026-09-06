/**
 * Draws the outlier badge over each grid tile — PRD §4's badge strip, applied
 * per-tile instead of in a list. Re-render is idempotent: it replaces its own
 * previous output, so it can be called again on every scroll/filter change
 * without leaking nodes.
 */

import { badgeGlyph, formatRatio } from './outlier';
import { OutlierVideo } from './types';

const BADGE_CLASS = 'tco-badge';
const HOST_CLASS = 'tco-badge-host';
const HIDDEN_CLASS = 'tco-hidden';

function badgeHost(item: Element): HTMLElement | null {
  const el = item as HTMLElement;
  return el.querySelector<HTMLElement>('a') ?? el;
}

export function renderBadge(item: Element, video: OutlierVideo, lowSample: boolean): void {
  const host = badgeHost(item);
  if (!host) return;

  const existing = host.querySelector(`.${BADGE_CLASS}`) as HTMLElement | null;
  const badge = existing ?? document.createElement('div');
  badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${video.band}${lowSample ? ` ${BADGE_CLASS}--low-sample` : ''}`;
  badge.textContent = `${badgeGlyph(video.band)} ${formatRatio(video)}`;
  badge.title = lowSample
    ? `${formatRatio(video)} of the median — based on fewer than 12 videos, treat with caution`
    : `${formatRatio(video)} of this profile's median views`;

  if (!existing) {
    host.classList.add(HOST_CLASS);
    host.appendChild(badge);
  }
}

export function setTileVisibility(item: Element, visible: boolean): void {
  (item as HTMLElement).classList.toggle(HIDDEN_CLASS, !visible);
}

export function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach(node => node.remove());
  root.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(node => node.classList.remove(HIDDEN_CLASS));
}
