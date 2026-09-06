/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §6). One record family: notes
 * keyed by normalized profile URL, plus the fuzzy name+headline index used
 * only for the "this looks like someone you've noted before" suggestion
 * (PRD §7: vanity URL changing over time).
 */

import { fuzzyKey } from './text';
import { ProfileNote } from './types';

const NOTE_PREFIX = 'lpn:note:';
const OPTIONS_KEY = 'lpn:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

const noteKey = (id: string) => NOTE_PREFIX + id;

/* ── Notes ───────────────────────────────────────────────────────────── */

export async function listNotes(): Promise<ProfileNote[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(NOTE_PREFIX))
    .map(([, value]) => value as ProfileNote)
    .filter(note => note && typeof note.id === 'string')
    .sort((a, b) => b.lastNotedAt - a.lastNotedAt);
}

export async function getNote(id: string): Promise<ProfileNote | null> {
  const stored = await chrome.storage.local.get(noteKey(id));
  return (stored?.[noteKey(id)] as ProfileNote | undefined) ?? null;
}

/**
 * A same-person match under a *different* stored id, found by comparing
 * normalized name+headline (PRD §7). Only ever used to power a soft
 * "merge?" suggestion — never an automatic merge.
 */
export async function findFuzzyMatch(id: string, name: string, headline: string): Promise<ProfileNote | null> {
  const key = fuzzyKey(name, headline);
  if (!key.trim() || key === '|') return null;
  const notes = await listNotes();
  return notes.find(note => note.id !== id && fuzzyKey(note.name, note.headline) === key) ?? null;
}

export interface UpsertInput {
  id: string;
  name: string;
  headline: string;
  avatarUrl: string;
  text: string;
  tag: string;
}

/** Insert-or-update the note for a profile. Creating with empty text/tag is a no-op save. */
export async function upsertNote(input: UpsertInput): Promise<ProfileNote> {
  const existing = await getNote(input.id);
  const now = Date.now();
  const record: ProfileNote = {
    id: input.id,
    name: input.name || existing?.name || '',
    headline: input.headline || existing?.headline || '',
    avatarUrl: input.avatarUrl || existing?.avatarUrl || '',
    text: input.text,
    tag: input.tag,
    firstNotedAt: existing?.firstNotedAt ?? now,
    lastNotedAt: now,
  };
  await chrome.storage.local.set({ [noteKey(input.id)]: record });
  return record;
}

export async function deleteNote(id: string): Promise<void> {
  await chrome.storage.local.remove(noteKey(id));
}

/** Renames a note's storage key — used by the "merge under the new URL" flow (PRD §7). */
export async function mergeNoteInto(staleId: string, targetId: string): Promise<void> {
  const [stale, target] = await Promise.all([getNote(staleId), getNote(targetId)]);
  if (!stale) return;
  const merged: ProfileNote = target
    ? {
        ...target,
        text: [target.text, stale.text].filter(Boolean).join('\n\n'),
        tag: target.tag || stale.tag,
        firstNotedAt: Math.min(target.firstNotedAt, stale.firstNotedAt),
        lastNotedAt: Math.max(target.lastNotedAt, stale.lastNotedAt),
      }
    : { ...stale, id: targetId };
  await chrome.storage.local.set({ [noteKey(targetId)]: merged });
  await chrome.storage.local.remove(noteKey(staleId));
}

/* ── Whole-library operations ───────────────────────────────────────── */

export interface Backup {
  format: 'linkedin-profile-notes';
  version: 1;
  exportedAt: string;
  notes: ProfileNote[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'linkedin-profile-notes',
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: await listNotes(),
  };
}

export interface ImportResult {
  notes: number;
}

/**
 * Merges a backup into local storage, matched by id. Importing the same file
 * twice must not lose a note or duplicate anything (PRD §4: "merge, not
 * overwrite"). Where both sides have text, the imported text is appended
 * rather than dropped, since a silent overwrite would destroy local edits.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'linkedin-profile-notes' || !Array.isArray(backup.notes)) {
    throw new Error('That file is not a LinkedIn Profile Notes backup.');
  }

  let notes = 0;
  const writes: Record<string, unknown> = {};

  for (const note of backup.notes) {
    if (!note?.id || typeof note.text !== 'string') continue;
    const existing = await getNote(note.id);
    if (!existing) {
      writes[noteKey(note.id)] = note;
    } else if (existing.text.trim() === note.text.trim()) {
      // Identical text already present — keep the newer metadata, don't duplicate content.
      writes[noteKey(note.id)] = {
        ...existing,
        tag: existing.tag || note.tag || '',
        firstNotedAt: Math.min(existing.firstNotedAt, note.firstNotedAt ?? existing.firstNotedAt),
        lastNotedAt: Math.max(existing.lastNotedAt, note.lastNotedAt ?? existing.lastNotedAt),
      };
    } else {
      writes[noteKey(note.id)] = {
        ...existing,
        text: [existing.text, note.text].filter(Boolean).join('\n\n'),
        tag: existing.tag || note.tag || '',
        firstNotedAt: Math.min(existing.firstNotedAt, note.firstNotedAt ?? existing.firstNotedAt),
        lastNotedAt: Math.max(existing.lastNotedAt, note.lastNotedAt ?? existing.lastNotedAt),
      };
    }
    notes++;
  }

  await chrome.storage.local.set(writes);
  return { notes };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(NOTE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
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

/* ── Panel preferences ───────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
