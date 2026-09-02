/**
 * YouTube transcript extraction.
 *
 * Ported from the SavePosty Chrome extension, with all backend/auth coupling
 * removed. The only network target is youtube.com.
 *
 * Why it looks like this: YouTube requires a Proof-of-Origin Token (`pot`) on
 * every /api/timedtext request. Without it the endpoint returns 0 bytes from
 * every context — MAIN world, ISOLATED world, service worker, XHR. So we never
 * construct a timedtext URL ourselves; we let YouTube's own player issue the
 * authenticated request (by toggling the CC button) and lift the token back out
 * of the Performance resource timings.
 */

import {
  AvailableLanguage,
  Chapter,
  TranscriptError,
  TranscriptResult,
  TranscriptSegment,
  VideoMeta,
} from './types';

interface RawCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind?: string;
  name?: { simpleText?: string; runs?: Array<{ text: string }> };
}

interface RawTranslationLanguage {
  languageCode: string;
  languageName?: { simpleText?: string; runs?: Array<{ text: string }> };
}

interface ExtractorCache {
  videoId: string;
  tabId: number;
  captionTracks: RawCaptionTrack[];
  defaultTrackBaseUrl: string;
  pot: string | null;
  meta: VideoMeta;
  availableLanguages: AvailableLanguage[];
}

let cache: ExtractorCache | null = null;

/* ── URL helpers ─────────────────────────────────────────────────────── */

export function extractVideoId(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

    if (host === 'youtube.com') {
      const v = url.searchParams.get('v');
      if (v) return v;
      const match = url.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
      if (match) return match[2];
    }

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split(/[/?]/)[0];
      if (id) return id;
    }

    return null;
  } catch {
    return null;
  }
}

export function isYouTubeUrl(urlStr: string): boolean {
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, '').replace(/^m\./, '');
    return host === 'youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}

/* ── Watch-page parsing ──────────────────────────────────────────────── */

/**
 * Reads a balanced JSON object/array starting at `start` in `html`.
 *
 * The watch page embeds player JSON inside a <script>, so we cannot regex our
 * way to the closing brace — string literals contain braces of their own. This
 * walks the text tracking string/escape state, which is what makes the parse
 * survive titles like `{"a":"}"}`.
 */
function readJsonAt(html: string, start: number): string | null {
  const open = html[start];
  if (open !== '{' && open !== '[') return null;
  const close = open === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < html.length; i++) {
    const ch = html[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return html.slice(start, i + 1);
    }
  }

  return null;
}

function parseObjectAfterKey<T>(html: string, key: string): T | null {
  const marker = `"${key}":`;
  let from = 0;
  for (;;) {
    const idx = html.indexOf(marker, from);
    if (idx === -1) return null;
    const raw = readJsonAt(html, idx + marker.length);
    if (raw) {
      try {
        return JSON.parse(raw) as T;
      } catch {
        /* keep looking — this occurrence was not the one we wanted */
      }
    }
    from = idx + marker.length;
  }
}

function trackLabel(name: RawCaptionTrack['name'] | RawTranslationLanguage['languageName']): string | null {
  if (!name) return null;
  if (name.simpleText) return name.simpleText;
  if (name.runs?.length) return name.runs.map(r => r.text).join('');
  return null;
}

/** Detects the states we cannot serve, so the panel can say why instead of just failing. */
function assertPlayable(html: string): void {
  const playability = parseObjectAfterKey<any>(html, 'playabilityStatus');
  const status: string | undefined = playability?.status;

  if (status && status !== 'OK') {
    const detail: string =
      playability?.reason ??
      playability?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText ??
      status;

    if (status === 'LOGIN_REQUIRED' || /age|sign in/i.test(detail)) {
      throw new TranscriptError('unavailable', 'This video is age-restricted or requires sign-in, so its captions cannot be read.');
    }
    throw new TranscriptError('unavailable', `This video is unavailable: ${detail}`);
  }

  // Only `isLive` means "airing right now" — `isLiveContent` stays true on the
  // VOD of a finished stream, which does have a transcript.
  const details = parseObjectAfterKey<any>(html, 'videoDetails');
  if (details?.isLive === true || details?.isUpcoming === true) {
    throw new TranscriptError('live', 'Live streams and premieres do not have a finished transcript yet.');
  }
}

function readVideoMeta(html: string, videoId: string): VideoMeta {
  const details = parseObjectAfterKey<any>(html, 'videoDetails');

  let title: string = typeof details?.title === 'string' ? details.title : '';
  if (!title) {
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    title = titleMatch ? titleMatch[1].replace(/ - YouTube$/, '').trim() : 'YouTube video';
  }

  const channel: string = typeof details?.author === 'string' ? details.author : 'Unknown channel';
  const durationSeconds = Number.parseInt(details?.lengthSeconds ?? '0', 10) || 0;

  return {
    videoId,
    title: decodeEntities(title),
    channel: decodeEntities(channel),
    durationSeconds,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

function decodeEntities(value: string): string {
  if (!value.includes('&')) return value;
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}

/* ── Network ─────────────────────────────────────────────────────────── */

async function fetchViaBackground(url: string): Promise<string> {
  let result: any;
  try {
    result = await chrome.runtime.sendMessage({ type: 'YTX_FETCH_URL', url });
  } catch (e: any) {
    throw new TranscriptError('network', e?.message || 'Extension messaging failed.');
  }
  if (!result?.ok) {
    throw new TranscriptError('network', result?.error || 'Request to YouTube failed.');
  }
  return result.body ?? '';
}

/* ── POT token ───────────────────────────────────────────────────────── */

/**
 * Runs in the page's MAIN world: toggles the CC button and reads the `pot`
 * parameter off YouTube's own timedtext request.
 */
async function stealPotToken(tabId: number): Promise<string | null> {
  try {
    const [injected] = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async () => {
        const ccBtn =
          document.querySelector<HTMLButtonElement>(
            '#movie_player .ytp-right-controls button.ytp-subtitles-button'
          ) ||
          document.querySelector<HTMLButtonElement>('button.ytp-subtitles-button');

        if (!ccBtn) return null;

        return await new Promise<string | null>(resolve => {
          const timeout = setTimeout(() => resolve(null), 3000);

          ccBtn.addEventListener(
            'click',
            async () => {
              performance.clearResourceTimings();
              let found: string | null = null;
              for (let i = 0; i <= 1000; i += 50) {
                await new Promise(r => setTimeout(r, 50));
                const entry = performance
                  .getEntriesByType('resource')
                  .filter(e => e.name.includes('/api/timedtext?'))
                  .pop();
                if (entry) {
                  found = new URL(entry.name).searchParams.get('pot');
                  if (found) break;
                }
              }
              clearTimeout(timeout);
              resolve(found);
            },
            { once: true }
          );

          // On, then straight back off — the user should not see captions appear.
          ccBtn.click();
          ccBtn.click();
        });
      },
    });

    return (injected?.result as string | null) ?? null;
  } catch {
    // Injection can fail on a page we are not allowed to script; the caller
    // still has the no-POT fallback path.
    return null;
  }
}

/* ── timedtext ───────────────────────────────────────────────────────── */

function buildTimedtextUrl(baseUrl: string, pot: string | null, translateTo?: string): string {
  let url = baseUrl;
  if (translateTo) url += '&tlang=' + encodeURIComponent(translateTo);
  if (pot) url += '&c=WEB&pot=' + pot;
  try {
    const u = new URL(url);
    u.searchParams.delete('fmt'); // we want plain XML back
    return u.toString();
  } catch {
    return url;
  }
}

function parseTimedtext(xml: string): TranscriptSegment[] {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) return [];

  const segments: TranscriptSegment[] = [];
  /*
   * A textarea, not a div.
   *
   * Both decode entities, but a div *builds* whatever the caption text says —
   * and caption text is not ours. Nothing would execute (the page's CSP allows
   * no inline handlers and no foreign scripts), but an `<img src>` in there
   * would still reach for a URL, which is a request nobody asked for. A
   * textarea parses its content as text and constructs nothing.
   */
  const scratch = document.createElement('textarea');

  for (const node of Array.from(doc.querySelectorAll('text'))) {
    const raw = (node.textContent || '').trim();
    if (!raw) continue;
    // Caption text is double-escaped: the XML text node still holds entities.
    scratch.innerHTML = raw;
    const text = (scratch.value || '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    segments.push({
      text,
      start: Number.parseFloat(node.getAttribute('start') ?? '0') || 0,
      duration: Number.parseFloat(node.getAttribute('dur') ?? '0') || 0,
    });
  }

  return segments;
}

async function loadSegments(baseUrl: string, pot: string | null, translateTo?: string): Promise<TranscriptSegment[]> {
  const body = await fetchViaBackground(buildTimedtextUrl(baseUrl, pot, translateTo));
  if (body.length > 10) {
    const segments = parseTimedtext(body);
    if (segments.length) return segments;
  }

  // Some videos serve captions without a token at all — worth one retry before
  // reporting failure, since it costs a single request.
  if (pot) {
    const fallback = await fetchViaBackground(buildTimedtextUrl(baseUrl, null, translateTo));
    if (fallback.length > 10) {
      const segments = parseTimedtext(fallback);
      if (segments.length) return segments;
    }
  }

  return [];
}

/* ── Public API ──────────────────────────────────────────────────────── */

function buildLanguageList(
  tracks: RawCaptionTrack[],
  translations: RawTranslationLanguage[]
): AvailableLanguage[] {
  const languages: AvailableLanguage[] = [];
  const nativeCodes = new Set<string>();

  tracks.forEach((track, index) => {
    nativeCodes.add(track.languageCode);
    const isAuto = track.kind === 'asr';
    const label = trackLabel(track.name) || track.languageCode;
    // Manual and auto tracks can share a language code, so the label carries the
    // distinction and the key carries the index.
    languages.push({
      code: track.languageCode,
      name: isAuto && !/auto/i.test(label) ? `${label} (auto-generated)` : label,
      isTranslation: false,
      isAutoGenerated: isAuto,
      key: `track:${index}`,
    });
  });

  for (const tl of translations) {
    if (nativeCodes.has(tl.languageCode)) continue;
    languages.push({
      code: tl.languageCode,
      name: `${trackLabel(tl.languageName) || tl.languageCode} (translated)`,
      isTranslation: true,
      isAutoGenerated: false,
      key: `translate:${tl.languageCode}`,
    });
  }

  return languages;
}

function pickDefaultTrackIndex(tracks: RawCaptionTrack[]): number {
  const uiLang = (chrome.i18n?.getUILanguage?.() || 'en').split('-')[0];
  const byUi = tracks.findIndex(t => t.languageCode.startsWith(uiLang) && t.kind !== 'asr');
  if (byUi !== -1) return byUi;
  const byUiAsr = tracks.findIndex(t => t.languageCode.startsWith(uiLang));
  if (byUiAsr !== -1) return byUiAsr;
  const manual = tracks.findIndex(t => t.kind !== 'asr');
  return manual !== -1 ? manual : 0;
}

export async function extractTranscript(tabId: number, url: string): Promise<TranscriptResult> {
  if (!isYouTubeUrl(url)) {
    throw new TranscriptError('not-youtube', 'Open a YouTube video to export its transcript.');
  }

  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new TranscriptError('no-video', 'This YouTube page is not a video.');
  }

  const html = await fetchViaBackground(`https://www.youtube.com/watch?v=${videoId}`);
  if (!html) {
    throw new TranscriptError('network', 'YouTube returned an empty page.');
  }

  assertPlayable(html);

  const meta = readVideoMeta(html, videoId);
  const captions = parseObjectAfterKey<any>(html, 'captions');
  const tracklist = captions?.playerCaptionsTracklistRenderer;
  const captionTracks: RawCaptionTrack[] = tracklist?.captionTracks ?? [];

  if (!captionTracks.length) {
    throw new TranscriptError('no-captions', 'This video has no captions available.');
  }

  const availableLanguages = buildLanguageList(captionTracks, tracklist?.translationLanguages ?? []);
  const defaultIndex = pickDefaultTrackIndex(captionTracks);
  const chosen = captionTracks[defaultIndex];

  const pot = await stealPotToken(tabId);

  cache = {
    videoId,
    tabId,
    captionTracks,
    defaultTrackBaseUrl: chosen.baseUrl,
    pot,
    meta,
    availableLanguages,
  };

  const segments = await loadSegments(chosen.baseUrl, pot);
  if (!segments.length) {
    throw new TranscriptError(
      pot ? 'parse' : 'pot-failed',
      pot
        ? 'YouTube returned an empty transcript for this video.'
        : 'Could not obtain a caption token from the player. Reload the video page and try again.'
    );
  }

  const language = availableLanguages[defaultIndex];
  return {
    segments,
    chapters: parseChapters(html),
    languageKey: language.key,
    languageName: language.name,
    isAutoGenerated: language.isAutoGenerated,
    availableLanguages,
    meta,
  };
}

/**
 * The video's own chapters, from the marker bar under the player.
 *
 * Read from the page rather than parsed out of the description: a creator can
 * write timestamps in a description in any format they like, while this is the
 * list YouTube itself renders, already structured and already the one the
 * viewer sees. Videos without chapters simply have no markers, which is why
 * this returns an empty list rather than failing.
 */
export function parseChapters(html: string): Chapter[] {
  const markers = parseObjectAfterKey<any>(html, 'multiMarkersPlayerBarRenderer');
  const maps: any[] = Array.isArray(markers?.markersMap) ? markers.markersMap : [];

  for (const entry of maps) {
    const list = entry?.value?.chapters;
    if (!Array.isArray(list)) continue;

    const chapters: Chapter[] = [];
    for (const item of list) {
      const renderer = item?.chapterRenderer;
      const title: unknown = renderer?.title?.simpleText;
      const startMs: unknown = renderer?.timeRangeStartMillis;
      if (typeof title === 'string' && typeof startMs === 'number') {
        chapters.push({ title: title.trim(), start: startMs / 1000 });
      }
    }
    if (chapters.length) return chapters.sort((a, b) => a.start - b.start);
  }

  return [];
}

/** Re-fetches the current video's transcript in another language. Requires a prior extractTranscript(). */
export async function fetchTranscriptByLanguage(languageKey: string): Promise<TranscriptResult> {
  if (!cache) {
    throw new TranscriptError('unknown', 'Load a transcript before switching language.');
  }

  const language = cache.availableLanguages.find(l => l.key === languageKey);
  if (!language) {
    throw new TranscriptError('unknown', 'That caption language is no longer available.');
  }

  let segments: TranscriptSegment[];
  if (language.key.startsWith('track:')) {
    const index = Number.parseInt(language.key.slice('track:'.length), 10);
    segments = await loadSegments(cache.captionTracks[index].baseUrl, cache.pot);
  } else {
    segments = await loadSegments(cache.defaultTrackBaseUrl, cache.pot, language.code);
  }

  if (!segments.length) {
    throw new TranscriptError('parse', `No transcript came back for ${language.name}.`);
  }

  return {
    segments,
    languageKey: language.key,
    languageName: language.name,
    isAutoGenerated: language.isAutoGenerated,
    availableLanguages: cache.availableLanguages,
    meta: cache.meta,
  };
}

export function clearExtractorCache(): void {
  cache = null;
}

export function cachedVideoId(): string | null {
  return cache?.videoId ?? null;
}

/* ── Formatting helpers ──────────────────────────────────────────────── */

/** Merges caption lines into readable blocks (~60s / ~500 chars), preserving the block start time. */
export function groupSegments(
  segments: TranscriptSegment[],
  maxDuration = 60,
  maxChars = 500
): TranscriptSegment[] {
  if (!segments.length) return [];

  const groups: TranscriptSegment[] = [];
  let start = segments[0].start;
  let texts: string[] = [segments[0].text];
  let totalDur = segments[0].duration;

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    const elapsed = seg.start - start;
    const joinedLength = texts.reduce((n, t) => n + t.length + 1, 0) + seg.text.length;

    if (elapsed < maxDuration && joinedLength < maxChars) {
      texts.push(seg.text);
      totalDur = seg.start + seg.duration - start;
    } else {
      groups.push({ text: texts.join(' '), start, duration: totalDur });
      start = seg.start;
      texts = [seg.text];
      totalDur = seg.duration;
    }
  }

  groups.push({ text: texts.join(' '), start, duration: totalDur });
  return groups;
}

export function formatTimestamp(seconds: number, forceHours = false): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;

  if (h > 0 || forceHours) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
