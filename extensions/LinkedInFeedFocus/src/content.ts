/**
 * Runs on linkedin.com. One job: hide DOM nodes LinkedIn has already
 * rendered, driven entirely by six stored toggle values (classify.ts). This
 * script never reads a post's content into memory beyond the short label
 * strings needed to classify it, never stores anything about what it saw,
 * and never writes anything back to LinkedIn — there is no code path here
 * that posts, likes, follows, connects or messages. See PRIVACY.md.
 *
 * LinkedIn's DOM changes often and is not documented (PRD §5: "a
 * higher-than-usual DOM-fragility risk"), so every extraction/hide step
 * below degrades to "do nothing" rather than throwing or leaving a stripped
 * element behind. The selectors are a best-effort read of the *visible*
 * page; see README.md's manual test checklist for how to re-verify them
 * against the live site before every release.
 */

import { DEFAULT_TOGGLES, HidableFeature, ToggleState, mergeToggles, shouldHideByFeature } from './classify';

const STORAGE_KEY = 'liff:toggles';
const HIDDEN_ATTR = 'data-liff-hidden';
const FOCUS_CLASS = 'liff-focus-mode';
const STYLE_ID = 'liff-focus-style';
const POST_SEEN_ATTR = 'data-liff-post-checked';

let toggles: ToggleState = { ...DEFAULT_TOGGLES };

/* ── Hide / unhide primitives — CSS-only, never a real DOM removal ─────── */

function hideElement(el: Element, feature: HidableFeature | 'reactionCounts'): void {
  if (el.getAttribute(HIDDEN_ATTR) === feature) return;
  el.setAttribute(HIDDEN_ATTR, feature);
  (el as HTMLElement).style.setProperty('display', 'none', 'important');
}

function unhideAll(): void {
  document.querySelectorAll<HTMLElement>(`[${HIDDEN_ATTR}]`).forEach(el => {
    el.removeAttribute(HIDDEN_ATTR);
    el.style.removeProperty('display');
  });
}

/* ── Shared helpers ──────────────────────────────────────────────────── */

function safeText(el: Element | null): string {
  return el?.textContent ?? '';
}

function firstMatch(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) return el;
    } catch {
      // An invalid/unsupported selector on some LinkedIn DOM variant should
      // never stop the rest of the scan (PRD §5's degrade-quietly rule).
    }
  }
  return null;
}

function isPostContainer(el: Element): boolean {
  const urn = el.getAttribute('data-urn') ?? '';
  return /^urn:li:(activity|share|ugcPost):/.test(urn);
}

/**
 * The area LinkedIn uses for both the "Promoted" label and the relative
 * timestamp/annotation ("2h", "3d • Suggested") — one read serves the
 * promoted and algorithmic checks below.
 */
function findActorSubDescription(container: Element): string {
  const el = firstMatch(container, [
    '[class*="update-components-actor__description"]',
    '[class*="update-components-actor__supplementary-actor-info"]',
    '[class*="feed-shared-actor__sub-description"]',
  ]);
  return safeText(el);
}

/* ── Per-post hiding ─────────────────────────────────────────────────── */

function hideReactionCounts(container: Element): void {
  // Only the reaction/like tally — never the comment/repost counts, and
  // never the Like/Comment/Repost/Send action buttons themselves, which must
  // stay fully usable (PRD §4: never limit what a user can *do*).
  const bar = firstMatch(container, ['[class*="social-details-social-counts"]']);
  if (!bar) return;

  const candidates = bar.querySelectorAll<HTMLElement>(
    '[class*="social-details-social-counts__reactions"], [class*="social-details-social-counts__count-value"]'
  );
  candidates.forEach(el => {
    // Never hide inside an interactive control (e.g. the "see who reacted"
    // button must remain clickable even if its label text is hidden by CSS
    // elsewhere) — skip anything that is itself, or is inside, a <button>.
    if (el.tagName === 'BUTTON' || el.closest('button')) return;
    if (shouldHideByFeature('reactionCounts', '', toggles)) {
      hideElement(el, 'reactionCounts');
    }
  });
}

function processPost(container: Element): void {
  try {
    const subDescription = findActorSubDescription(container);

    if (shouldHideByFeature('promoted', subDescription, toggles)) {
      hideElement(container, 'promoted');
      return; // the whole post is gone; nothing else to evaluate inside it
    }

    if (shouldHideByFeature('algorithmic', subDescription, toggles)) {
      hideElement(container, 'algorithmic');
      return;
    }

    hideReactionCounts(container);
    container.setAttribute(POST_SEEN_ATTR, '1');
  } catch {
    // One odd post's markup must never stop the rest of the scan.
  }
}

function scanPosts(root: ParentNode): void {
  const containers = root.querySelectorAll<HTMLElement>('[data-urn]');
  containers.forEach(container => {
    if (!isPostContainer(container)) return;
    // Re-run on every pass rather than only once: counts and the
    // sub-description annotation often load in shortly after a post first
    // mounts, and a toggle can flip at any time, so re-evaluating is what
    // catches both (cheap — attribute checks only, no re-parsing of text
    // that hasn't changed).
    processPost(container);
  });
}

/* ── Module-level hiding (suggestion / trending rails) ──────────────── */

const MODULE_HEADING_SELECTOR = 'h2, h3, strong';
const MAX_CLIMB_STEPS = 8;

/**
 * Climbs from a matched heading to the smallest ancestor that plausibly owns
 * the whole module card, stopping as soon as climbing further would start
 * swallowing an unrelated sibling module (more than one heading match inside
 * the candidate ancestor) — the same "stable string, climb while it's still
 * the only occurrence" technique used elsewhere in this portfolio for
 * hostile/obfuscated DOMs.
 */
function climbToModuleRoot(heading: Element): Element {
  let node: Element = heading;
  let ancestor: Element | null = heading.parentElement;
  let steps = 0;

  while (ancestor && steps < MAX_CLIMB_STEPS) {
    const headingMatches = ancestor.querySelectorAll(MODULE_HEADING_SELECTOR).length;
    if (headingMatches > 1) break;
    node = ancestor;
    if (ancestor.tagName === 'SECTION' || ancestor.tagName === 'ASIDE' || ancestor.hasAttribute('data-view-name')) {
      break;
    }
    ancestor = ancestor.parentElement;
    steps++;
  }

  return node;
}

function scanModules(root: ParentNode): void {
  if (!toggles.hideSuggestions && !toggles.hideTrending) return;

  const headings = root.querySelectorAll<HTMLElement>(MODULE_HEADING_SELECTOR);
  headings.forEach(heading => {
    if (heading.closest(`[${HIDDEN_ATTR}]`)) return; // already inside a hidden ancestor
    const text = safeText(heading);

    if (shouldHideByFeature('suggestions', text, toggles)) {
      hideElement(climbToModuleRoot(heading), 'suggestions');
    } else if (shouldHideByFeature('trending', text, toggles)) {
      hideElement(climbToModuleRoot(heading), 'trending');
    }
  });
}

/* ── Focus mode — CSS only, instantly reversible ────────────────────── */

function ensureFocusStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html.${FOCUS_CLASS} [class*="scaffold-layout__aside"] { display: none !important; }
    html.${FOCUS_CLASS} [class*="scaffold-layout__main"] {
      max-width: 900px !important;
      margin-left: auto !important;
      margin-right: auto !important;
    }
    html.${FOCUS_CLASS} [class*="global-nav"] [class*="premium"] { display: none !important; }
  `;
  document.documentElement.appendChild(style);
}

function applyFocusMode(): void {
  ensureFocusStyle();
  document.documentElement.classList.toggle(FOCUS_CLASS, toggles.focusMode);
}

/* ── Full scan ───────────────────────────────────────────────────────── */

function scanRoot(root: ParentNode): void {
  scanPosts(root);
  scanModules(root);
}

/* ── Boot, storage sync, mutation watching, SPA navigation ─────────────── */

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => scanRoot(document.body), delay);
}

async function loadToggles(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  toggles = mergeToggles(stored[STORAGE_KEY]);
}

chrome.storage.onChanged.addListener(changes => {
  if (!changes[STORAGE_KEY]) return;
  toggles = mergeToggles(changes[STORAGE_KEY].newValue);
  // Cheap at this scale (attribute checks only) — always sweep clean and
  // re-scan from scratch rather than trying to diff which single toggle
  // flipped, so a toggle turned back off always un-hides everything it
  // previously hid.
  unhideAll();
  applyFocusMode();
  scanRoot(document.body);
});

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(mutation => mutation.addedNodes.length > 0);
  if (relevant) scheduleScan();
});

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    scheduleScan(300);
  }, 700);
}

if (window.top === window && /\.linkedin\.com$/.test(location.hostname)) {
  void loadToggles().then(() => {
    applyFocusMode();
    scanRoot(document.body);
    scheduleScan(300);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  watchNavigation();
}
