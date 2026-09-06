/**
 * Runs on Pinterest pages. On a search results page it:
 *   1. scans the rendered pin grid (PRD §5: only what's already in the tab)
 *   2. computes the outlier baseline and a badge per pin
 *   3. paints badges directly on the cards, without touching layout
 *   4. re-scans as infinite scroll adds pins, and as the query changes
 *   5. answers the panel's questions about the current search
 *
 * No network request exists anywhere in this file — see PRIVACY.md.
 */

import { isSearchUrl, searchQueryFrom } from './domains';
import { scanPins } from './extract';
import { track, trackSearchAnalyzed } from './metrics';
import { computeBadges, computeBaseline, formatRatio, formatSaveCount } from './outlier';
import { writeQueryCache } from './storage';
import { OutlierBaseline, PinBadge, PinCard, QuerySnapshot } from './types';

const EMPTY_BASELINE: OutlierBaseline = { median: null, sampleSize: 0, usableFraction: 0, trustworthy: false };

let snapshot: QuerySnapshot = {
  query: null,
  url: location.href,
  pins: [],
  baseline: EMPTY_BASELINE,
  badges: {},
  unsupported: 'Open a Pinterest search to analyse results.',
};

/** Pin-id → its card element, refreshed on every scan. */
let elements = new Map<string, Element>();
/** Queries already counted this session, so infinite scroll doesn't inflate "analysed searches". */
const analyzedThisSession = new Set<string>();

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'POF_SNAPSHOT_CHANGED', url: location.href }).catch(() => undefined);
}

/* ── Badge painting ──────────────────────────────────────────────────── */

const BADGE_ATTR = 'data-pof-badge';

const BADGE_BASE_STYLE = [
  'position:absolute',
  'top:6px',
  'left:6px',
  'z-index:5',
  'pointer-events:none',
  'font:600 11px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif',
  'padding:3px 7px',
  'border-radius:999px',
  'color:#ffffff',
  'box-shadow:0 1px 3px rgba(0,0,0,.35)',
  'white-space:nowrap',
  // The badge must not affect the card's box, or the masonry grid reflows (PRD §6).
  'margin:0',
  'max-width:none',
].join(';');

const BADGE_COLOR: Record<PinBadge['kind'], string> = {
  ratio: '#e60023',
  rank: '#5f6368',
  promoted: '#8a8a8a',
  'idea-pin': '#7b4fe0',
  unknown: 'transparent',
};

function badgeText(badge: PinBadge): string {
  switch (badge.kind) {
    case 'ratio':
      return `\u{1F525} ${formatRatio(badge.ratio ?? 0)}`;
    case 'rank':
      return `#${(badge.rank ?? 0) + 1}`;
    case 'promoted':
      return 'Promoted';
    case 'idea-pin':
      return 'Idea pin';
    default:
      return '';
  }
}

function badgeTitle(pin: PinCard, badge: PinBadge): string {
  switch (badge.kind) {
    case 'ratio': {
      const save = pin.saveCount != null ? `${formatSaveCount(pin.saveCount)} saves · ` : '';
      return `${save}${formatRatio(badge.ratio ?? 0)} vs. the median of ${badge.sampleSize} pins with a visible save count${pin.domain ? ` · ${pin.domain}` : ''}`;
    }
    case 'rank':
      return `Save counts aren't reliably visible for this search — showing Pinterest's own result order instead (#${(badge.rank ?? 0) + 1} of ${badge.sampleSize}). Never treat this as a save count.`;
    case 'promoted':
      return 'Promoted pin — excluded from the outlier median.';
    case 'idea-pin':
      return 'Idea pin — a different surface than standard pins, not compared to them.';
    default:
      return '';
  }
}

function ensurePositioned(container: HTMLElement): void {
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
}

function paintBadge(container: Element, pin: PinCard, badge: PinBadge): void {
  const el = container as HTMLElement;
  const text = badgeText(badge);
  let badgeEl = el.querySelector<HTMLElement>(`:scope > [${BADGE_ATTR}]`);

  if (!text) {
    badgeEl?.remove();
    return;
  }

  ensurePositioned(el);
  if (!badgeEl) {
    badgeEl = document.createElement('div');
    badgeEl.setAttribute(BADGE_ATTR, '');
    badgeEl.style.cssText = BADGE_BASE_STYLE;
    el.insertBefore(badgeEl, el.firstChild);
  }
  badgeEl.textContent = text;
  badgeEl.title = badgeTitle(pin, badge);
  badgeEl.style.background = BADGE_COLOR[badge.kind];
}

function paintAll(pins: PinCard[], badges: Record<string, PinBadge>): void {
  for (const pin of pins) {
    const container = elements.get(pin.id);
    if (container) paintBadge(container, pin, badges[pin.id]);
  }
}

function clearBadges(): void {
  document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(el => el.remove());
}

/* ── Scanning ────────────────────────────────────────────────────────── */

async function scan(): Promise<void> {
  const supported = isSearchUrl(location.href);
  if (!supported) {
    clearBadges();
    elements = new Map();
    snapshot = {
      query: null,
      url: location.href,
      pins: [],
      baseline: EMPTY_BASELINE,
      badges: {},
      unsupported: 'Open a Pinterest search to analyse results.',
    };
    notifyPanel();
    return;
  }

  const query = searchQueryFrom(location.href);
  const result = scanPins(document);
  elements = result.elements;

  const baseline = computeBaseline(result.pins);
  const badges = computeBadges(result.pins, baseline);
  paintAll(result.pins, badges);

  snapshot = { query, url: location.href, pins: result.pins, baseline, badges, unsupported: null };

  if (query && result.pins.length) {
    void writeQueryCache({
      query,
      median: baseline.median,
      sampleSize: baseline.sampleSize,
      usableFraction: baseline.usableFraction,
      updatedAt: Date.now(),
    });

    // "Analysed" once per query per session, at a sample size worth reporting
    // (PRD §8: "users who run ≥3 analysed searches").
    if (result.pins.length >= 5 && !analyzedThisSession.has(query)) {
      analyzedThisSession.add(query);
      void trackSearchAnalyzed(query);
    }
  }

  notifyPanel();
}

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), delay);
}

/* ── Infinite scroll + SPA navigation ───────────────────────────────── */

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => m.addedNodes.length > 0 || m.removedNodes.length > 0);
  if (relevant) scheduleScan(500);
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    scheduleScan(150);
  }, 700);
}

/* ── Panel messaging ─────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'POF_GET_SNAPSHOT':
      sendResponse(snapshot);
      return false;
    case 'POF_RESCAN':
      void track('rescan_used').then(() => scan()).then(() => sendResponse({ ok: true }));
      return true;
    default:
      return false;
  }
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (window.top === window) {
  scheduleScan(150);
  observer.observe(document.body, { childList: true, subtree: true });
  watchUrl();
}
