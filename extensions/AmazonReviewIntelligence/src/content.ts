/**
 * Runs on Amazon product and review pages. Reads whatever review markup is
 * already rendered — never paginates, never fetches (PRD §5) — and merges it
 * into local storage keyed by ASIN so the panel can cluster it.
 *
 * Amazon's review markup (`div[data-hook="review"]` and its `data-hook`
 * children) has been stable across .com/.co.uk/.de for years, which is what
 * this is built against. PRD §5 calls for a spike confirming that on a live
 * page before shipping — see README.md's manual checklist.
 */

import { detectLanguageBucket } from './language';
import { hashId, parseAsin, parseHelpfulVotes, parseRatingText, parseReviewDate } from './parse';
import { accumulateReviews } from './storage';
import { ContentToBackground, PanelToContent, Review } from './types';

/* ── Page context ─────────────────────────────────────────────────────── */

function currentAsin(): string | null {
  const fromUrl = parseAsin(location.href);
  if (fromUrl) return fromUrl;
  const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical) {
    const fromCanonical = parseAsin(canonical.href);
    if (fromCanonical) return fromCanonical;
  }
  const withAsin = document.querySelector<HTMLElement>('[data-asin]:not([data-asin=""])');
  return withAsin?.getAttribute('data-asin')?.toUpperCase() ?? null;
}

function productTitle(): string {
  const dpTitle = document.querySelector<HTMLElement>('#productTitle');
  if (dpTitle?.textContent?.trim()) return dpTitle.textContent.trim();
  const reviewsPageLink = document.querySelector<HTMLElement>('a[data-hook="product-link"]');
  if (reviewsPageLink?.textContent?.trim()) return reviewsPageLink.textContent.trim();
  return document.title.replace(/:.*$/, '').trim();
}

function hasMorePages(): boolean {
  const nextPage = document.querySelector<HTMLElement>(
    '.a-pagination .a-last:not(.a-disabled) a, a[aria-label="Next page"]',
  );
  if (nextPage) return true;
  return Boolean(document.querySelector('a[data-hook="see-all-reviews-link-foot"]'));
}

/* ── Review parsing ───────────────────────────────────────────────────── */

function cleanBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function reviewTitleText(el: Element): string {
  const node = el.querySelector('a[data-hook="review-title"], span[data-hook="review-title"]');
  if (!node) return '';
  const clone = node.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.a-icon, i').forEach(icon => icon.remove());
  return cleanBody(clone.textContent ?? '');
}

function parseOneReview(el: Element): Review | null {
  const starEl = el.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt');
  const rating = starEl ? parseRatingText(starEl.textContent ?? '') : null;
  if (!rating) return null; // no readable rating means this isn't a real review row (e.g. a promo tile)

  const title = reviewTitleText(el);
  const bodyEl = el.querySelector('[data-hook="review-body"]');
  const text = cleanBody(bodyEl?.textContent ?? '');

  const dateEl = el.querySelector('[data-hook="review-date"]');
  const dateRaw = cleanBody(dateEl?.textContent ?? '');
  const { iso: dateIso } = parseReviewDate(dateRaw);

  const verified = Boolean(el.querySelector('[data-hook="avp-badge"]'));
  const variationEl = el.querySelector('[data-hook="format-strip"]');
  const variation = cleanBody(variationEl?.textContent ?? '');

  const helpfulEl = el.querySelector('[data-hook="helpful-vote-statement"]');
  const helpfulVotes = parseHelpfulVotes(helpfulEl?.textContent ?? '');

  const mediaOnly = !text && Boolean(el.querySelector('[data-hook="review-image-tile-section"], .review-image-tile, video'));

  const authorEl = el.querySelector('.a-profile-name');
  const author = cleanBody(authorEl?.textContent ?? '');
  const domId = el.id && /^R[A-Z0-9]+$/.test(el.id) ? el.id : null;
  const id = domId ?? hashId([author, dateRaw, title, text].join('|'));

  return {
    id,
    rating,
    title,
    text,
    dateRaw,
    dateIso,
    verified,
    variation,
    language: detectLanguageBucket(text || title),
    mediaOnly,
    helpfulVotes,
  };
}

function scanReviews(): Review[] {
  const nodes = document.querySelectorAll('div[data-hook="review"]');
  const reviews: Review[] = [];
  nodes.forEach(node => {
    const review = parseOneReview(node);
    if (review) reviews.push(review);
  });
  return reviews;
}

/* ── Sync to storage ──────────────────────────────────────────────────── */

let lastScanCount = -1;

async function scanAndSync(): Promise<void> {
  const asin = currentAsin();
  if (!asin) return;

  const reviews = scanReviews();
  if (reviews.length === lastScanCount) return; // nothing new since the last scan
  lastScanCount = reviews.length;

  const result = await accumulateReviews(
    { asin, productTitle: productTitle(), productUrl: location.href, domain: location.hostname.replace(/^www\./, '') },
    reviews,
  );

  const message: ContentToBackground = {
    type: 'ARI_PAGE_ANALYZED',
    reviewsOnPage: reviews.length,
    totalAccumulated: result.totalAccumulated,
    hasMorePages: hasMorePages(),
  };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

let scanTimer: number | undefined;
function scheduleScan(delay = 300): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scanAndSync(), delay);
}

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => m.addedNodes.length > 0);
  if (relevant) scheduleScan(500);
});

/* ── Panel messaging ──────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PanelToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'ARI_GET_CONTEXT': {
      const asin = currentAsin();
      sendResponse({
        supported: Boolean(asin),
        asin,
        productTitle: productTitle(),
        productUrl: location.href,
        domain: location.hostname.replace(/^www\./, ''),
        reviewsOnPage: document.querySelectorAll('div[data-hook="review"]').length,
        hasMorePages: hasMorePages(),
        unsupportedReason: asin ? null : "This doesn't look like an Amazon product page.",
      });
      return false;
    }
    case 'ARI_RESCAN':
      void scanAndSync().then(() => sendResponse({ ok: true }));
      return true;
    default:
      return false;
  }
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (/(^|\.)amazon\./i.test(location.hostname) && window.top === window) {
  scheduleScan(200);
  window.addEventListener('load', () => scheduleScan(400));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
