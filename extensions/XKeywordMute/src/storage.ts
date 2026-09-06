/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6/README hard
 * constraints) — the rule list is the only thing this product stores, and
 * "Export all / import / clear all" (the README's constraint on every
 * product that stores anything) is one click each in the panel.
 */

import { Rule } from './types';

const RULES_KEY = 'xkm:rules';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested — a
 *  rule list will never come close, but the warning is cheap and consistent
 *  with the rest of the portfolio. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

export async function readRules(): Promise<Rule[]> {
  const stored = await chrome.storage.local.get(RULES_KEY);
  const rules = stored?.[RULES_KEY];
  return Array.isArray(rules) ? (rules as Rule[]) : [];
}

async function writeRules(rules: Rule[]): Promise<void> {
  await chrome.storage.local.set({ [RULES_KEY]: rules });
}

/**
 * Mutations are read-modify-write on one key, so two rapid edits (e.g. a hit
 * count increment racing a rule edit) would drop one of them. Serializing
 * costs nothing at this volume — at most a few hundred rules.
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

/* ── Whole-list operations ───────────────────────────────────────────── */

export interface Backup {
  format: 'x-keyword-mute';
  version: 1;
  exportedAt: string;
  rules: Rule[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'x-keyword-mute',
    version: 1,
    exportedAt: new Date().toISOString(),
    rules: await readRules(),
  };
}

export interface ImportResult {
  rules: number;
}

/**
 * Merges an imported rule list into local storage, matched by id — importing
 * the same file twice must not double anything. A rule with no id or no
 * value is skipped rather than corrupting the list.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'x-keyword-mute' || !Array.isArray(backup.rules)) {
    throw new Error('That file is not an X Keyword Mute rule list.');
  }

  let added = 0;
  await mutateRules(rules => {
    const byId = new Map(rules.map(r => [r.id, r]));
    for (const rule of backup.rules!) {
      if (!rule?.id || typeof rule.value !== 'string' || !rule.value.trim()) continue;
      if (!byId.has(rule.id)) added++;
      byId.set(rule.id, rule);
    }
    rules.length = 0;
    rules.push(...byId.values());
  });

  return { rules: added };
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.remove(RULES_KEY);
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
