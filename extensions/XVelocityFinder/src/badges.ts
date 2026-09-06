/**
 * Draws (and updates) the velocity badge on one post. Keyed by post id rather
 * than by DOM node identity, because X recycles timeline nodes as you scroll
 * (PRD §7) — the same <article> can represent a different post a minute
 * later, so every call re-checks the id stamped on its own badge and
 * replaces rather than trusts stale content.
 */

import { badgeExplainer, formatBadge } from './velocity';
import { Post } from './types';
import { badgeHost } from './selectors';

const BADGE_CLASS = 'xvf-badge';
const ID_ATTR = 'data-xvf-id';

export function renderBadge(post: Element, data: Post): void {
  const host = badgeHost(post);
  if (!host) return;

  let badge = host.querySelector<HTMLElement>(`:scope > .${BADGE_CLASS}`);
  if (badge && badge.getAttribute(ID_ATTR) === data.id) return; // already current

  if (!badge) {
    badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    host.appendChild(badge);
  }

  badge.setAttribute(ID_ATTR, data.id);
  badge.textContent = formatBadge(data);
  badge.title = badgeExplainer(data);
  badge.setAttribute('aria-label', formatBadge(data).replace('⚡', 'Velocity:'));
}

export function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach(node => node.remove());
}
