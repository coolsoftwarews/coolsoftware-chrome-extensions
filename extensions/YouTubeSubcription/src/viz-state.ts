/**
 * The filters shared by the side panel and the in-page insights modal.
 *
 * These live apart from the main store, in their own storage key, for one
 * reason: they change *constantly* (every keystroke in the search box) and the
 * main store is rewritten whole on every mutation. Folding view state into it
 * would mean re-serialising a few hundred channels and several thousand video
 * rows to record that someone typed a letter — and firing a store-changed event
 * that makes every surface re-render its channel list.
 *
 * The panel owns these controls; the modal only reads them. Storage is the
 * wire between the two, so no message passing is needed to keep them in step
 * and the modal picks up where it left off after a reload.
 */

import { DEFAULT_FIELDS, SearchField } from './search';

/**
 * What the charts measure.
 *
 * `ratio` is likes ÷ views, and it behaves differently from the other three:
 * counts and sums can be stacked by group, a ratio cannot. Adding one group's
 * engagement rate to another's produces a number that means nothing — see
 * `renderColumns`, which drops the stacking for it.
 */
export type VizMetric = 'uploads' | 'views' | 'likes' | 'ratio';

export const METRICS: Array<{ id: VizMetric; label: string }> = [
  { id: 'uploads', label: 'Uploads' },
  { id: 'views', label: 'Views' },
  { id: 'likes', label: 'Likes' },
  { id: 'ratio', label: 'Likes per view' },
];

const KEY = 'ysg:viz';

export type VizView = 'chart' | 'table';

export interface VizState {
  /** Group id, or '' for every subscription. */
  groupId: string;
  /**
   * One channel inside that scope, or '' for all of them.
   *
   * Narrows the group rather than replacing it, so "this channel, in this
   * period" is one question and the breadcrumb in the overlay can say both.
   */
  channelId: string;
  /**
   * The period select's raw value: a day count, `n<rows>` for "latest N", or
   * 'all'. Kept as the control's own string so the panel and the modal cannot
   * disagree about how to decode it — see `vizScope`.
   */
  window: string;
  query: string;
  /** Which fields the query is matched against. */
  fields: SearchField[];
  /** What the daily chart measures. */
  metric: VizMetric;
  /**
   * What "most active" means in the channel ranking.
   *
   * Separate from `metric` on purpose: "uploads per day" against "top channels
   * by views" is a normal pair of questions to hold at once, and forcing both
   * charts onto one measure answers neither well.
   */
  channelMetric: VizMetric;
  view: VizView;
}

export const DEFAULT_VIZ_STATE: VizState = {
  groupId: '',
  channelId: '',
  window: '7',
  query: '',
  fields: DEFAULT_FIELDS,
  metric: 'uploads',
  channelMetric: 'uploads',
  view: 'chart',
};

export async function readVizState(): Promise<VizState> {
  const raw = await chrome.storage.local.get(KEY);
  const stored = raw[KEY] as Partial<VizState> | undefined;
  return {
    ...DEFAULT_VIZ_STATE,
    ...stored,
    // An older stored state has no field list; an empty one is a valid choice
    // but not a valid default.
    fields: stored?.fields?.length ? stored.fields : DEFAULT_FIELDS,
  };
}

export async function writeVizState(patch: Partial<VizState>): Promise<void> {
  const next = { ...(await readVizState()), ...patch };
  await chrome.storage.local.set({ [KEY]: next });
}

export function onVizStateChanged(cb: (state: VizState) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local' || !changes[KEY]) return;
    cb({ ...DEFAULT_VIZ_STATE, ...(changes[KEY].newValue as Partial<VizState>) });
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/** The one place the period select's value is decoded. */
export function vizScope(state: VizState): {
  groupId: string | null;
  days: number | null;
  limit: number | null;
} {
  return {
    groupId: state.groupId || null,
    days: /^\d+$/.test(state.window) ? Number(state.window) : null,
    limit: state.window.startsWith('n') ? Number(state.window.slice(1)) : null,
  };
}
