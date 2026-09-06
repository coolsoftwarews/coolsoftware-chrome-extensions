/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §6). Two record families:
 * watched people and the posts collected for them.
 */

import { CollectedPost, WatchedPerson } from './types';

const PERSON_PREFIX = 'lcw:person:';
const POST_PREFIX = 'lcw:post:';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

const personKey = (id: string) => PERSON_PREFIX + id;
const postKey = (id: string) => POST_PREFIX + id;

/* ── People ──────────────────────────────────────────────────────────── */

export async function listPeople(): Promise<WatchedPerson[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(PERSON_PREFIX))
    .map(([, value]) => value as WatchedPerson)
    .filter(person => person && typeof person.id === 'string')
    .sort((a, b) => b.watchedAt - a.watchedAt);
}

export async function getPerson(id: string): Promise<WatchedPerson | null> {
  const stored = await chrome.storage.local.get(personKey(id));
  return (stored?.[personKey(id)] as WatchedPerson | undefined) ?? null;
}

export async function isWatched(id: string): Promise<boolean> {
  return (await getPerson(id)) !== null;
}

export async function watchPerson(person: Omit<WatchedPerson, 'note' | 'watchedAt'>): Promise<WatchedPerson> {
  const existing = await getPerson(person.id);
  const record: WatchedPerson = {
    ...person,
    note: existing?.note ?? '',
    watchedAt: existing?.watchedAt ?? Date.now(),
  };
  await chrome.storage.local.set({ [personKey(person.id)]: record });
  return record;
}

/** Removes a person and every post collected for them — nothing orphaned left behind. */
export async function unwatchPerson(id: string): Promise<void> {
  const posts = await listPostsForPerson(id);
  const keys = [personKey(id), ...posts.map(post => postKey(post.id))];
  await chrome.storage.local.remove(keys);
}

export async function setPersonNote(id: string, note: string): Promise<void> {
  const person = await getPerson(id);
  if (!person) return;
  await chrome.storage.local.set({ [personKey(id)]: { ...person, note } });
}

/* ── Posts ───────────────────────────────────────────────────────────── */

export async function listPosts(): Promise<CollectedPost[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(POST_PREFIX))
    .map(([, value]) => value as CollectedPost)
    .filter(post => post && typeof post.id === 'string');
}

export async function listPostsForPerson(personId: string): Promise<CollectedPost[]> {
  return (await listPosts()).filter(post => post.personId === personId);
}

export async function getPost(id: string): Promise<CollectedPost | null> {
  const stored = await chrome.storage.local.get(postKey(id));
  return (stored?.[postKey(id)] as CollectedPost | undefined) ?? null;
}

/**
 * Insert-or-merge a freshly captured sighting of a post. Counts only ever go
 * up within a merge — "keep the highest, record when" (PRD §7) — because a
 * lower count on a later sighting is a rendering glitch, not a real drop.
 */
export async function upsertPost(sighting: CollectedPost): Promise<CollectedPost> {
  const existing = await getPost(sighting.id);
  if (!existing) {
    await chrome.storage.local.set({ [postKey(sighting.id)]: sighting });
    return sighting;
  }

  const countsImproved =
    sighting.reactions > existing.reactions ||
    sighting.comments > existing.comments ||
    sighting.reposts > existing.reposts;

  const merged: CollectedPost = {
    ...existing,
    reactions: Math.max(existing.reactions, sighting.reactions),
    comments: Math.max(existing.comments, sighting.comments),
    reposts: Math.max(existing.reposts, sighting.reposts),
    countsUpdatedAt: countsImproved ? sighting.firstSeenAt : existing.countsUpdatedAt,
    // A blank preview on a later sighting (e.g. "see more" collapsed) should
    // never overwrite text we already captured.
    text: existing.text || sighting.text,
    postType: existing.postType === 'other' ? sighting.postType : existing.postType,
    postedAt: existing.postedAt ?? sighting.postedAt,
    postedAtLabel: existing.postedAtLabel || sighting.postedAtLabel,
    url: existing.url || sighting.url,
    seenAsRepost: existing.seenAsRepost || sighting.seenAsRepost,
  };

  await chrome.storage.local.set({ [postKey(sighting.id)]: merged });
  return merged;
}

export async function setPostNote(id: string, note: string): Promise<void> {
  const post = await getPost(id);
  if (!post) return;
  await chrome.storage.local.set({ [postKey(id)]: { ...post, note } });
}

export async function removePost(id: string): Promise<void> {
  await chrome.storage.local.remove(postKey(id));
}

/* ── Whole-library operations ───────────────────────────────────────── */

export interface Backup {
  format: 'linkedin-creator-watchlist';
  version: 1;
  exportedAt: string;
  people: WatchedPerson[];
  posts: CollectedPost[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'linkedin-creator-watchlist',
    version: 1,
    exportedAt: new Date().toISOString(),
    people: await listPeople(),
    posts: await listPosts(),
  };
}

export interface ImportResult {
  people: number;
  posts: number;
}

/**
 * Merges a backup into local storage. People are matched by id, posts by id;
 * importing the same file twice must not double anything or lose a note.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'linkedin-creator-watchlist' || !Array.isArray(backup.people) || !Array.isArray(backup.posts)) {
    throw new Error('That file is not a LinkedIn Creator Watchlist backup.');
  }

  let people = 0;
  let posts = 0;
  const writes: Record<string, unknown> = {};

  for (const person of backup.people) {
    if (!person?.id || typeof person.name !== 'string') continue;
    const existing = await getPerson(person.id);
    writes[personKey(person.id)] = existing
      ? { ...existing, ...person, note: person.note || existing.note }
      : person;
    people++;
  }

  for (const post of backup.posts) {
    if (!post?.id || !post.personId) continue;
    const existing = await getPost(post.id);
    writes[postKey(post.id)] = existing
      ? {
          ...existing,
          reactions: Math.max(existing.reactions, post.reactions ?? 0),
          comments: Math.max(existing.comments, post.comments ?? 0),
          reposts: Math.max(existing.reposts, post.reposts ?? 0),
          note: post.note || existing.note,
        }
      : post;
    posts++;
  }

  await chrome.storage.local.set(writes);
  return { people, posts };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(PERSON_PREFIX) || key.startsWith(POST_PREFIX));
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

const OPTIONS_KEY = 'lcw:options';

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
