/**
 * Pure note-list operations — no chrome.* here, so scripts/selftest.mjs can
 * exercise capture/edit/delete and the draft-continuation rule directly.
 * storage.ts is the only file that turns these into chrome.storage.local
 * reads and writes, same split as RedditVoiceOfCustomer's dedupe.ts.
 *
 * Unlike that sibling's quotes, two notes at the same timestamp on the same
 * video are not a bug — a viewer might legitimately jot two separate
 * thoughts in the same moment — so there is no dedupe/merge step here, only
 * plain CRUD, sorted by when they occur in the video rather than when they
 * were typed.
 */

import { Draft, NewNoteInput, VideoNote } from './types';

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newNoteId(): string {
  return randomId('n');
}

export function addNote(notes: VideoNote[], input: NewNoteInput): { notes: VideoNote[]; note: VideoNote } {
  const note: VideoNote = { ...input, text: input.text.trim(), id: newNoteId(), createdAt: Date.now() };
  return { notes: [...notes, note], note };
}

export function editNoteText(notes: VideoNote[], id: string, text: string): VideoNote[] {
  return notes.map(n => (n.id === id ? { ...n, text } : n));
}

export function removeNote(notes: VideoNote[], id: string): VideoNote[] {
  return notes.filter(n => n.id !== id);
}

/** Every note for one video, oldest timestamp first — the order a viewer
 *  scrubbing through the video would meet them in. */
export function notesForVideo(notes: VideoNote[], videoId: string): VideoNote[] {
  return notes.filter(n => n.videoId === videoId).sort((a, b) => a.seconds - b.seconds || a.createdAt - b.createdAt);
}

export interface VideoSummary {
  videoId: string;
  videoTitle: string;
  count: number;
  updatedAt: number;
}

/** One row per video that has at least one note, most recently touched
 *  first — not shown in V1's panel (PRD-29 §4 keeps the panel to the current
 *  video), but kept here as a pure, tested building block for the "how many
 *  other videos have notes" line the empty state can show without a second
 *  storage pass. */
export function summarizeVideos(notes: VideoNote[]): VideoSummary[] {
  const byVideo = new Map<string, VideoSummary>();
  for (const note of notes) {
    const existing = byVideo.get(note.videoId);
    if (!existing) {
      byVideo.set(note.videoId, { videoId: note.videoId, videoTitle: note.videoTitle, count: 1, updatedAt: note.createdAt });
      continue;
    }
    existing.count++;
    if (note.createdAt > existing.updatedAt) existing.updatedAt = note.createdAt;
  }
  return [...byVideo.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Whether reopening the capture card should restore an in-progress draft, or
 * start fresh (PRD §7: "user navigates away mid-note" must not lose text,
 * but opening the card on a video with no unsaved text is just a new note).
 * A draft only continues when it belongs to the video being reopened on and
 * still has something typed in it — an empty draft is nothing to restore.
 */
export function continueDraftFor(draft: Draft | null, videoId: string): Draft | null {
  if (!draft) return null;
  if (draft.videoId !== videoId) return null;
  if (!draft.text.trim()) return null;
  return draft;
}
