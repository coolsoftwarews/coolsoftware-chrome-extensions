/**
 * Best-effort extraction from the JSON Instagram embeds alongside the grid
 * (PRD §5) — the hydration payloads Instagram ships in <script> tags so React
 * doesn't have to refetch what it already rendered. Reading it is what makes
 * dates and view counts available at all, since the visible grid tile itself
 * rarely shows a date and often hides its counts until hover.
 *
 * Deliberately not a JSON.parse of the whole bundle: it's minified app code,
 * not a clean data island, and a shape change anywhere in it would break a
 * strict parse. Instead this scans for the shortcode keys goo grid items
 * always carry and reads the handful of fields near each one with regex. A
 * miss degrades one post's numbers to "unknown" — it never throws, and it
 * never takes the rest of the grid down with it (PRD §6 failure mode).
 */

import { PostKind } from './types';

export interface JsonSignal {
  views: number | null;
  likes: number | null;
  comments: number | null;
  takenAt: number | null;
  kind: PostKind | null;
  pinned: boolean | null;
}

const EMPTY_SIGNAL: JsonSignal = { views: null, likes: null, comments: null, takenAt: null, kind: null, pinned: null };

/** Characters scanned either side of a shortcode match for its sibling fields. */
const WINDOW = 900;

const SHORTCODE_RE = /"(?:shortcode|code)":"([A-Za-z0-9_-]{5,})"/g;

function firstNumber(window: string, patterns: RegExp[]): number | null {
  for (const pattern of patterns) {
    const match = window.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) return value;
    }
  }
  return null;
}

function readSignal(window: string): JsonSignal {
  const views = firstNumber(window, [
    /"video_view_count":(\d+)/,
    /"video_play_count":(\d+)/,
    /"play_count":(\d+)/,
    /"ig_play_count":(\d+)/,
  ]);

  const likes = firstNumber(window, [
    /"edge_media_preview_like":\{"count":(\d+)\}/,
    /"edge_liked_by":\{"count":(\d+)\}/,
    /"like_count":(\d+)/,
  ]);

  const comments = firstNumber(window, [
    /"edge_media_to_comment":\{"count":(\d+)\}/,
    /"edge_media_to_parent_comment":\{"count":(\d+)\}/,
    /"comment_count":(\d+)/,
  ]);

  const takenAtRaw = firstNumber(window, [/"taken_at_timestamp":(\d+)/, /"taken_at":(\d+)/, /"device_timestamp":(\d+)/]);
  // Instagram's timestamps are seconds; anything already millisecond-scale
  // (13+ digits) is left alone so this stays correct if that ever changes.
  const takenAt = takenAtRaw === null ? null : takenAtRaw < 1e12 ? takenAtRaw * 1000 : takenAtRaw;

  let kind: PostKind | null = null;
  if (/"product_type":"clips"/.test(window) || /"media_type":2.{0,40}"has_audio"/.test(window)) kind = 'reel';
  else if (/"__typename":"GraphSidecar"/.test(window) || /"carousel_media_count":\d/.test(window)) kind = 'carousel';
  else if (/"is_video":true/.test(window)) kind = 'reel';
  else if (/"is_video":false/.test(window)) kind = 'post';

  let pinned: boolean | null = null;
  if (/"pinned_for_users":\[\s*\]/.test(window)) pinned = false;
  else if (/"pinned_for_users":\[[^\]]+\]/.test(window)) pinned = true;
  else if (/"is_pinned":true/.test(window)) pinned = true;

  return { views, likes, comments, takenAt, kind, pinned };
}

/** Fills only the gaps an earlier, more specific reading left null. */
function merge(base: JsonSignal, extra: JsonSignal): JsonSignal {
  return {
    views: base.views ?? extra.views,
    likes: base.likes ?? extra.likes,
    comments: base.comments ?? extra.comments,
    takenAt: base.takenAt ?? extra.takenAt,
    kind: base.kind ?? extra.kind,
    pinned: base.pinned ?? extra.pinned,
  };
}

/**
 * Scans every provided script body for shortcode-keyed post data and returns
 * a shortcode → JsonSignal map. Safe to call with page-scale strings; there
 * is no backtracking-prone pattern here and every match is bounded by WINDOW.
 */
export function extractJsonSignals(scriptTexts: string[]): Map<string, JsonSignal> {
  const result = new Map<string, JsonSignal>();

  for (const text of scriptTexts) {
    if (!text || text.length < 20) continue;

    SHORTCODE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SHORTCODE_RE.exec(text))) {
      const code = match[1];
      const start = Math.max(0, match.index - WINDOW);
      const end = Math.min(text.length, match.index + match[0].length + WINDOW);
      const window = text.slice(start, end);
      const reading = readSignal(window);

      const existing = result.get(code);
      result.set(code, existing ? merge(existing, reading) : reading);
    }
  }

  return result;
}

export function emptySignal(): JsonSignal {
  return { ...EMPTY_SIGNAL };
}
