/**
 * The per-post ratio badge. LinkedIn's post cards are large blocks, not the
 * small square tiles Instagram/TikTok badge — an absolutely-positioned chip
 * over the whole card would either cover content or float disconnected from
 * it. Instead this inserts a small inline shadow-DOM chip right after the
 * author's name, the same "inline next to existing text, no reflow of
 * anything else" technique LinkedInCreatorWatchlist's watch button already
 * uses successfully on this exact DOM shape (PRD §6: no layout shift).
 *
 * Called again on every rescan; updates its own previous output in place
 * rather than re-inserting, so it's safe to call every scroll tick.
 */

import { ScoredPost } from './types';

const BADGE_ATTR = 'data-lpo-badge';
const HOST_CLASS = 'lpo-badge-host';

const BADGE_CSS = `
  span {
    display: inline-block;
    font: 700 11px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: 2px 8px;
    border-radius: 10px;
    color: #fff;
    white-space: nowrap;
  }
  .fire5 { background: rgba(220, 45, 45, 0.92); }
  .fire2 { background: rgba(242, 122, 60, 0.9); }
  .up { background: rgba(10, 102, 194, 0.85); }
  .flat { background: rgba(90, 90, 90, 0.75); font-weight: 500; }
  .pending {
    background: transparent;
    color: rgba(90, 90, 90, 0.9);
    border: 1px dashed rgba(90, 90, 90, 0.6);
    font-weight: 500;
  }
`;

function glyphFor(post: ScoredPost): string {
  switch (post.band) {
    case 'fire5':
    case 'fire2':
      return '\u{1F525}';
    case 'up':
      return '↑';
    case 'flat':
      return '—';
    default:
      return '';
  }
}

function tooltipFor(post: ScoredPost, pending: boolean): string {
  if (pending) {
    return [
      `Not enough of ${post.authorName}'s posts to compare yet.`,
      post.baselineSampleSize > 0
        ? `${post.baselineSampleSize} of their posts visible so far — need 5.`
        : 'None of their other posts are visible on this page yet.',
      'Visit their profile history to build a reliable baseline.',
    ].join(' ');
  }
  const parts = [
    post.engagement !== null ? `${post.engagement} engagement (reactions + comments) on this post` : null,
    `${post.ratioLabel} this author's recent median`,
    post.baselineSource === 'cached'
      ? `Median cached from a previous profile visit (sample of ${post.baselineSampleSize})`
      : `Median of ${post.baselineSampleSize} of their own posts`,
    post.isRepost ? 'This is a repost — scored against the original author, not the resharer' : null,
    post.pinned ? 'Featured/pinned — excluded from the median, badged normally' : null,
    post.ratioCapped ? 'Capped for display — the real multiplier is higher' : null,
  ];
  return parts.filter(Boolean).join(' • ');
}

/**
 * Inserts (or updates) the badge chip right after `anchor` — the DOM node
 * the caller has decided is the right inline position (author name or the
 * relative-time label). Returns without touching the DOM when there is
 * nothing readable to score at all (post has no engagement numbers).
 */
export function renderBadge(container: Element, anchor: Element, post: ScoredPost): void {
  const existing = container.querySelector<HTMLElement>(`[${BADGE_ATTR}]`);

  if (post.engagement === null) {
    existing?.remove();
    return;
  }

  const pending = post.ratio === null;
  const host = existing ?? document.createElement('span');
  host.setAttribute(BADGE_ATTR, post.id);
  if (!host.style.cssText) {
    host.style.cssText = 'display:inline-block;vertical-align:middle;margin-left:6px;';
  }

  let shadow = host.shadowRoot;
  if (!shadow) {
    shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = BADGE_CSS;
    shadow.append(style, document.createElement('span'));
  }

  const chip = shadow.querySelector('span:last-child') as HTMLElement;
  chip.className = pending ? 'pending' : post.band;
  chip.textContent = pending ? '— pending' : `${glyphFor(post)} ${post.ratioLabel}`.trim();
  host.title = tooltipFor(post, pending);

  if (!existing) {
    container.classList.add(HOST_CLASS);
    anchor.insertAdjacentElement('afterend', host);
  }
}

export function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`[${BADGE_ATTR}]`).forEach(node => node.remove());
}
