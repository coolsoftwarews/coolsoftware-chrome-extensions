/**
 * When each channel last uploaded.
 *
 * YouTube publishes a public Atom feed per channel:
 *
 *   https://www.youtube.com/feeds/videos.xml?channel_id=UC…
 *
 * No key, no OAuth, no quota — and, unlike everything else this extension
 * reads, it is a *documented format* rather than markup we scrape.
 *
 * It is also intermittently rate-limited: measured directly, a single channel
 * requested repeatedly returns roughly 50% failures (404, 500, or a throttle
 * response) with no pattern tying it to request volume — a lone request once a
 * second failed about as often as a burst of six at once, and the endpoint
 * recovers within seconds on its own. A batch of a few hundred channels with no
 * retry logic therefore loses most of them, which is why every refresh could
 * report "no upload feeds could be read". `fetchLatestUpload` retries on
 * exactly that basis — see below.
 *
 * The cost is one request per channel, times however many attempts a given one
 * needs. That is why this is a deliberate action rather than something that
 * happens on every panel open: a few hundred requests fired because someone
 * glanced at their groups would be rude to YouTube and slow for the user.
 */

export interface UploadInfo {
  /** ms epoch of the channel's most recent upload. */
  latestAt: number;
  title: string;
  videoId: string;
}

/**
 * One video, as the Atom feed describes it.
 *
 * The feed carries more than the newest date — title, publication time and the
 * view count at the time of reading — for roughly the last 15 uploads. Keeping
 * those is what makes a CSV export possible without a second round of
 * requests.
 */
export interface VideoEntry {
  channelId: string;
  videoId: string;
  title: string;
  publishedAt: number;
  /** Views at the moment the feed was read; null when absent. */
  views: number | null;
  /** Likes at that moment; null when the creator hides them. */
  likes: number | null;
}

/** Requests in flight at once. Enough to be quick, few enough to be polite. */
const CONCURRENCY = 6;

const FEED_URL = 'https://www.youtube.com/feeds/videos.xml?channel_id=';

/**
 * How many times to ask before giving up on one channel.
 *
 * At the measured ~50% per-attempt failure rate, four attempts clears a
 * channel roughly 94% of the time and five clears it roughly 97% — the
 * remaining failures are channels unlucky enough to fail four or five
 * independent coin flips in a row, not a sign the endpoint is actually down.
 */
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 500;

/**
 * How long to wait before the next attempt.
 *
 * Backs off (500ms, 1000ms, 2000ms, …) with up to 100% jitter added on top.
 * The jitter matters more than the backoff here: `CONCURRENCY` workers that
 * all failed on the same tick would otherwise retry on the same tick too,
 * which is a smaller version of the very burst that likely got them
 * rate-limited in the first place.
 */
export function retryDelay(attempt: number): number {
  const base = RETRY_BASE_MS * 2 ** (attempt - 1);
  return base + Math.random() * base;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether the last stretch of requests looks like the endpoint is down for
 * everyone right now, shared across every channel in one refresh.
 *
 * Per-channel retries only cover one channel's own bad half-second. They do
 * nothing for the endpoint being down for the whole refresh: every channel
 * still spins through its own attempts independently and arrives at the same
 * "no" a few seconds apart, which is how a refresh of 170-odd channels can
 * send hundreds of requests over half a minute to learn what the first ten
 * already showed. That happened — see the module comment above.
 *
 * This tracks failures across the *whole batch* instead of per channel. Once
 * enough land in a row with no success between them, further attempts are
 * skipped outright — no request sent, no wait — except one probe every
 * `CIRCUIT_COOLDOWN_MS`, so recovery is still noticed without going back to
 * hammering an endpoint that just said no.
 */
export interface Circuit {
  consecutiveFailures: number;
  /** ms epoch the circuit tripped, or null while it is closed. */
  openedAt: number | null;
  /** ms epoch of the last attempt let through, open or closed. */
  lastProbeAt: number;
}

export function newCircuit(): Circuit {
  return { consecutiveFailures: 0, openedAt: null, lastProbeAt: 0 };
}

/**
 * Two full rounds of every concurrent slot failing outright, with nothing
 * succeeding in between. Ordinary noise — the ~50% per-request failures this
 * file already retries around — essentially never produces a run this long;
 * reaching it is itself the signal that this is not that.
 */
const CIRCUIT_THRESHOLD = CONCURRENCY * 2;
const CIRCUIT_COOLDOWN_MS = 3000;

/**
 * Whether this attempt should be skipped without touching the network.
 *
 * Mutates the circuit when it lets a probe through, so the *next* caller sees
 * a fresh cooldown rather than every worker treating the same instant as its
 * own chance to probe.
 */
export function shouldSkip(circuit: Circuit, now: number): boolean {
  if (circuit.openedAt === null) return false;
  if (now - circuit.lastProbeAt < CIRCUIT_COOLDOWN_MS) return true;
  circuit.lastProbeAt = now;
  return false;
}

function recordSuccess(circuit: Circuit): void {
  circuit.consecutiveFailures = 0;
  circuit.openedAt = null;
}

function recordFailure(circuit: Circuit): void {
  circuit.consecutiveFailures++;
  if (circuit.consecutiveFailures >= CIRCUIT_THRESHOLD && circuit.openedAt === null) {
    circuit.openedAt = Date.now();
    circuit.lastProbeAt = circuit.openedAt;
  }
}

/**
 * Read one channel's latest upload.
 *
 * Never throws: one private, terminated, or persistently unreachable channel
 * must not fail a batch of hundreds. But it does *say why* it failed, because
 * "no new uploads anywhere" and "every request was blocked" look identical on
 * screen, and the difference is the whole bug report.
 *
 * @param circuit Shared across every call in one `fetchAllUploads` batch —
 * see `Circuit` above. Optional so this function still works read on its own.
 */
export async function fetchLatestUpload(
  channelId: string,
  circuit?: Circuit,
): Promise<{ feed: ParsedFeed | null; error?: string }> {
  let lastError = 'unknown error';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (circuit && shouldSkip(circuit, Date.now())) {
      return {
        feed: null,
        error: 'skipped — the upload feed looked unavailable for the whole batch',
      };
    }

    try {
      const res = await fetch(`${FEED_URL}${encodeURIComponent(channelId)}`, {
        credentials: 'omit',
      });
      if (res.ok) {
        const body = await res.text();
        const feed = parseFeed(body);
        if (feed) {
          if (circuit) recordSuccess(circuit);
          return { feed };
        }
        // A 200 that does not parse is not the rate limit — retrying the same
        // request would just parse the same body again, and it says nothing
        // about whether the endpoint is up, so it does not touch the circuit.
        return {
          feed: null,
          error: `unparseable feed (${body.length} bytes starting "${body.slice(0, 40)}")`,
        };
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = String(err);
    }

    if (circuit) recordFailure(circuit);
    if (attempt < MAX_ATTEMPTS) await sleep(retryDelay(attempt));
  }

  return { feed: null, error: `${lastError} (after ${MAX_ATTEMPTS} attempts)` };
}

interface ParsedFeed {
  latest: UploadInfo;
  /** Every video in the feed — roughly the channel's last 15 uploads. */
  entries: Array<Omit<VideoEntry, 'channelId'>>;
}

/** Atom, parsed as XML rather than by regex — it is a real format. */
function parseFeed(xml: string): ParsedFeed | null {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) return null;

  // Entries are newest-first in practice, but that is a habit of YouTube's
  // rather than a guarantee of Atom's, so take the maximum date instead.
  let best: UploadInfo | null = null;
  const entries: Array<Omit<VideoEntry, 'channelId'>> = [];

  for (const entry of doc.getElementsByTagName('entry')) {
    const videoId = text(entry, 'videoId') || text(entry, 'id').replace('yt:video:', '');
    const title = text(entry, 'title');
    const published = text(entry, 'published') || text(entry, 'updated');
    const at = published ? Date.parse(published) : NaN;

    if (videoId) {
      entries.push({
        videoId,
        title,
        publishedAt: Number.isFinite(at) ? at : 0,
        views: readViews(entry),
        likes: readLikes(entry),
      });
    }

    if (!Number.isFinite(at)) continue;
    if (best && at <= best.latestAt) continue;
    best = { latestAt: at, title, videoId };
  }

  return best ? { latest: best, entries } : null;
}

/** `<media:community><media:statistics views="1234"/>`, when YouTube sends it. */
function readViews(entry: Element): number | null {
  return numberAttribute(entry, ['statistics', 'media:statistics'], 'views');
}

/**
 * Likes, wearing a five-star rating's clothes.
 *
 * `<media:starRating count="2842" average="5.00" min="1" max="5"/>` is Media
 * RSS, a spec older than YouTube's current UI. Five-star ratings went away in
 * 2013, so `average` is 5.00 on every video ever and carries nothing — but
 * `count` is kept current, and it is the like count.
 *
 * Absent when the creator hides likes, which is why this is `null` rather than
 * 0: nobody liking a video and nobody being allowed to see the likes are very
 * different facts.
 */
function readLikes(entry: Element): number | null {
  return numberAttribute(entry, ['starRating', 'media:starRating'], 'count');
}

/** First matching tag, one numeric attribute, or null. */
function numberAttribute(entry: Element, tags: string[], attribute: string): number | null {
  for (const tag of tags) {
    const raw = entry.getElementsByTagName(tag)[0]?.getAttribute(attribute);
    if (raw === null || raw === undefined) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function text(scope: Element, tag: string): string {
  // `getElementsByTagName` rather than a selector: Atom is namespaced
  // (`yt:videoId`, `media:group`), and CSS selectors do not handle the colon.
  const found = scope.getElementsByTagName(tag)[0] ?? scope.getElementsByTagName(`yt:${tag}`)[0];
  return found?.textContent?.trim() ?? '';
}

export interface UploadProgress {
  done: number;
  total: number;
}

export interface UploadBatch {
  uploads: Record<string, UploadInfo>;
  /**
   * video id → channel id, for every video in every feed we read.
   *
   * This is what makes Shorts filterable: a Shorts tile links to
   * `/shorts/<videoId>` and names no channel anywhere in its markup, so the
   * page alone cannot say whose it is. The Atom feeds can.
   */
  videoOwners: Record<string, string>;
  /** Every video seen across every feed, newest first. */
  videos: VideoEntry[];
  /** The first failure, kept so a total wipeout can explain itself. */
  firstError?: string;
  failed: number;
}

/**
 * Read every channel's latest upload, `CONCURRENCY` at a time.
 *
 * Partial results are the norm and are returned as-is: a channel missing from
 * the result simply has no known upload date, which the UI shows as "unknown"
 * rather than as "nothing new".
 */
export async function fetchAllUploads(
  channelIds: string[],
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadBatch> {
  const uploads: Record<string, UploadInfo> = {};
  const videoOwners: Record<string, string> = {};
  const videos: VideoEntry[] = [];
  const queue = [...channelIds];
  const circuit = newCircuit();
  let done = 0;
  let failed = 0;
  let firstError: string | undefined;

  const worker = async (): Promise<void> => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;

      const { feed, error } = await fetchLatestUpload(id, circuit);
      if (feed) {
        uploads[id] = feed.latest;
        for (const entry of feed.entries) {
          videoOwners[entry.videoId] = id;
          videos.push({ ...entry, channelId: id });
        }
      } else {
        failed++;
        if (!firstError && error) firstError = `${id}: ${error}`;
      }
      done++;
      onProgress?.({ done, total: channelIds.length });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, channelIds.length) }, worker),
  );
  videos.sort((a, b) => b.publishedAt - a.publishedAt);
  return { uploads, videoOwners, videos, failed, firstError };
}
