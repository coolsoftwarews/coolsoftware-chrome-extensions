/**
 * chrome.storage.local is the whole backend (PRD §6): no server, no account,
 * no sync. Marks are keyed by video id so a video's list survives closing the
 * tab and reopening it later, without ever growing into one unbounded blob.
 *
 * This is the only file that touches chrome.storage.* directly; content.ts
 * and panel.ts both import it, same split as the rest of this portfolio.
 */
import { insertClip, removeClip, setClipNote, sortClips } from './marks';
import { ClipCandidate } from './types';

const PREFIX = 'yhm:clips:';
const keyFor = (videoId: string): string => `${PREFIX}${videoId}`;

export async function readClips(videoId: string): Promise<ClipCandidate[]> {
  if (!videoId) return [];
  const stored = await chrome.storage.local.get(keyFor(videoId));
  const clips = stored?.[keyFor(videoId)] as ClipCandidate[] | undefined;
  return clips ? sortClips(clips) : [];
}

async function writeClips(videoId: string, clips: ClipCandidate[]): Promise<void> {
  if (clips.length === 0) {
    await chrome.storage.local.remove(keyFor(videoId));
    return;
  }
  await chrome.storage.local.set({ [keyFor(videoId)]: clips });
}

/**
 * Every mutation is a read-modify-write against one video's key, so two
 * writes racing (e.g. a mark-out completing while the panel edits a note)
 * would drop one of them. Chained through a single queue, same pattern as
 * every other Saver-style extension in this portfolio.
 */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => undefined);
  return next;
}

export function addClip(videoId: string, clip: ClipCandidate): Promise<ClipCandidate[]> {
  return mutate(async () => {
    const next = insertClip(await readClips(videoId), clip);
    await writeClips(videoId, next);
    return next;
  });
}

export function updateClipNote(videoId: string, id: string, note: string): Promise<ClipCandidate[]> {
  return mutate(async () => {
    const next = setClipNote(await readClips(videoId), id, note);
    await writeClips(videoId, next);
    return next;
  });
}

export function deleteClip(videoId: string, id: string): Promise<ClipCandidate[]> {
  return mutate(async () => {
    const next = removeClip(await readClips(videoId), id);
    await writeClips(videoId, next);
    return next;
  });
}

export function clearClipsForVideo(videoId: string): Promise<void> {
  return mutate(() => chrome.storage.local.remove(keyFor(videoId)));
}

/* ── Full backup: export all / import / clear all (hard constraint) ────── */

export interface Backup {
  format: 'youtube-highlight-marker-backup';
  version: 1;
  exportedAt: string;
  clipsByVideo: Record<string, ClipCandidate[]>;
}

export async function exportAllData(): Promise<Backup> {
  const all = await chrome.storage.local.get(null);
  const clipsByVideo: Record<string, ClipCandidate[]> = {};
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith(PREFIX)) continue;
    const videoId = key.slice(PREFIX.length);
    clipsByVideo[videoId] = sortClips(value as ClipCandidate[]);
  }
  return {
    format: 'youtube-highlight-marker-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    clipsByVideo,
  };
}

export interface ImportResult {
  videosImported: number;
  clipsImported: number;
}

/** Merges by clip id, so importing the same backup twice never duplicates a mark. */
export function mergeImport(
  existing: Record<string, ClipCandidate[]>,
  raw: unknown,
): { merged: Record<string, ClipCandidate[]>; result: ImportResult } {
  const backup = raw as Partial<Backup> | null;
  if (!backup || typeof backup !== 'object' || !backup.clipsByVideo) {
    throw new Error('Not a recognized highlight marker backup file.');
  }

  const merged: Record<string, ClipCandidate[]> = { ...existing };
  let videosImported = 0;
  let clipsImported = 0;

  for (const [videoId, clips] of Object.entries(backup.clipsByVideo)) {
    if (!Array.isArray(clips)) continue;
    const current = merged[videoId] ?? [];
    const byId = new Map(current.map(c => [c.id, c]));
    let addedForVideo = 0;
    for (const clip of clips) {
      if (!clip || typeof clip !== 'object' || typeof clip.id !== 'string') continue;
      if (!byId.has(clip.id)) {
        byId.set(clip.id, clip as ClipCandidate);
        addedForVideo += 1;
      }
    }
    if (addedForVideo > 0) {
      merged[videoId] = sortClips(Array.from(byId.values()));
      videosImported += 1;
      clipsImported += addedForVideo;
    }
  }

  return { merged, result: { videosImported, clipsImported } };
}

export function importAllData(raw: unknown): Promise<ImportResult> {
  return mutate(async () => {
    const existing = (await exportAllData()).clipsByVideo;
    const { merged, result } = mergeImport(existing, raw);
    const toWrite: Record<string, ClipCandidate[]> = {};
    for (const [videoId, clips] of Object.entries(merged)) {
      toWrite[keyFor(videoId)] = clips;
    }
    if (Object.keys(toWrite).length) await chrome.storage.local.set(toWrite);
    return result;
  });
}

export function clearAllData(): Promise<void> {
  return mutate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(k => k.startsWith(PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys);
  });
}
