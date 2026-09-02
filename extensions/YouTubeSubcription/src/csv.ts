/**
 * The video export.
 *
 * Everything here comes from data already on the device — the Atom feeds read
 * during an upload check — so an export costs no requests and works offline.
 * The window and limit are applied to that slice, not to YouTube: the honest
 * ceiling is roughly the last 15 uploads per channel as of the last Refresh,
 * and the UI says so rather than pretending "last 7 days" is exhaustive.
 */

import { Channel, Group, VideoRow } from './types';
import { SearchField, makeMatcher, matchesVideo } from './search';

export interface ExportScope {
  /** Restrict to one group's channels; null for every subscription. */
  groupId: string | null;
  /** Restrict to a single channel; null for all of them. */
  channelId?: string | null;
  /** Only videos published within this many days; null for no window. */
  days: number | null;
  /** Hard cap on rows, applied after the window; null for no cap. */
  limit: number | null;
  /** Which fields the query is matched against. */
  fields?: SearchField[];
  /**
   * Free-text match on the chosen fields; '' for no filter.
   *
   * Here because the export shares its filter row with the charts. A search box
   * that narrowed the picture but not the file it exports would be a quiet lie
   * about what "these videos" means.
   */
  query?: string;
}

export interface ExportInput {
  videos: VideoRow[];
  channels: Channel[];
  groups: Group[];
  scope: ExportScope;
}

const COLUMNS = [
  'published_at',
  'channel',
  'channel_id',
  'handle',
  'title',
  'video_id',
  'url',
  'views',
  'likes',
  'engagement',
  'groups',
  'is_new',
] as const;

/**
 * Build the CSV text.
 *
 * Sorted newest-first, because every question anyone asks of this file — what
 * has this group been posting, who has gone quiet — is a recency question.
 */
export function buildVideoCsv(input: ExportInput): { csv: string; rows: number } {
  const { videos, channels, groups, scope } = input;

  const byId = new Map(channels.map((c) => [c.id, c]));
  const groupsByChannel = new Map<string, string[]>();
  for (const group of groups) {
    for (const id of group.channelIds) {
      const list = groupsByChannel.get(id);
      if (list) list.push(group.name);
      else groupsByChannel.set(id, [group.name]);
    }
  }

  const wanted = scope.groupId
    ? new Set(groups.find((g) => g.id === scope.groupId)?.channelIds ?? [])
    : null;
  const cutoff = scope.days === null ? 0 : Date.now() - scope.days * 24 * 60 * 60 * 1000;
  /*
   * Scheduled premieres carry a future date, so they satisfy any "recent
   * enough" test. They are not uploads yet, and counting them here would put
   * the export and the panel's tallies out of step with the charts, which
   * exclude them for the same reason.
   */
  const now = Date.now();

  const matcher = makeMatcher(scope.query ?? '');

  let rows = videos
    .filter((v) => (wanted ? wanted.has(v.channelId) : true))
    .filter((v) => (scope.channelId ? v.channelId === scope.channelId : true))
    .filter((v) => v.publishedAt >= cutoff && v.publishedAt <= now)
    .filter((v) => {
      const channel = byId.get(v.channelId);
      return matchesVideo(
        matcher,
        {
          title: v.title,
          channel: channel?.name ?? '',
          handle: channel?.handle ?? '',
          groups: groupsByChannel.get(v.channelId) ?? [],
        },
        scope.fields,
      );
    })
    .sort((a, b) => b.publishedAt - a.publishedAt);

  if (scope.limit !== null) rows = rows.slice(0, scope.limit);

  const lines = [COLUMNS.join(',')];
  for (const video of rows) {
    const channel = byId.get(video.channelId);
    lines.push(
      [
        video.publishedAt ? new Date(video.publishedAt).toISOString() : '',
        channel?.name ?? '',
        video.channelId,
        channel?.handle ?? '',
        video.title,
        video.videoId,
        `https://www.youtube.com/watch?v=${video.videoId}`,
        video.views ?? '',
        video.likes ?? '',
        // Likes per view, to four places. Blank rather than zero when either
        // number is missing — a hidden like count is not an unpopular video.
        video.likes !== null && video.views ? (video.likes / video.views).toFixed(4) : '',
        (groupsByChannel.get(video.channelId) ?? []).join('; '),
      ]
        .map(cell)
        .join(','),
    );
  }

  // A trailing newline: POSIX tools expect one, and spreadsheets do not mind.
  return { csv: `${lines.join('\n')}\n`, rows: rows.length };
}

/**
 * Quote a value for CSV.
 *
 * Titles are the reason this is not a `join(',')`: they contain commas, quotes
 * and the occasional newline, and a spreadsheet given an unquoted one silently
 * shifts every following column.
 */
function cell(value: string | number): string {
  const text = String(value ?? '');
  if (!/[",\n\r]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * How to say a period out loud.
 *
 * Shared between the panel, the charts and the file name so they cannot
 * disagree — and so sub-day windows read as hours. "Last 1 days" is the kind of
 * wording that makes software feel unfinished.
 */
export function periodLabel(days: number | null, limit: number | null): string {
  if (days !== null) {
    if (days === 1) return 'last 24 hours';
    if (days === 2) return 'last 48 hours';
    return `last ${days} days`;
  }
  if (limit !== null) return `latest ${limit.toLocaleString()}`;
  return 'everything held';
}

/** The same period as a filename fragment: `24h`, `7d`, `top100`, `full`. */
export function periodSlug(days: number | null, limit: number | null): string {
  if (days === 1) return '24h';
  if (days === 2) return '48h';
  if (days !== null) return `${days}d`;
  if (limit !== null) return `top${limit}`;
  return 'full';
}

/** A filename that sorts chronologically and says what it holds. */
export function csvFilename(scope: ExportScope, groupName?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const who = groupName ? groupName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'all';
  return `youtube-${who}-${periodSlug(scope.days, scope.limit)}-${date}.csv`;
}
