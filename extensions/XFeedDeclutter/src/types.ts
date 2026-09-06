/**
 * Shared shapes. rules.ts (pure) and content.ts/popup.ts (DOM- and
 * chrome.*-bound) both import from here so there is exactly one definition
 * of what a toggle is and what gets stored.
 */

/** The five independent controls named in PRD-24 §4. Each is on/off, never
 * a slider or a percentage — the whole point is no settings maze. */
export type ToggleKey =
  | 'followingDefault'
  | 'hideAds'
  | 'hideSidebarModules'
  | 'hideVanityCounts'
  | 'focusMode';

export type ToggleState = Record<ToggleKey, boolean>;

/** Declutter-first defaults, per PRD-24 §4/§10 — followingDefault, hideAds,
 * hideSidebarModules and hideVanityCounts start ON; focusMode starts OFF
 * because it changes layout, not just removes noise, and that is a bigger
 * first-run surprise than the other four. */
export const DEFAULT_TOGGLES: ToggleState = {
  followingDefault: true,
  hideAds: true,
  hideSidebarModules: true,
  hideVanityCounts: true,
  focusMode: false,
};

export const TOGGLE_ORDER: ToggleKey[] = [
  'followingDefault',
  'hideAds',
  'hideSidebarModules',
  'hideVanityCounts',
  'focusMode',
];

export const TOGGLE_COPY: Record<ToggleKey, { label: string; help: string }> = {
  followingDefault: {
    label: 'Default to Following',
    help: 'Switches the home timeline to chronological Following instead of For You.',
  },
  hideAds: {
    label: 'Hide promoted posts',
    help: 'Removes ads/promoted posts from the timeline and search results.',
  },
  hideSidebarModules: {
    label: 'Hide sidebar suggestions',
    help: 'Removes "Who to follow", trends and other algorithmic sidebar modules.',
  },
  hideVanityCounts: {
    label: 'Hide like/repost/view counts',
    help: 'Hides the numbers under a post. Reply and repost buttons still work.',
  },
  focusMode: {
    label: 'Focus mode',
    help: 'Widens the reading column and mutes non-essential chrome.',
  },
};

/** What kind of already-rendered node the content script found. Kept as a
 * plain string union — not a DOM reference — specifically so shouldHideNode
 * can be unit-tested with plain objects instead of a real page. */
export type PageNodeKind =
  | 'ad-post'
  | 'sidebar-suggestion-module'
  | 'vanity-count'
  | 'focus-chrome'
  | 'ordinary';

export interface PageNode {
  kind: PageNodeKind;
}

/* ── Local-only usage counters ───────────────────────────────────────────
 * Which toggles are active, and a session count (PRD §4/§8) — nothing else.
 * No per-post, per-ad or per-hide-event counting (PRD §8's own open
 * question explicitly defers that).
 */
export interface Metrics {
  /** How many times each toggle has been switched on, ever. */
  toggleOnCount: Record<ToggleKey, number>;
  /** How many times each toggle has been switched off, ever. */
  toggleOffCount: Record<ToggleKey, number>;
  /** One content-script boot on x.com/twitter.com = one session. */
  sessionCount: number;
  /** How many times popup was opened. */
  popupOpenCount: number;
}

export function emptyMetrics(): Metrics {
  const zeroPerToggle = () => TOGGLE_ORDER.reduce((acc, key) => ({ ...acc, [key]: 0 }), {} as Record<ToggleKey, number>);
  return {
    toggleOnCount: zeroPerToggle(),
    toggleOffCount: zeroPerToggle(),
    sessionCount: 0,
    popupOpenCount: 0,
  };
}
