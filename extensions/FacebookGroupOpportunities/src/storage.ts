/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6/README hard
 * constraints) — group content is "private-ish" personal data (PRD §5), so it
 * never leaves the device, and "Clear all data" has to be one click.
 */

import { Opportunity, OpportunityStatus, Rule } from './types';

const RULES_KEY = 'fgo:rules';
const ITEMS_KEY = 'fgo:items';
const OPTIONS_KEY = 'fgo:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

/* ── Rules ───────────────────────────────────────────────────────────── */

export async function readRules(): Promise<Rule[]> {
  const stored = await chrome.storage.local.get(RULES_KEY);
  const rules = stored?.[RULES_KEY];
  return Array.isArray(rules) ? (rules as Rule[]) : [];
}

async function writeRules(rules: Rule[]): Promise<void> {
  await chrome.storage.local.set({ [RULES_KEY]: rules });
}

/**
 * Mutations are read-modify-write on one key, so two rapid edits (rename
 * while toggling enabled) would drop one of them. Serializing costs nothing
 * at this volume — at most a few dozen rules.
 */
let ruleQueue: Promise<unknown> = Promise.resolve();

export function mutateRules<T>(mutate: (rules: Rule[]) => T): Promise<T> {
  const next = ruleQueue.then(async () => {
    const rules = await readRules();
    const result = mutate(rules);
    await writeRules(rules);
    return result;
  });
  ruleQueue = next.catch(() => undefined);
  return next;
}

export function newRuleId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Opportunities ───────────────────────────────────────────────────── */

type ItemStore = Record<string, Opportunity>;

async function readItemStore(): Promise<ItemStore> {
  const stored = await chrome.storage.local.get(ITEMS_KEY);
  const value = stored?.[ITEMS_KEY];
  return value && typeof value === 'object' ? (value as ItemStore) : {};
}

async function writeItemStore(store: ItemStore): Promise<void> {
  await chrome.storage.local.set({ [ITEMS_KEY]: store });
}

let itemQueue: Promise<unknown> = Promise.resolve();

function mutateItems<T>(mutate: (store: ItemStore) => T): Promise<T> {
  const next = itemQueue.then(async () => {
    const store = await readItemStore();
    const result = mutate(store);
    await writeItemStore(store);
    return result;
  });
  itemQueue = next.catch(() => undefined);
  return next;
}

export async function readAllOpportunities(): Promise<Opportunity[]> {
  const store = await readItemStore();
  return Object.values(store).sort((a, b) => b.capturedAt - a.capturedAt);
}

/**
 * Insert a freshly-captured post, or leave the existing one alone if the same
 * id was already captured (PRD §7 dedupe on re-scroll). Status and note are
 * never overwritten by a re-sighting — the user's triage work is never lost.
 */
export async function upsertOpportunity(item: Opportunity): Promise<{ isNew: boolean }> {
  return mutateItems(store => {
    if (store[item.id]) return { isNew: false };
    store[item.id] = item;
    return { isNew: true };
  });
}

export async function setOpportunityStatus(id: string, status: OpportunityStatus): Promise<void> {
  await mutateItems(store => {
    const item = store[id];
    if (item) item.status = status;
  });
}

export async function setOpportunityNote(id: string, note: string): Promise<void> {
  await mutateItems(store => {
    const item = store[id];
    if (item) item.note = note;
  });
}

export async function deleteOpportunity(id: string): Promise<void> {
  await mutateItems(store => {
    delete store[id];
  });
}

export async function clearOpportunities(): Promise<void> {
  await mutateItems(store => {
    for (const key of Object.keys(store)) delete store[key];
  });
}

/* ── Whole-library operations ────────────────────────────────────────── */

export interface Backup {
  format: 'facebook-group-opportunities';
  version: 1;
  exportedAt: string;
  rules: Rule[];
  items: Opportunity[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'facebook-group-opportunities',
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: await readRules(),
    items: await readAllOpportunities(),
  };
}

export interface ImportResult {
  rules: number;
  items: number;
}

/**
 * Merges a backup into local storage. Rules are matched by id, items by id —
 * restoring the same file twice must not double anything.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'facebook-group-opportunities') {
    throw new Error('That file is not a Facebook Group Opportunity Finder backup.');
  }

  let rulesAdded = 0;
  if (Array.isArray(backup.rules)) {
    await mutateRules(rules => {
      const byId = new Map(rules.map(r => [r.id, r]));
      for (const rule of backup.rules!) {
        if (!rule?.id || typeof rule.name !== 'string') continue;
        if (!byId.has(rule.id)) rulesAdded++;
        byId.set(rule.id, rule);
      }
      rules.length = 0;
      rules.push(...byId.values());
    });
  }

  let itemsAdded = 0;
  if (Array.isArray(backup.items)) {
    await mutateItems(store => {
      for (const item of backup.items!) {
        if (!item?.id || typeof item.postText !== 'string') continue;
        if (!store[item.id]) itemsAdded++;
        store[item.id] = item;
      }
    });
  }

  return { rules: rulesAdded, items: itemsAdded };
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.remove([RULES_KEY, ITEMS_KEY]);
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export async function quotaStatus(): Promise<QuotaStatus> {
  let bytes = 0;
  try {
    bytes = await chrome.storage.local.getBytesInUse(null);
  } catch {
    /* not implemented everywhere; treat as empty */
  }
  const ratio = bytes / QUOTA_BYTES;
  return { bytes, ratio, warn: ratio >= WARN_RATIO };
}

/* ── Panel options ───────────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
