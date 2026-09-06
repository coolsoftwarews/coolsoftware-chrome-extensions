/**
 * The pure core of this extension: "given these toggles, should this
 * already-rendered node be hidden" and "should the Following tab be
 * force-activated". No DOM, no chrome.* — every function here takes plain
 * data and returns a plain answer, so scripts/selftest.mjs can exercise the
 * actual decision logic headlessly. The DOM-bound half (selectors.ts,
 * content.ts) only ever has to answer "what kind of thing is this node" and
 * "what tab is currently active" — the decision of what to do about it
 * always lives here.
 */

import { PageNode, ToggleKey, ToggleState } from './types';

/**
 * The one function every hide operation in content.ts calls before touching
 * a node. Kept as a switch, not a lookup table, so adding a new PageNodeKind
 * without a matching case is a compile error, not a silent no-op.
 */
export function shouldHideNode(node: PageNode, toggles: ToggleState): boolean {
  switch (node.kind) {
    case 'ad-post':
      return toggles.hideAds;
    case 'sidebar-suggestion-module':
      return toggles.hideSidebarModules;
    case 'vanity-count':
      return toggles.hideVanityCounts;
    case 'focus-chrome':
      return toggles.focusMode;
    case 'ordinary':
      return false;
    default: {
      // Exhaustiveness guard: a new PageNodeKind added to types.ts without a
      // case here fails typecheck at this line, not silently at runtime.
      const _exhaustive: never = node.kind;
      return _exhaustive;
    }
  }
}

/** How many of the five toggles are currently on — the popup's headline
 * number (PRD §8: "users with ≥ 3 toggles active"). */
export function activeToggleCount(toggles: ToggleState): number {
  return Object.values(toggles).filter(Boolean).length;
}

/** X.com's client-rendered home paths. Anything else (a profile, a status,
 * search) never gets the chronological-default treatment — PRD §4 scopes it
 * to the home timeline only. */
export function isHomeTimelinePath(pathname: string): boolean {
  return pathname === '/' || pathname === '/home';
}

/**
 * Whether content.ts should click the Following tab right now.
 *
 * `activeTabLabel` is whatever the DOM layer read off the currently-selected
 * tab (lower/upper case, extra whitespace — normalized here, not by the
 * caller). `null` means "couldn't tell" — per PRD §5's "never guess" rule,
 * that must never be treated as "not Following yet", or the extension would
 * click a tab it can't actually verify the state of.
 */
export function shouldForceFollowingTab(
  toggles: ToggleState,
  pathname: string,
  activeTabLabel: string | null
): boolean {
  if (!toggles.followingDefault) return false;
  if (!isHomeTimelinePath(pathname)) return false;
  if (activeTabLabel === null) return false;
  return normalizeTabLabel(activeTabLabel) !== 'following';
}

function normalizeTabLabel(label: string): string {
  return label.trim().toLowerCase();
}

/** Ordered list of toggle keys whose stored value differs between two
 * states — used to fire the right metric events on a single popup save
 * without a caller having to diff five booleans by hand. */
export function changedToggles(before: ToggleState, after: ToggleState): Array<{ key: ToggleKey; enabled: boolean }> {
  const changes: Array<{ key: ToggleKey; enabled: boolean }> = [];
  for (const key of Object.keys(after) as ToggleKey[]) {
    if (before[key] !== after[key]) changes.push({ key, enabled: after[key] });
  }
  return changes;
}
