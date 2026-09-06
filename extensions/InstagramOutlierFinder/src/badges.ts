/**
 * Draws the outlier badge over each grid tile's thumbnail. Called again on
 * every rescan, so it replaces its own previous output rather than
 * appending — safe to call every scroll tick.
 */

import { formatCompact } from './outlier';
import { ScoredPost } from './types';

const BADGE_CLASS = 'iof-badge';
const HOST_CLASS = 'iof-badge-host';

function metricLabel(post: ScoredPost): string {
  if (post.metricSource === 'views' && post.views !== null) return `${post.views.toLocaleString()} views`;
  if (post.metricSource === 'likes' && post.likes !== null) return `${post.likes.toLocaleString()} likes`;
  return '';
}

export function renderBadge(tile: HTMLElement, post: ScoredPost): void {
  const existing = tile.querySelector<HTMLElement>(`.${BADGE_CLASS}`);

  // No baseline yet (band 'unrated') — leave the tile clean rather than show
  // a ratio that isn't meaningful yet; the header strip explains why.
  if (post.ratio === null || !post.ratioLabel) {
    existing?.remove();
    return;
  }

  const badge = existing ?? document.createElement('div');
  badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${post.band}${post.pinned ? ` ${BADGE_CLASS}--pinned` : ''}`;

  const glyph = post.band === 'fire5' || post.band === 'fire2' ? '\u{1F525}' : post.band === 'up' ? '↑' : '—';
  badge.textContent = `${glyph} ${post.ratioLabel}`;

  const raw = metricLabel(post);
  badge.title = [
    raw ? `${raw} on this post` : null,
    `${post.ratioLabel} the account's recent ${post.metricSource === 'likes' ? 'likes' : 'views'} median`,
    post.pinned ? 'Pinned — excluded from the median, badged normally' : null,
    post.ratioCapped ? 'Capped for display — the real multiplier is higher' : null,
  ]
    .filter(Boolean)
    .join(' • ');

  if (!existing) {
    tile.classList.add(HOST_CLASS);
    tile.appendChild(badge);
  }
}

export function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach(node => node.remove());
}
