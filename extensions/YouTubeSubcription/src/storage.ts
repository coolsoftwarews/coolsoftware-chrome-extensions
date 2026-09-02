/**
 * The single source of truth for persisted state.
 *
 * Everything for one YouTube account lives under one `chrome.storage.local`
 * key. That costs a full rewrite on every mutation, but the payload is small
 * (a few hundred channel IDs) and it buys atomic reads — no half-applied group
 * edits, and one `onChanged` event per mutation for every surface to react to.
 *
 * `chrome.storage` is per browser profile, and one browser profile can be
 * signed in to several YouTube accounts at once. So the key is per account,
 * and which account is current is itself stored state.
 */

import { Channel, ExportFile, Group, StoreShape, UploadRecord, VideoRow } from './types';

export const EMPTY_STORE: StoreShape = {
  version: 1,
  groups: [],
  channels: [],
  channelsFetchedAt: 0,
  activeGroupId: null,
  promptOnSubscribe: true,
  feedPeriodDays: null,
  feedLanguage: 'auto',
  theme: 'system',
  uploads: {},
  uploadsCheckedAt: 0,
  videoOwners: {},
  videos: [],
  channelSeenAt: {},
};

/**
 * Where a store lives.
 *
 * `ysg` was the only key until accounts existed; it is still read, once, so an
 * upgrade keeps the groups it already had. Everything after that is
 * `ysg:store:<account>` — see src/account.ts for why a browser profile is not
 * an account.
 */
const LEGACY_KEY = 'ysg';
const STORE_PREFIX = 'ysg:store:';
/** Which account every context should be reading. */
const ACCOUNT_KEY = 'ysg:account';

export interface ActiveAccount {
  id: string;
  sessionIndex: string | null;
  pageId: string | null;
}

/**
 * The active account, cached per JavaScript context.
 *
 * `undefined` means "not yet read from storage"; `null` means "read, and there
 * is no account" — the pre-account store. Kept fresh by the listener below
 * rather than re-read on every access, because every store read would
 * otherwise pay two storage round trips instead of one.
 */
let activeAccount: ActiveAccount | null | undefined;

/** Registered at module load, so it runs before any `onStoreChanged`. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[ACCOUNT_KEY]) return;
  activeAccount = readAccountRecord(changes[ACCOUNT_KEY].newValue);
});

function readAccountRecord(value: unknown): ActiveAccount | null {
  const record = value as Partial<ActiveAccount> | undefined;
  if (!record || typeof record.id !== 'string' || !record.id) return null;
  return {
    id: record.id,
    sessionIndex: typeof record.sessionIndex === 'string' ? record.sessionIndex : null,
    pageId: typeof record.pageId === 'string' ? record.pageId : null,
  };
}

function keyFor(account: ActiveAccount | null): string {
  return account ? `${STORE_PREFIX}${account.id}` : LEGACY_KEY;
}

export async function getActiveAccount(): Promise<ActiveAccount | null> {
  if (activeAccount === undefined) {
    const raw = await chrome.storage.local.get(ACCOUNT_KEY);
    // A concurrent `onChanged` may have filled it in while we waited. That is
    // the fresher of the two answers, so it wins.
    if (activeAccount === undefined) activeAccount = readAccountRecord(raw[ACCOUNT_KEY]);
  }
  return activeAccount;
}

// Resolved eagerly so `onStoreChanged` knows which key to watch before the
// first read happens — otherwise a change arriving in that window is dropped.
void getActiveAccount();

/**
 * Point every context at this account's store.
 *
 * The first account to identify itself adopts the pre-account store, so a user
 * who has been grouping channels for months keeps them; every account after
 * that starts empty, which is the whole point — B's subscription list must not
 * be allowed to prune A's groups.
 *
 * Queued alongside the store writes so a mutation can never straddle the
 * switch: an `updateStore` that read A's store must not write it back under
 * B's key.
 */
export function setActiveAccount(account: ActiveAccount): Promise<void> {
  const run = writeQueue.then(async () => {
    if (!account.id) return;

    const key = `${STORE_PREFIX}${account.id}`;
    const raw = await chrome.storage.local.get([ACCOUNT_KEY, key, LEGACY_KEY]);
    const previous = readAccountRecord(raw[ACCOUNT_KEY]);

    // Same account, same store. How to *address* it can still have changed —
    // adding another account shifts `authuser` — so keep that fresh.
    if (
      previous?.id === account.id &&
      previous.sessionIndex === account.sessionIndex &&
      previous.pageId === account.pageId
    ) {
      activeAccount = previous;
      return;
    }

    const patch: Record<string, unknown> = { [ACCOUNT_KEY]: account };
    const adoptLegacy = !previous && !raw[key] && Boolean(raw[LEGACY_KEY]);
    if (adoptLegacy) patch[key] = raw[LEGACY_KEY];

    activeAccount = account;
    await chrome.storage.local.set(patch);
    // Only once the copy has landed. `videos` alone can be megabytes, and a
    // second copy would spend the user's quota on a rollback nobody can reach.
    if (adoptLegacy) await chrome.storage.local.remove(LEGACY_KEY);
  });
  writeQueue = run.catch(() => undefined);
  return run;
}

/** Fill in whatever a stored payload is missing, old or truncated. */
function hydrate(stored: Partial<StoreShape> | undefined): StoreShape {
  if (!stored) return { ...EMPTY_STORE };
  return {
    ...EMPTY_STORE,
    ...stored,
    groups: Array.isArray(stored.groups) ? stored.groups : [],
    channels: Array.isArray(stored.channels) ? stored.channels : [],
    uploads: stored.uploads ?? {},
    videoOwners: stored.videoOwners ?? {},
    videos: stored.videos ?? [],
    channelSeenAt: stored.channelSeenAt ?? {},
  };
}

async function readStoreAt(key: string): Promise<StoreShape> {
  const raw = await chrome.storage.local.get(key);
  return hydrate(raw[key] as Partial<StoreShape> | undefined);
}

export async function readStore(): Promise<StoreShape> {
  return readStoreAt(keyFor(await getActiveAccount()));
}

export async function writeStore(store: StoreShape): Promise<void> {
  await chrome.storage.local.set({ [keyFor(await getActiveAccount())]: store });
}

/**
 * Serialises mutations within this JavaScript context.
 *
 * Read → mutate → write is not atomic, and two of these interleaving lose a
 * write silently: tick a second group before the first tick's write lands and
 * the second read still sees the old value. Ticking checkboxes quickly in the
 * manager does exactly that. Queueing makes each mutation see the previous
 * one's result.
 *
 * This does **not** make writes safe across contexts — the side panel and an
 * options page in another tab are separate JavaScript worlds, and
 * `chrome.storage` offers no compare-and-swap to build on. That race stays
 * open, and is far rarer: it needs two managers open at once.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

/** Read → mutate → write. Callers get the post-mutation store back. */
export function updateStore(
  mutate: (store: StoreShape) => void,
): Promise<StoreShape> {
  const run = writeQueue.then(async () => {
    // Resolve the key once and use it for both halves. An account switch
    // landing between the read and the write would file one account's store
    // under the other's key — the exact loss this file is arranged to prevent.
    const key = keyFor(await getActiveAccount());
    const store = await readStoreAt(key);
    mutate(store);
    await chrome.storage.local.set({ [key]: store });
    return store;
  });
  // Keep the chain alive even if this mutation throws, or one failure would
  // wedge every subsequent write.
  writeQueue = run.catch(() => undefined);
  return run;
}

/**
 * Fires whenever the store this context is reading changes, in any context —
 * including when that becomes a *different* store because the account changed.
 */
export function onStoreChanged(cb: (store: StoreShape) => void): () => void {
  const listener = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area !== 'local') return;
    // The account switched: the payload we want is under a key that did not
    // change, so re-read rather than reaching into `changes`.
    if (changes[ACCOUNT_KEY]) {
      void readStore().then(cb);
      return;
    }
    const key = keyFor(activeAccount ?? null);
    if (!changes[key]) return;
    cb(hydrate(changes[key].newValue as Partial<StoreShape> | undefined));
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}

/* ── Groups ──────────────────────────────────────────────────────────── */

function newId(): string {
  return `g_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createGroup(name: string): Promise<Group> {
  let created!: Group;
  await updateStore((s) => {
    created = {
      id: newId(),
      name: name.trim() || 'Untitled group',
      channelIds: [],
      order: s.groups.length,
    };
    s.groups.push(created);
  });
  return created;
}

export async function renameGroup(id: string, name: string): Promise<void> {
  await updateStore((s) => {
    const g = s.groups.find((x) => x.id === id);
    if (g) g.name = name.trim() || g.name;
  });
}

export async function deleteGroup(id: string): Promise<void> {
  await updateStore((s) => {
    s.groups = s.groups.filter((g) => g.id !== id);
    s.groups.forEach((g, i) => (g.order = i));
    if (s.activeGroupId === id) s.activeGroupId = null;
  });
}

/**
 * Put a deleted group back exactly as it was — the other half of "delete now,
 * undo if that was wrong", which is what lets deletion skip a confirmation
 * step. Restores the original id, so nothing that referenced it is orphaned.
 */
export async function restoreGroup(group: Group): Promise<void> {
  await updateStore((s) => {
    if (s.groups.some((g) => g.id === group.id)) return;
    s.groups.push({ ...group, channelIds: [...group.channelIds] });
    s.groups.sort((a, b) => a.order - b.order);
    s.groups.forEach((g, i) => (g.order = i));
  });
}

export async function setChannelInGroup(
  groupId: string,
  channelId: string,
  member: boolean,
): Promise<void> {
  await updateStore((s) => {
    const g = s.groups.find((x) => x.id === groupId);
    if (!g) return;
    const has = g.channelIds.includes(channelId);
    if (member && !has) g.channelIds.push(channelId);
    if (!member && has) g.channelIds = g.channelIds.filter((c) => c !== channelId);
  });
}

export async function setActiveGroup(id: string | null): Promise<void> {
  await updateStore((s) => {
    // A group with no channels would hide the entire feed. Refused here as well
    // as in the UI, because a group can *become* empty — remove its last
    // channel while it is applied and the feed would go blank with no
    // explanation.
    const group = id ? s.groups.find((g) => g.id === id) : null;
    s.activeGroupId = group && group.channelIds.length > 0 ? group.id : null;
  });
}

export async function reorderGroups(orderedIds: string[]): Promise<void> {
  await updateStore((s) => {
    const rank = new Map(orderedIds.map((id, i) => [id, i]));
    s.groups.sort((a, b) => (rank.get(a.id) ?? 1e6) - (rank.get(b.id) ?? 1e6));
    s.groups.forEach((g, i) => (g.order = i));
  });
}

export async function setPromptOnSubscribe(enabled: boolean): Promise<void> {
  await updateStore((s) => {
    s.promptOnSubscribe = enabled;
  });
}

/**
 * Record that the user has looked at this channel — its dot goes out.
 *
 * Called when they open the channel or watch one of its videos. An earlier
 * version marked a whole *group* as seen the moment it was shown, which meant
 * the dots cleared before anyone could see them: you open a group precisely to
 * find out what is new, and that act erased the answer.
 */
export async function markChannelSeen(channelId: string): Promise<void> {
  await updateStore((s) => {
    s.channelSeenAt[channelId] = Date.now();
  });
}

/**
 * Store the results of an upload check, keeping any channel it did not cover.
 *
 * `videoOwners` is *replaced*, not merged: it exists to attribute the Shorts
 * currently in the feed, and merging would grow it without bound across every
 * check the extension ever runs.
 */
/**
 * How many video rows to keep.
 *
 * ~15 uploads × a few hundred channels, with room to spare. `chrome.storage`
 * is not a database and this is not an archive — it is the last slice of feed
 * the user can export, and it is replaced wholesale on every check.
 */
const MAX_VIDEO_ROWS = 5000;

export async function saveUploads(
  uploads: Record<string, UploadRecord>,
  videoOwners: Record<string, string>,
  videos: VideoRow[] = [],
): Promise<void> {
  await updateStore((s) => {
    const firstCheck = s.uploadsCheckedAt === 0;

    s.uploads = { ...s.uploads, ...uploads };
    s.videoOwners = videoOwners;
    if (videos.length > 0) s.videos = videos.slice(0, MAX_VIDEO_ROWS);
    s.uploadsCheckedAt = Date.now();

    // On the first check, treat everything as already seen. Otherwise every
    // channel would arrive dotted, which says nothing: "new" has to mean new
    // since you started using this, not "exists".
    if (!firstCheck) return;
    for (const [channelId, upload] of Object.entries(uploads)) {
      s.channelSeenAt[channelId] ??= upload.latestAt;
    }
  });
}

export async function setFeedPeriod(days: number | null): Promise<void> {
  await updateStore((s) => {
    s.feedPeriodDays = days;
  });
}

export async function setTheme(theme: string): Promise<void> {
  await updateStore((s) => {
    s.theme = theme;
  });
}

export async function setFeedLanguage(language: string): Promise<void> {
  await updateStore((s) => {
    s.feedLanguage = language;
  });
}

/* ── Channel list + orphan cleanup ───────────────────────────────────── */

/**
 * Replace the cached subscription list.
 *
 * Channels the user unsubscribed from are dropped from every group in the same
 * write, so groups never accumulate dead IDs. Only run this with a list we
 * actually scraped successfully — an empty list here would wipe every group.
 *
 * @param prune Whether to do that dropping. Pass false when the caller could
 * not confirm the list and this store belong to the same YouTube account:
 * pruning A's groups against B's subscriptions empties them, and nothing gets
 * them back. A stale ID in a group is a blemish; this is data loss, so the two
 * are not weighed equally.
 */
export async function saveChannels(
  channels: Channel[],
  prune = true,
): Promise<StoreShape> {
  return updateStore((s) => {
    if (channels.length === 0) return;
    s.channels = channels;
    s.channelsFetchedAt = Date.now();
    if (!prune) return;
    const live = new Set(channels.map((c) => c.id));
    for (const g of s.groups) {
      g.channelIds = g.channelIds.filter((id) => live.has(id));
    }
  });
}

/**
 * Add or refresh a single channel in the cache.
 *
 * Used when the user subscribes to something mid-session: we learn about the
 * channel from the page DOM long before the next full scrape, and the picker
 * needs it present to be assignable. Existing fields are kept when the new
 * record has nothing better — the DOM knows the name and avatar but never the
 * subscriber counts.
 */
export async function upsertChannel(channel: Channel): Promise<void> {
  await updateStore((s) => {
    const at = s.channels.findIndex((c) => c.id === channel.id);
    if (at === -1) {
      s.channels.push(channel);
      s.channels.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      );
      return;
    }
    const prev = s.channels[at];
    s.channels[at] = {
      ...prev,
      name: channel.name || prev.name,
      handle: channel.handle ?? prev.handle,
      avatarUrl: channel.avatarUrl ?? prev.avatarUrl,
    };
  });
}

/* ── Export / import ─────────────────────────────────────────────────── */

export function buildExport(store: StoreShape): ExportFile {
  const names: Record<string, string> = {};
  for (const c of store.channels) names[c.id] = c.name;
  return {
    format: 'youtube-subscription-groups',
    version: 1,
    exportedAt: new Date().toISOString(),
    groups: store.groups.map((g) => ({ name: g.name, channelIds: [...g.channelIds] })),
    channelNames: names,
  };
}

export interface ImportResult {
  groupsAdded: number;
  channelsSkipped: number;
}

/**
 * Merge an export file into the current store.
 *
 * Merge, not replace: a group name that already exists gains the imported
 * channels rather than being overwritten, so importing twice is harmless.
 * Channel IDs not present in the current subscription list are dropped — they
 * would be invisible orphans otherwise. If we have never scraped the list, we
 * keep everything and let the next scrape do the cleanup.
 */
export async function importGroups(parsed: unknown): Promise<ImportResult> {
  const file = parsed as Partial<ExportFile>;
  if (!file || file.format !== 'youtube-subscription-groups' || !Array.isArray(file.groups)) {
    throw new Error('Not a Subs & Stats export file.');
  }

  let groupsAdded = 0;
  let channelsSkipped = 0;

  await updateStore((s) => {
    const known = s.channels.length > 0 ? new Set(s.channels.map((c) => c.id)) : null;

    for (const incoming of file.groups!) {
      const name = String(incoming?.name ?? '').trim();
      if (!name) continue;
      const ids = (Array.isArray(incoming.channelIds) ? incoming.channelIds : [])
        .filter((id): id is string => typeof id === 'string' && id.startsWith('UC'))
        .filter((id) => {
          if (!known || known.has(id)) return true;
          channelsSkipped++;
          return false;
        });

      let target = s.groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (!target) {
        target = { id: newId(), name, channelIds: [], order: s.groups.length };
        s.groups.push(target);
        groupsAdded++;
      }
      const set = new Set(target.channelIds);
      for (const id of ids) set.add(id);
      target.channelIds = [...set];
    }
  });

  return { groupsAdded, channelsSkipped };
}
