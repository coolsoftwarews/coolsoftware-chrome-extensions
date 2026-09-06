/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension. This file is the only place that
 * touches chrome.storage.*; every mutation it exposes wraps a pure function
 * from notes.ts / backup.ts, which is what makes those testable in
 * scripts/selftest.mjs without a browser. Available directly inside the
 * content script too (no background relay needed for reads/writes) — only
 * chrome.downloads needs an extension-page context, and both the content
 * script's capture card and the side panel skip that entirely: notes are
 * written here, exports happen from the panel, which already has direct
 * chrome.downloads access as a side panel page.
 */

import { addNote, editNoteText, removeNote } from './notes';
import { buildBackup, mergeImport } from './backup';
import { Backup, Draft, ImportResult, NewNoteInput, QuotaStatus, VideoNote } from './types';

const NOTES_KEY = 'ycn:notes';
const DRAFT_KEY = 'ycn:draft';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested —
 *  not requested here, so this ratio is the only guard against silently
 *  running out of room. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

export async function readNotes(): Promise<VideoNote[]> {
  const stored = await chrome.storage.local.get(NOTES_KEY);
  return (stored?.[NOTES_KEY] as VideoNote[] | undefined) ?? [];
}

async function writeNotes(notes: VideoNote[]): Promise<void> {
  await chrome.storage.local.set({ [NOTES_KEY]: notes });
}

/**
 * Mutations are read-modify-write over one key, so a save racing an edit
 * would drop one of them. A single queue is enough at this volume — same
 * pattern as RedditVoiceOfCustomer's storage.ts.
 */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => undefined);
  return next;
}

export function saveNote(input: NewNoteInput): Promise<VideoNote> {
  return mutate(async () => {
    const { notes, note } = addNote(await readNotes(), input);
    await writeNotes(notes);
    return note;
  });
}

export function updateNoteText(id: string, text: string): Promise<void> {
  return mutate(async () => {
    await writeNotes(editNoteText(await readNotes(), id, text));
  });
}

export function deleteNote(id: string): Promise<void> {
  return mutate(async () => {
    await writeNotes(removeNote(await readNotes(), id));
  });
}

/* ── Draft (PRD §7: a note in progress must survive navigating away) ──── */

export async function readDraft(): Promise<Draft | null> {
  try {
    const stored = await chrome.storage.local.get(DRAFT_KEY);
    const draft = stored?.[DRAFT_KEY] as Draft | undefined;
    return draft && typeof draft.videoId === 'string' ? draft : null;
  } catch {
    return null;
  }
}

export async function writeDraft(draft: Draft): Promise<void> {
  try {
    await chrome.storage.local.set({ [DRAFT_KEY]: draft });
  } catch {
    /* a draft that fails to persist is not worth interrupting typing for */
  }
}

export async function clearDraft(): Promise<void> {
  try {
    await chrome.storage.local.remove(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/* ── Data ownership: export all / import / clear all ──────────────────── */

export async function exportBackup(): Promise<Backup> {
  return buildBackup(await readNotes());
}

export function importBackup(raw: unknown): Promise<ImportResult> {
  return mutate(async () => {
    const merged = mergeImport(await readNotes(), raw);
    await writeNotes(merged.notes);
    return merged.result;
  });
}

export function clearAllData(): Promise<void> {
  return mutate(async () => {
    await chrome.storage.local.remove([NOTES_KEY, DRAFT_KEY]);
  });
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
