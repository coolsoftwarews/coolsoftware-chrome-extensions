/**
 * The whole-library backup shape and its merge-on-import logic. Pure, like
 * notes.ts, so it is covered by scripts/selftest.mjs without a browser.
 */

import { Backup, ImportResult, VideoNote } from './types';

export function buildBackup(notes: VideoNote[], exportedAt = new Date().toISOString()): Backup {
  return { format: 'youtube-chapter-notes', version: 1, exportedAt, notes };
}

export interface MergedImport {
  notes: VideoNote[];
  result: ImportResult;
}

/**
 * Merges a backup into what's already stored, matched by id. Importing the
 * same file twice must not double a single note (this portfolio's data-
 * ownership rule): a record whose id is already known is overwritten by the
 * incoming one; anything the backup doesn't mention is left untouched.
 */
export function mergeImport(existingNotes: VideoNote[], raw: unknown): MergedImport {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'youtube-chapter-notes' || !Array.isArray(backup.notes)) {
    throw new Error('That file is not a YouTube Chapter Notes backup.');
  }

  const byId = new Map(existingNotes.map(n => [n.id, n]));
  let changed = 0;
  for (const note of backup.notes) {
    if (!note?.id || typeof note.videoId !== 'string' || typeof note.text !== 'string') continue;
    if (!byId.has(note.id)) changed++;
    byId.set(note.id, note);
  }

  return {
    notes: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt),
    result: { notes: changed },
  };
}
