/**
 * chrome.storage.local is the whole backend (README hard constraints — no
 * server, no account). This file owns two collections: the leads themselves,
 * keyed by dedupe id, and the qualification rules. Both ship in one backup
 * file so "export all / import / clear all" (PRD §4) is a single action.
 */

import { defaultRules } from './rules';
import { Backup, ImportResult, Lead, RawCapture, Rule } from './types';
import { mergeCapture } from './dedupe';

const LEADS_KEY = 'llf:leads';
const RULES_KEY = 'llf:rules';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

/** Enormous threads are capped per collection click (PRD §7). */
export const MAX_CAPTURES_PER_COLLECTION = 500;

type LeadStore = Record<string, Lead>;

async function readStore(): Promise<LeadStore> {
  try {
    const raw = await chrome.storage.local.get(LEADS_KEY);
    const store = raw?.[LEADS_KEY];
    return store && typeof store === 'object' ? (store as LeadStore) : {};
  } catch {
    return {};
  }
}

async function writeStore(store: LeadStore): Promise<void> {
  await chrome.storage.local.set({ [LEADS_KEY]: store });
}

export async function readAllLeads(): Promise<Lead[]> {
  const store = await readStore();
  return Object.values(store).sort((a, b) => b.lastCollectedAt - a.lastCollectedAt);
}

export async function readLead(id: string): Promise<Lead | null> {
  const store = await readStore();
  return store[id] ?? null;
}

export interface MergeResult {
  newLeads: number;
  updatedLeads: number;
}

/**
 * Serialized so two rapid "Collect commenters" clicks (or a click racing the
 * panel) never clobber each other — same pattern as WebHighlighter's
 * mutatePage queue.
 */
let queue: Promise<unknown> = Promise.resolve();

export function mergeCaptures(raws: RawCapture[]): Promise<MergeResult> {
  const next = queue.then(async () => {
    const store = await readStore();
    const now = Date.now();
    let newLeads = 0;
    let updatedLeads = 0;

    for (const raw of raws) {
      // Recompute the dedupe key without an existing lead so we can look it up.
      const probe = mergeCapture(undefined, raw, now);
      const existing = store[probe.id];
      store[probe.id] = mergeCapture(existing, raw, now);
      if (existing) updatedLeads++;
      else newLeads++;
    }

    await writeStore(store);
    return { newLeads, updatedLeads };
  });
  queue = next.catch(() => undefined);
  return next;
}

export async function setStatus(id: string, status: Lead['status']): Promise<void> {
  const store = await readStore();
  const lead = store[id];
  if (!lead) return;
  store[id] = { ...lead, status };
  await writeStore(store);
}

export async function setNote(id: string, note: string): Promise<void> {
  const store = await readStore();
  const lead = store[id];
  if (!lead) return;
  store[id] = { ...lead, note };
  await writeStore(store);
}

export async function deleteLead(id: string): Promise<void> {
  const store = await readStore();
  delete store[id];
  await writeStore(store);
}

export async function clearLeads(): Promise<void> {
  await chrome.storage.local.remove(LEADS_KEY);
}

/* ── Rules ───────────────────────────────────────────────────────────── */

export async function readRules(): Promise<Rule[]> {
  try {
    const raw = await chrome.storage.local.get(RULES_KEY);
    const stored = raw?.[RULES_KEY];
    if (Array.isArray(stored) && stored.length) return stored as Rule[];
  } catch {
    /* fall through to defaults */
  }
  const seeded = defaultRules();
  await chrome.storage.local.set({ [RULES_KEY]: seeded });
  return seeded;
}

export async function writeRules(rules: Rule[]): Promise<void> {
  await chrome.storage.local.set({ [RULES_KEY]: rules });
}

/* ── Whole-library operations ───────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'linkedin-lead-finder',
    version: 1,
    exportedAt: new Date().toISOString(),
    leads: await readAllLeads(),
    rules: await readRules(),
  };
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'linkedin-lead-finder' || !Array.isArray(backup.leads)) {
    throw new Error('That file is not a LinkedIn Lead Finder backup.');
  }

  const store = await readStore();
  let newLeads = 0;

  for (const incoming of backup.leads) {
    if (!incoming?.id || !Array.isArray(incoming.captures)) continue;
    if (!store[incoming.id]) newLeads++;
    // A restored lead is merged capture-by-capture so it combines with
    // anything collected locally since the backup was made, rather than
    // silently overwriting it.
    let merged = store[incoming.id];
    for (const capture of incoming.captures) {
      merged = mergeCapture(
        merged,
        {
          name: incoming.name,
          headline: incoming.headline,
          profileUrl: incoming.profileUrl,
          isCompany: incoming.isCompany,
          isAnonymized: incoming.isAnonymized,
          commentText: capture.commentText,
          reactionCount: capture.reactionCount,
          commentDate: capture.commentDate,
          postUrl: capture.postUrl,
          postLabel: capture.postLabel,
        },
        capture.collectedAt,
      );
    }
    if (merged) {
      merged.status = store[incoming.id]?.status ?? incoming.status ?? 'new';
      merged.note = store[incoming.id]?.note || incoming.note || '';
      store[incoming.id] = merged;
    }
  }

  await writeStore(store);

  let rulesImported = 0;
  if (Array.isArray(backup.rules) && backup.rules.length) {
    const existingRules = await readRules();
    const byKeyword = new Map(existingRules.map(r => [r.keyword.toLowerCase(), r]));
    for (const rule of backup.rules) {
      if (!rule?.keyword) continue;
      if (!byKeyword.has(rule.keyword.toLowerCase())) {
        byKeyword.set(rule.keyword.toLowerCase(), rule);
        rulesImported++;
      }
    }
    await writeRules([...byKeyword.values()]);
  }

  return { leads: backup.leads.length, newLeads, rules: rulesImported };
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.remove([LEADS_KEY, RULES_KEY]);
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
