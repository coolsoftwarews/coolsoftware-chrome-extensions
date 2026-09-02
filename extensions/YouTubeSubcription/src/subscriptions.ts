/**
 * Reading the user's subscription list without an account.
 *
 * PocketTube and friends ask for OAuth and hit the Data API. We don't: the
 * content script runs on youtube.com, so it can fetch /feed/channels with the
 * user's own session cookie and read the same `ytInitialData` blob the page
 * would have used. No token, no scope prompt, no third party ever sees the
 * list. The cost is that we depend on a page shape rather than an API
 * contract, which is why the parser below is written defensively.
 */

import { AccountIdentity, readAccount } from './account';
import { Channel } from './types';
import { extractInitialData } from './yt-data';

const CHANNELS_URL = 'https://www.youtube.com/feed/channels';

export class SubscriptionScrapeError extends Error {}

/**
 * The one failure the user can actually do something about, and the only one
 * worth taking over the panel for. A subtype rather than a flag so callers
 * that only care about "it failed" keep working unchanged.
 */
export class NotSignedInError extends SubscriptionScrapeError {}

export interface SubscriptionScrape {
  channels: Channel[];
  /**
   * Which account the page we just read belongs to, when it said so.
   *
   * Read out of the response rather than assumed from the request: asking for
   * `?authuser=1` is a request, not a guarantee, and filing one account's
   * subscriptions under another account's key is the exact loss that
   * per-account stores exist to prevent.
   */
  account: AccountIdentity | null;
}

/**
 * Read the subscription list of whichever account answers.
 *
 * There is deliberately no way to ask for a *particular* account here. Which
 * one you get is decided by the cookie context of the caller: from a content
 * script that is the channel the tab is using, which is the right answer, and
 * from an extension page it is the Google account's default channel, which
 * often is not. `?authuser=`, `X-Goog-AuthUser` and `X-Goog-PageId` were all
 * tried here and all ignored — a brand channel's page id included. So the
 * targeting lives in *where this runs* (see src/tab-scrape.ts), and the only
 * thing this owes the caller is an honest statement of who answered.
 */
export async function fetchSubscribedChannels(): Promise<SubscriptionScrape> {
  let html: string;
  try {
    // `redirect: 'manual'` so a signed-out browser is diagnosable. YouTube
    // answers a session-less request with a 302 to accounts.google.com, which
    // is deliberately not in host_permissions — following it fails CORS and
    // arrives here as an indistinguishable TypeError, which is how "you are
    // not signed in" used to be reported as "the network is down". Catching
    // the redirect instead lets us say the true thing.
    const res = await fetch(CHANNELS_URL, { credentials: 'include', redirect: 'manual' });
    if (res.type === 'opaqueredirect' || res.status === 0) {
      throw new NotSignedInError(
        'YouTube asked us to sign in. Sign in to YouTube in this browser, then press Refresh.',
      );
    }
    if (!res.ok) throw new SubscriptionScrapeError(`YouTube returned ${res.status}.`);
    html = await res.text();
  } catch (err) {
    if (err instanceof SubscriptionScrapeError) throw err;
    throw new SubscriptionScrapeError('Could not reach youtube.com.');
  }

  const data = extractInitialData(html);
  if (!data) {
    throw new SubscriptionScrapeError(
      'Could not read the subscription page. Make sure you are signed in to YouTube.',
    );
  }

  const channels = collectChannels(data);
  if (channels.length === 0) {
    throw new SubscriptionScrapeError(
      'No subscriptions found. If you do have subscriptions, sign in to YouTube and try again.',
    );
  }
  return { channels, account: readAccount(html) };
}

interface RawNode {
  [key: string]: unknown;
}

/**
 * Walk the response and pick up every channel entry, de-duplicated by ID.
 *
 * We don't navigate a fixed path — YouTube reshuffles the tab/section nesting
 * regularly, but the leaf renderer shape has been stable for years.
 */
function collectChannels(root: unknown): Channel[] {
  const byId = new Map<string, Channel>();
  const stack: unknown[] = [root];
  let guard = 0;

  while (stack.length > 0 && guard++ < 400_000) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;

    if (Array.isArray(node)) {
      for (const child of node) stack.push(child);
      continue;
    }

    const obj = node as RawNode;
    const renderer =
      (obj.channelRenderer as RawNode | undefined) ??
      (obj.gridChannelRenderer as RawNode | undefined);
    if (renderer) {
      const channel = readChannel(renderer);
      if (channel && !byId.has(channel.id)) byId.set(channel.id, channel);
    }

    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') stack.push(value);
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
}

function readChannel(renderer: RawNode): Channel | null {
  const id = typeof renderer.channelId === 'string' ? renderer.channelId : null;
  if (!id || !id.startsWith('UC')) return null;

  const name = readText(renderer.title) || readText(renderer.shortBylineText) || id;
  const stats = readStats(renderer);

  return {
    id,
    name,
    handle: stats.handle ?? readCanonicalHandle(renderer),
    avatarUrl: readAvatar(renderer.thumbnail),
    subscriberText: stats.subscriberText,
    subscriberCount: parseCompactNumber(stats.subscriberText),
    videoText: stats.videoText,
    videoCount: parseCompactNumber(stats.videoText),
  };
}

interface ChannelStats {
  handle: string | null;
  subscriberText: string | null;
  videoText: string | null;
}

/**
 * Sort the renderer's text fields by what they contain, not by their names.
 *
 * `subscriberCountText` currently holds the @handle and `videoCountText` holds
 * the subscriber count — YouTube has shuffled these before and will again.
 * Classifying on content survives the next shuffle; trusting the field names
 * does not.
 */
function readStats(renderer: RawNode): ChannelStats {
  const stats: ChannelStats = { handle: null, subscriberText: null, videoText: null };
  const candidates = [
    renderer.subscriberCountText,
    renderer.videoCountText,
    renderer.shortBylineText,
  ];

  for (const candidate of candidates) {
    const text = readText(candidate);
    if (!text) continue;
    if (!stats.handle && text.startsWith('@')) stats.handle = text;
    else if (!stats.subscriberText && /subscriber/i.test(text)) stats.subscriberText = text;
    else if (!stats.videoText && /video/i.test(text)) stats.videoText = text;
  }
  return stats;
}

/**
 * "9.2M subscribers" → 9200000. Returns null on anything we cannot read —
 * localised suffixes, "No videos", or a shape we have not seen — and the UI
 * then sorts those entries last rather than pretending they are zero.
 */
export function parseCompactNumber(text: string | null): number | null {
  if (!text) return null;
  // Must start at a digit: a leading-space match would otherwise read
  // "No videos" as zero.
  const match = /(\d[\d.\s\u00a0]*)\s*([KMB])?/i.exec(text.replace(/,/g, '.'));
  if (!match) return null;

  // Thousands separators vary by locale; keep the last dot group as decimals
  // only when it looks like one ("9.2M"), otherwise strip all separators.
  const digits = match[1].replace(/[\s\u00a0]/g, '');
  const value = /^\d+\.\d{1,2}$/.test(digits)
    ? Number(digits)
    : Number(digits.replace(/\./g, ''));
  if (!Number.isFinite(value)) return null;

  const scale = { k: 1e3, m: 1e6, b: 1e9 }[(match[2] ?? '').toLowerCase()] ?? 1;
  return Math.round(value * scale);
}

/** YouTube text is either `{simpleText}` or `{runs:[{text}]}`, never both. */
function readText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const node = value as RawNode;
  if (typeof node.simpleText === 'string') return node.simpleText.trim();
  if (Array.isArray(node.runs)) {
    return node.runs
      .map((r) => (r && typeof r === 'object' ? String((r as RawNode).text ?? '') : ''))
      .join('')
      .trim();
  }
  return '';
}

/** Fallback when no text field carried an @handle: read the browse endpoint. */
function readCanonicalHandle(renderer: RawNode): string | null {
  const nav = renderer.navigationEndpoint as RawNode | undefined;
  const browse = nav?.browseEndpoint as RawNode | undefined;
  const canonical = typeof browse?.canonicalBaseUrl === 'string' ? browse.canonicalBaseUrl : '';
  const match = /^\/(@[^/?#]+)/.exec(canonical);
  return match ? match[1] : null;
}

function readAvatar(thumbnail: unknown): string | null {
  if (!thumbnail || typeof thumbnail !== 'object') return null;
  const list = (thumbnail as RawNode).thumbnails;
  if (!Array.isArray(list) || list.length === 0) return null;
  const best = list[list.length - 1] as RawNode;
  const url = typeof best.url === 'string' ? best.url : null;
  if (!url) return null;
  return url.startsWith('//') ? `https:${url}` : url;
}
