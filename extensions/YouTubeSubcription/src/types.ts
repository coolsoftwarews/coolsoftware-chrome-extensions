/** A subscribed channel, as scraped from YouTube's own subscription list. */
export interface Channel {
  /** UC… channel ID. The only stable key — names and @handles both change. */
  id: string;
  name: string;
  /** @handle without the leading slash, when YouTube exposed one. */
  handle: string | null;
  avatarUrl: string | null;
  /** As YouTube rendered it, e.g. "9.2M subscribers". Null when absent. */
  subscriberText: string | null;
  /** Parsed from `subscriberText` for sorting. Null when unparseable. */
  subscriberCount: number | null;
  /** As YouTube rendered it, e.g. "1.2K videos". Null when absent. */
  videoText: string | null;
  videoCount: number | null;
}

export interface Group {
  id: string;
  name: string;
  /** Channel IDs. A channel may belong to several groups. */
  channelIds: string[];
  /** Sort position in the group bar. */
  order: number;
}

/** Everything the extension persists. One object, one storage key. */
export interface StoreShape {
  version: 1;
  groups: Group[];
  /** Cached subscription list, so the manager opens instantly. */
  channels: Channel[];
  /** ms epoch of the last successful subscription scrape; 0 = never. */
  channelsFetchedAt: number;
  /** Group id currently applied to the feed; null = show everything. */
  activeGroupId: string | null;
  /** Offer a group picker right after the user subscribes to a channel. */
  promptOnSubscribe: boolean;
  /**
   * Only show videos published within this many days; null shows everything.
   *
   * A second axis to the group filter: "my marketing channels" and "this week"
   * are different questions, and the feed is usually both.
   */
  feedPeriodDays: number | null;
  /**
   * Language of the "5 days ago" text the period filter reads. 'auto' takes it
   * from YouTube's own `<html lang>`, which is right almost always.
   */
  feedLanguage: 'auto' | string;
  /**
   * Which palette the panel wears. 'system' follows the browser's light/dark
   * setting; the rest are fixed looks defined entirely in CSS.
   */
  theme: string;
  /** Latest upload per channel id, from each channel's public Atom feed. */
  uploads: Record<string, UploadRecord>;
  /** ms epoch of the last upload check; 0 = never checked. */
  uploadsCheckedAt: number;
  /** video id → channel id, so Shorts can be attributed. See src/uploads.ts. */
  videoOwners: Record<string, string>;
  /**
   * Recent videos across all subscriptions, newest first — what the CSV export
   * draws on. Roughly the last 15 uploads per channel, as of the last check.
   */
  videos: VideoRow[];
  /**
   * channel id → ms epoch when the user last looked at that channel.
   *
   * Per channel, not per group: a dot means "this channel has posted something
   * you have not looked at", and glancing at a group is not looking at all of
   * its channels. Cleared by visiting the channel or watching one of its
   * videos, which is what YouTube's own dot does.
   */
  channelSeenAt: Record<string, number>;
}

/** What we keep about a channel's most recent upload. */
export interface UploadRecord {
  latestAt: number;
  title: string;
  videoId: string;
}

/** One row of the exportable video table. */
export interface VideoRow {
  channelId: string;
  videoId: string;
  title: string;
  publishedAt: number;
  views: number | null;
  /** Likes at the time of the last check; null when hidden by the creator. */
  likes: number | null;
}

/** Shape of the manual export/import file. Deliberately a superset of nothing. */
export interface ExportFile {
  format: 'youtube-subscription-groups';
  version: 1;
  exportedAt: string;
  groups: Array<{ name: string; channelIds: string[] }>;
  /** Names are exported for human readability and import-time repair only. */
  channelNames: Record<string, string>;
}
