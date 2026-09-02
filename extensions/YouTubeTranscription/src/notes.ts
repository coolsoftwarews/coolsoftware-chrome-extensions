/**
 * The notes document — one Markdown file per video, kept on this device.
 *
 * Storage only. The editor that edits it lives in the panel; this module knows
 * nothing about the DOM so the eviction and seeding rules can be read in one
 * place, and tested without a browser.
 */

const KEY = 'ytx_notes';

/**
 * How many videos keep their notes.
 *
 * A transcript seeded into a document is tens of kilobytes, so this is the one
 * store in the extension that could actually grow into a problem. Oldest-edited
 * documents fall off the end.
 */
const MAX_DOCS = 50;

export interface NoteDoc {
  markdown: string;
  updatedAt: number;
  /** The video's title when the document was created, for the file name. */
  title: string;
}

type Store = Record<string, NoteDoc>;

async function readStore(): Promise<Store> {
  try {
    const raw = await chrome.storage.local.get(KEY);
    const store = raw?.[KEY];
    return store && typeof store === 'object' ? (store as Store) : {};
  } catch {
    return {};
  }
}

export interface NoteSummary extends NoteDoc {
  videoId: string;
}

/**
 * Every document, newest first.
 *
 * The whole store is small enough to read at once — fifty documents, capped —
 * so the library filters in memory rather than maintaining an index that could
 * disagree with the documents it describes.
 */
export async function listNotes(): Promise<NoteSummary[]> {
  const store = await readStore();
  return Object.entries(store)
    .map(([videoId, doc]) => ({ videoId, ...doc }))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/** Delete several at once — one write rather than one per document. */
export async function deleteNotes(videoIds: string[]): Promise<void> {
  if (videoIds.length === 0) return;

  const store = await readStore();
  for (const id of videoIds) delete store[id];
  try {
    await chrome.storage.local.set({ [KEY]: store });
  } catch {
    /* nothing useful to say to the reader if this fails */
  }
}

export async function deleteNote(videoId: string): Promise<void> {
  const store = await readStore();
  delete store[videoId];
  try {
    await chrome.storage.local.set({ [KEY]: store });
  } catch {
    /* nothing useful to say to the reader if this fails */
  }
}

/**
 * The first line worth showing as a preview.
 *
 * Skips the seeded header — a library where every row reads "# Channel: …"
 * tells you nothing about which document is which.
 */
export function previewOf(markdown: string): string {
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) continue;
    if (line.startsWith('**') && line.includes(':**')) continue;
    if (line === '---') continue;
    return line.replace(/^[>*-]\s*/, '').replace(/\*\*/g, '').slice(0, 140);
  }
  return 'Empty';
}

export async function readNote(videoId: string): Promise<NoteDoc | null> {
  const store = await readStore();
  const doc = store[videoId];
  return doc && typeof doc.markdown === 'string' ? doc : null;
}

export async function writeNote(videoId: string, markdown: string, title: string): Promise<void> {
  const store = await readStore();

  // An emptied document is a deleted one. Keeping a blank record would mean the
  // next visit "restores" nothing over the transcript the reader expected.
  if (markdown.trim() === '') delete store[videoId];
  else store[videoId] = { markdown, updatedAt: Date.now(), title };

  const ids = Object.keys(store);
  if (ids.length > MAX_DOCS) {
    const stale = ids
      .sort((a, b) => (store[a].updatedAt ?? 0) - (store[b].updatedAt ?? 0))
      .slice(0, ids.length - MAX_DOCS);
    for (const id of stale) delete store[id];
  }

  try {
    await chrome.storage.local.set({ [KEY]: store });
  } catch {
    /* a note that fails to save is not worth interrupting the typing for */
  }
}
