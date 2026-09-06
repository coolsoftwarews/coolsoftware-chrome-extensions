/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6/§7), which puts two
 * obligations on this file: never lose a save, and always let the user take
 * their data out. Same shape as WebHighlighter's storage.ts — this product is
 * the "Saver" pattern from docs/extensions/README.md.
 */

import { defaultCollections } from './capture';
import { Backup, Collection, ImportResult, QuotaStatus, SavedPost } from './types';

const POST_PREFIX = 'irs:post:';
const COLLECTIONS_KEY = 'irs:collections';
const OPTIONS_KEY = 'irs:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function postKey(id: string): string {
  return POST_PREFIX + id;
}

export async function readAllPosts(): Promise<SavedPost[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(POST_PREFIX))
    .map(([, value]) => value as SavedPost)
    .filter(post => post && post.id && post.postUrl)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export async function readPost(id: string): Promise<SavedPost | null> {
  const key = postKey(id);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as SavedPost | undefined) ?? null;
}

export async function writePost(post: SavedPost): Promise<void> {
  await chrome.storage.local.set({ [postKey(post.id)]: post });
}

export async function deletePost(id: string): Promise<void> {
  await chrome.storage.local.remove(postKey(id));
}

/* ── Collections ─────────────────────────────────────────────────────── */

export async function readCollections(): Promise<Collection[]> {
  const stored = await chrome.storage.local.get(COLLECTIONS_KEY);
  const collections = stored?.[COLLECTIONS_KEY] as Collection[] | undefined;
  if (collections?.length) return collections;
  const seeded = defaultCollections();
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: seeded });
  return seeded;
}

export async function writeCollections(collections: Collection[]): Promise<void> {
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: collections });
}

export async function addCollection(name: string): Promise<Collection> {
  const collections = await readCollections();
  const collection: Collection = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Untitled',
    createdAt: Date.now(),
  };
  await writeCollections([...collections, collection]);
  return collection;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const collections = await readCollections();
  const trimmed = name.trim();
  if (!trimmed) return;
  await writeCollections(collections.map(c => (c.id === id ? { ...c, name: trimmed } : c)));
}

/* ── Saving ──────────────────────────────────────────────────────────── */

/**
 * Persists a capture card. `build` receives the existing card (if this post
 * was saved before) so the caller can merge rather than duplicate — see
 * capture.ts#buildCapture. Storage failures are never swallowed: PRD §8 is
 * explicit that a quota failure must fail loudly with an export prompt, never
 * drop the item silently.
 */
export async function savePost(id: string, build: (existing: SavedPost | null) => SavedPost): Promise<SavedPost> {
  const existing = await readPost(id);
  const post = build(existing);
  try {
    await writePost(post);
  } catch {
    throw new Error('Storage is full. Export your library, then remove a few posts to free up room, and try again.');
  }
  return post;
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(POST_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: defaultCollections() });
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

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'instagram-research-saver',
    version: 1,
    exportedAt: new Date().toISOString(),
    posts: await readAllPosts(),
    collections: await readCollections(),
  };
}

/**
 * Merges a backup into local storage. Posts are matched by id (the post's
 * shortcode) and collections by id, so importing the same file twice never
 * duplicates a card — the incoming file wins on conflicts, same rule
 * WebHighlighter's importBackup uses for highlights.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'instagram-research-saver' || !Array.isArray(backup.posts)) {
    throw new Error('That file is not an Instagram Research Saver backup.');
  }

  const existingCollections = await readCollections();
  const byId = new Map<string, Collection>(existingCollections.map(c => [c.id, c]));
  let collectionsAdded = 0;
  for (const incoming of backup.collections ?? []) {
    if (!incoming?.id || !incoming.name) continue;
    if (!byId.has(incoming.id)) collectionsAdded++;
    byId.set(incoming.id, incoming);
  }
  await writeCollections([...byId.values()]);

  let postsImported = 0;
  for (const incoming of backup.posts) {
    if (!incoming?.id || !incoming.postUrl) continue;
    await writePost(incoming);
    postsImported++;
  }

  return { posts: postsImported, collections: collectionsAdded };
}

/* ── Export options ──────────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
