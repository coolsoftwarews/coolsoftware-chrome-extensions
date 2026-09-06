/**
 * CSV export (PRD §4). Deliberately pure — no DOM, no chrome.* — so
 * scripts/selftest.mjs can check the output byte-for-byte. JSON export/import
 * is the Backup shape in src/storage.ts; this file only covers the CSV
 * deliverable and the shared filename builder.
 */

import { ProfileNote } from './types';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatDate(at: number): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** CSV columns exactly as PRD §4 lists them: name, headline, tag, note, profile url, first noted, last noted. */
export function toCsv(notes: ProfileNote[]): string {
  const header = ['name', 'headline', 'tag', 'note', 'profile_url', 'first_noted', 'last_noted'];
  const rows = notes.map(note =>
    [
      csvCell(note.name),
      csvCell(note.headline),
      csvCell(note.tag),
      csvCell(note.text),
      csvCell(note.id),
      csvCell(formatDate(note.firstNotedAt)),
      csvCell(formatDate(note.lastNotedAt)),
    ].join(',')
  );
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}

/** `linkedin-profile-notes-{yyyy-mm-dd}.{ext}` — no page title to build a filename from here. */
export function buildFilename(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `linkedin-profile-notes-${stamp}.${ext}`;
}
