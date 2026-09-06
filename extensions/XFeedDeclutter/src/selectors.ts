/**
 * Every assumption about X's DOM lives in this file and nowhere else. X
 * ships layout changes with no deprecation courtesy (PRD §5) — when a
 * selector breaks, this is the only module that should need touching. Every
 * lookup returns null/empty rather than throwing, and no function here ever
 * removes or rewrites a node's structure — it only ever reports what it
 * found so content.ts can add or remove one CSS class. That split is what
 * makes "hide nothing rather than break the page" (PRD §5/§6) hold even
 * when a selector below is wrong.
 *
 * Selectors lean on `data-testid` and ARIA roles, the most stable hooks
 * across X's redesigns historically (far more stable than class names,
 * which are atomic/generated and change on every build). This module could
 * not be verified against a live, logged-in X session in this build
 * environment — see the manual test checklist in README.md, which must be
 * run before shipping.
 */

export const POST_SELECTOR = 'article[data-testid="tweet"]';

/** Right-hand column module container, present on wide layouts. */
export const SIDEBAR_SELECTOR = '[data-testid="sidebarColumn"]';

/** Text that appears as a sidebar module's own heading. Matched against a
 * heading element's trimmed text, not substring-matched against the whole
 * column, so a post that happens to mention "who to follow" is never
 * caught. */
const SIDEBAR_MODULE_HEADINGS = [
  'who to follow',
  "what's happening",
  'trends for you',
  'relevant people',
  'you might like',
  'subscribe to premium',
];

const TAB_SELECTOR = '[role="tab"]';

export function isPromotedPost(post: Element): boolean {
  try {
    if (post.querySelector('[data-testid="promotedIndicator"]')) return true;
    // X renders the literal word "Ad" (or a translated equivalent, which
    // this heuristic does not attempt to cover — see README known limits)
    // as a short standalone text node near the post header, not inside the
    // body. Bound the scan to short spans only so a post whose *body text*
    // happens to be a two-letter word is never misclassified.
    const spans = post.querySelectorAll('span');
    for (const span of Array.from(spans).slice(0, 20)) {
      const value = span.textContent?.trim();
      if (value === 'Ad' || value === 'Promoted') return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Sidebar modules to hide when hideSidebarModules is on — the module's own
 * outermost cell, found by climbing from its heading, so hiding it takes
 * the whole card (heading + list) with it. */
export function findSidebarModules(): Element[] {
  try {
    const sidebar = document.querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) return [];
    const headings = Array.from(sidebar.querySelectorAll<HTMLElement>('div[role="heading"], h2'));
    const modules: Element[] = [];
    for (const heading of headings) {
      const text = heading.textContent?.trim().toLowerCase();
      if (!text || !SIDEBAR_MODULE_HEADINGS.some(needle => text.includes(needle))) continue;
      const module = climbToModuleRoot(heading, sidebar);
      if (module) modules.push(module);
    }
    return modules;
  } catch {
    return [];
  }
}

/** Walk up from a heading until the parent's own direct-child count would
 * make it "the rest of the sidebar" rather than "this one card" — a cheap
 * stand-in for knowing X's actual component boundaries, bounded to a few
 * levels so a wrong guess can only ever over- or under-hide one module,
 * never the whole column. */
function climbToModuleRoot(heading: Element, sidebar: Element): Element | null {
  let node: Element | null = heading;
  for (let depth = 0; depth < 6 && node && node.parentElement && node.parentElement !== sidebar; depth++) {
    node = node.parentElement;
  }
  return node && node !== sidebar ? node : null;
}

/** The numeric-count spans under a post: reply, repost/retweet, like, and
 * (when present) the view-count link. Returns the small text node, never
 * the button itself, so the reply/repost controls stay fully clickable
 * when counts are hidden (PRD §4: "reply/bookmark controls remain
 * untouched"). */
export function findVanityCountNodes(post: Element): Element[] {
  try {
    const nodes: Element[] = [];
    for (const testId of ['reply', 'retweet', 'like']) {
      const button = post.querySelector(`[data-testid="${testId}"]`);
      const countSpan = button?.querySelector('span[data-testid="app-text-transition-container"]');
      if (countSpan) nodes.push(countSpan);
    }
    // View count: rendered as a link to the post's analytics page, with the
    // number as its own text run rather than behind a data-testid button.
    const viewsLink = post.querySelector('a[href$="/analytics"]');
    const viewsSpan = viewsLink?.querySelector('span');
    if (viewsSpan) nodes.push(viewsSpan);
    return nodes;
  } catch {
    return [];
  }
}

/** The currently-selected tab's own label text (e.g. "For you", "Following"),
 * or null if no tab is confidently selected — callers must never guess when
 * this is null (PRD §5). */
export function activeTabLabel(): string | null {
  try {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>(TAB_SELECTOR));
    const active = tabs.find(tab => tab.getAttribute('aria-selected') === 'true');
    return active?.textContent?.trim() || null;
  } catch {
    return null;
  }
}

/** The Following tab control itself, or null if it isn't on the page right
 * now (e.g. logged out, or a page with no tab bar at all). */
export function findFollowingTab(): HTMLElement | null {
  try {
    const tabs = Array.from(document.querySelectorAll<HTMLElement>(TAB_SELECTOR));
    return tabs.find(tab => tab.textContent?.trim().toLowerCase() === 'following') ?? null;
  } catch {
    return null;
  }
}

/** Non-essential chrome to mute under focus mode: the sidebar's own premium
 * upsell card. Deliberately narrow — focus mode's main effect is the CSS
 * column-width change in content.css, not aggressively removing nav. */
export function findFocusChromeNodes(): Element[] {
  try {
    const sidebar = document.querySelector(SIDEBAR_SELECTOR);
    if (!sidebar) return [];
    const headings = Array.from(sidebar.querySelectorAll<HTMLElement>('div[role="heading"], h2'));
    const nodes: Element[] = [];
    for (const heading of headings) {
      const text = heading.textContent?.trim().toLowerCase();
      if (text !== 'subscribe to premium') continue;
      const module = climbToModuleRoot(heading, sidebar);
      if (module) nodes.push(module);
    }
    return nodes;
  } catch {
    return [];
  }
}
