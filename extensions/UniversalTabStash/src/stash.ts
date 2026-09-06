/**
 * All the logic that decides *what a stash is* and *what happens to it* lives
 * here as pure functions over plain objects (`OpenTab`, `StashedTab`, `Stash`).
 * Nothing in this file touches `chrome.*` — that's `tabs.ts` (reading/opening/
 * closing real tabs) and `storage.ts` (the chrome.storage.local IO). Keeping
 * the split means `scripts/selftest.mjs` can exercise stash creation, search,
 * restore planning and backup merging with zero browser APIs in scope.
 */

import { Backup, MergeResult, OpenTab, RestorePlan, Stash, StashedTab, StashSearchHit } from './types';

/** Above this many tabs, restore asks for confirmation first (PRD §7). */
export const CONFIRM_THRESHOLD = 15;
/** Tabs are opened in groups of this size so the browser stays responsive. */
export const RESTORE_BATCH_SIZE = 8;

let counter = 0;
/** A short, sortable, collision-safe id with no dependency on crypto.randomUUID
 *  (available in a browser extension, but selftest runs this in plain Node). */
export function generateId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

/** Converts a live tab object (or anything with the same shape) into an
 *  `OpenTab`. Pure — it only reads fields, it never calls chrome.tabs. */
export function toOpenTab(tab: {
  id?: number;
  title?: string;
  url?: string;
  favIconUrl?: string;
  pinned?: boolean;
}): OpenTab {
  return {
    chromeTabId: tab.id ?? -1,
    // A tab still loading may have no title yet — fall back to the URL, then
    // to a plain placeholder, so a stash action is never blocked (PRD §7).
    title: tab.title?.trim() || tab.url?.trim() || 'Untitled tab',
    url: tab.url ?? '',
    favIconUrl: tab.favIconUrl || undefined,
    pinned: Boolean(tab.pinned),
  };
}

/** "Stash all tabs" excludes pinned tabs by default (PRD §7) — they usually
 *  hold a persistent utility, not something the user meant to sweep up. */
export function filterIncludable(tabs: OpenTab[], includePinned: boolean): OpenTab[] {
  return includePinned ? tabs : tabs.filter(tab => !tab.pinned);
}

export interface CreateStashInput {
  name: string;
  notes?: string;
  tabs: OpenTab[];
  now?: number;
  idGenerator?: () => string;
}

/** Builds a new stash from a set of open tabs. Tab order is preserved — a
 *  stash reads back in the same order the tabs were open in. */
export function createStash(input: CreateStashInput): Stash {
  const now = input.now ?? Date.now();
  const idGen = input.idGenerator ?? (() => generateId('id'));
  const stashId = idGen();
  const tabs: StashedTab[] = input.tabs.map(tab => ({
    id: idGen(),
    title: tab.title,
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned,
  }));

  return {
    id: stashId,
    name: input.name.trim() || defaultStashName(tabs.length, now),
    notes: input.notes?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    tabs,
  };
}

/** Default name when the user leaves the field blank — removes the one bit of
 *  friction that could stop someone mid-declutter (PRD §10). */
export function defaultStashName(tabCount: number, now: number = Date.now()): string {
  const date = new Date(now);
  const datePart = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const timePart = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${tabCount} tab${tabCount === 1 ? '' : 's'} — ${datePart}, ${timePart}`;
}

export function renameStash(stash: Stash, name: string, now: number = Date.now()): Stash {
  return { ...stash, name: name.trim() || stash.name, updatedAt: now };
}

export function setStashNotes(stash: Stash, notes: string, now: number = Date.now()): Stash {
  return { ...stash, notes, updatedAt: now };
}

export function removeTabFromStash(stash: Stash, tabId: string, now: number = Date.now()): Stash {
  return { ...stash, tabs: stash.tabs.filter(tab => tab.id !== tabId), updatedAt: now };
}

/* ── Search ──────────────────────────────────────────────────────────── */

/** Case-insensitive substring match across every stashed tab's title and URL,
 *  across every stash. Order: stash recency, then tab order within a stash. */
export function searchStashes(stashes: Stash[], query: string): StashSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const ordered = [...stashes].sort((a, b) => b.updatedAt - a.updatedAt);
  const hits: StashSearchHit[] = [];
  for (const stash of ordered) {
    for (const tab of stash.tabs) {
      if (tab.title.toLowerCase().includes(needle) || tab.url.toLowerCase().includes(needle)) {
        hits.push({ stashId: stash.id, stashName: stash.name, tab });
      }
    }
  }
  return hits;
}

export function sortStashesByRecency(stashes: Stash[]): Stash[] {
  return [...stashes].sort((a, b) => b.updatedAt - a.updatedAt);
}

/* ── Restore planning ────────────────────────────────────────────────── */

/** Groups a stash's tabs into responsible batches and flags whether the count
 *  crosses the confirmation threshold (PRD §7) — never opens a tab itself. */
export function planRestore(stash: Stash, tabIds?: string[]): RestorePlan {
  const tabs = tabIds ? stash.tabs.filter(tab => tabIds.includes(tab.id)) : stash.tabs;
  const batches: StashedTab[][] = [];
  for (let i = 0; i < tabs.length; i += RESTORE_BATCH_SIZE) {
    batches.push(tabs.slice(i, i + RESTORE_BATCH_SIZE));
  }
  return { tabs, batches, needsConfirmation: tabs.length > CONFIRM_THRESHOLD };
}

/* ── Backup merge (pure — the impure half lives in storage.ts) ─────────── */

/** Merges an imported backup into the existing stash list. Stashes are
 *  matched by id; a stash that already exists gets its tabs merged (also by
 *  id) rather than duplicated, so importing the same file twice is a no-op
 *  the second time (same contract as WebHighlighter's importBackup). */
export function mergeBackup(existing: Stash[], backup: Backup): MergeResult {
  const byId = new Map<string, Stash>(existing.map(stash => [stash.id, stash]));
  let stashesAdded = 0;
  let tabsAdded = 0;

  for (const incoming of backup.stashes) {
    if (!incoming?.id || !Array.isArray(incoming.tabs)) continue;

    const current = byId.get(incoming.id);
    if (!current) {
      byId.set(incoming.id, incoming);
      stashesAdded++;
      tabsAdded += incoming.tabs.length;
      continue;
    }

    const tabsById = new Map<string, StashedTab>(current.tabs.map(tab => [tab.id, tab]));
    for (const tab of incoming.tabs) {
      if (!tab?.id || typeof tab.url !== 'string') continue;
      if (!tabsById.has(tab.id)) tabsAdded++;
      tabsById.set(tab.id, tab);
    }

    byId.set(incoming.id, {
      ...current,
      name: current.name || incoming.name,
      notes: current.notes || incoming.notes,
      tabs: [...tabsById.values()],
      updatedAt: Math.max(current.updatedAt, incoming.updatedAt),
    });
  }

  return {
    merged: sortStashesByRecency([...byId.values()]),
    stats: { stashes: stashesAdded, tabs: tabsAdded },
  };
}

export function parseBackup(raw: unknown): Backup {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'universal-tab-stash' || !Array.isArray(backup.stashes)) {
    throw new Error('That file is not a Universal Tab Stash backup.');
  }
  return backup as Backup;
}
