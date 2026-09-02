/**
 * Transcript history — what you actually took, and when.
 *
 * An entry is written when a transcript leaves the panel: copied to the
 * clipboard, or downloaded as Markdown, text or PDF. Opening a video does not
 * make history, and neither does reading it: the list is a record of what you
 * took away, so that it stays short enough to be worth reading.
 */

const KEY = 'ytx_history';

/** What was taken. Kept coarse — these are labels, not analytics. */
export type HistoryAction = 'copy' | 'md' | 'txt' | 'pdf' | 'prompt';

export interface HistoryEntry {
  videoId: string;
  title: string;
  channel: string;
  url: string;
  /** Most recent first use of this video; the row's date. */
  updatedAt: number;
  /** Everything ever taken for this video, in the order first taken. */
  actions: HistoryAction[];
}

/**
 * How many videos to remember.
 *
 * An entry is a few hundred bytes, so this is generous on purpose: the point of
 * a history is that the thing you half-remember from last month is still there.
 */
const MAX_ENTRIES = 500;

type Store = Record<string, HistoryEntry>;

async function readStore(): Promise<Store> {
  try {
    const raw = await chrome.storage.local.get(KEY);
    const store = raw?.[KEY];
    return store && typeof store === 'object' ? (store as Store) : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  try {
    await chrome.storage.local.set({ [KEY]: store });
  } catch {
    /* history is a convenience; a failed write is not worth an error state */
  }
}

/**
 * Record that a transcript was taken.
 *
 * One row per video however many times you export it — five rows for the same
 * video in four formats would bury the other videos. The row's date moves to
 * the most recent time, and the formats accumulate.
 */
export async function recordTaken(
  entry: Omit<HistoryEntry, 'updatedAt' | 'actions'>,
  action: HistoryAction,
): Promise<void> {
  const store = await readStore();
  const existing = store[entry.videoId];

  store[entry.videoId] = {
    ...entry,
    updatedAt: Date.now(),
    actions:
      existing && existing.actions.includes(action)
        ? existing.actions
        : [...(existing?.actions ?? []), action],
  };

  const ids = Object.keys(store);
  if (ids.length > MAX_ENTRIES) {
    const stale = ids
      .sort((a, b) => (store[a].updatedAt ?? 0) - (store[b].updatedAt ?? 0))
      .slice(0, ids.length - MAX_ENTRIES);
    for (const id of stale) delete store[id];
  }

  await writeStore(store);
}

/** Everything taken, most recent first. */
export async function listHistory(): Promise<HistoryEntry[]> {
  const store = await readStore();
  return Object.values(store).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function forgetVideos(videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;
  const store = await readStore();
  for (const id of videoIds) delete store[id];
  await writeStore(store);
}

const LABELS: Record<HistoryAction, string> = {
  copy: 'Copied',
  md: '.md',
  txt: '.txt',
  pdf: '.pdf',
  prompt: 'Prompt',
};

/** "Copied · .md · .pdf" — what a row says about itself. Pure, so it is tested. */
export function describeActions(actions: HistoryAction[]): string {
  return actions.map(action => LABELS[action] ?? action).join(' · ');
}
