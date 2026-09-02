/**
 * Reading YouTube's own bootstrap JSON.
 *
 * YouTube ships the data its page renders from as a `ytInitialData = {…}`
 * assignment inside a `<script>`. Both the subscription scrape (over fetched
 * HTML) and channel identification (over the live document's scripts) need it,
 * so the parser lives here rather than being written twice — the second copy
 * was a regex over raw script text, and it was the least reliable code in the
 * extension.
 */

/** Pull the `ytInitialData = {...}` object out of a script or HTML document. */
export function extractInitialData(text: string): unknown | null {
  return extractAssignedObject(text, 'ytInitialData');
}

/**
 * The same, for the player payload.
 *
 * A watch page states its owner here and nowhere else that survives: the
 * microformat `<meta itemprop="channelId">` that used to carry it is gone from
 * modern watch pages, and the owner link beside Subscribe is an `/@handle`.
 */
export function extractPlayerResponse(text: string): unknown | null {
  return extractAssignedObject(text, 'ytInitialPlayerResponse');
}

function extractAssignedObject(text: string, marker: string): unknown | null {
  let from = 0;

  for (;;) {
    const at = text.indexOf(marker, from);
    if (at === -1) return null;
    const brace = text.indexOf('{', at);
    if (brace === -1) return null;

    // Only accept a hit where the JSON starts within the assignment, not one
    // buried in unrelated script text hundreds of characters away.
    if (brace - at < 40) {
      const json = sliceBalancedObject(text, brace);
      if (json) {
        try {
          return JSON.parse(json);
        } catch {
          /* fall through and try the next occurrence */
        }
      }
    }
    from = at + marker.length;
  }
}

/** Scan forward from `start` (a `{`) to its matching `}`, respecting strings. */
function sliceBalancedObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Narrow an unknown to an indexable object without reaching for `any`. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/** Follow a path of keys, returning null the moment one is missing. */
export function dig(root: unknown, ...path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    const record = asRecord(node);
    if (!record) return null;
    node = record[key];
  }
  return node ?? null;
}

/**
 * The channel ID a `ytInitialData` payload describes, if it describes one.
 *
 * Reads the documented locations rather than pattern-matching the text, which
 * is how PocketTube does it too: `channelMetadataRenderer.externalId` is the
 * page's own statement of which channel it is, and the header renderers carry
 * the same value for older layouts.
 */
export function channelIdFromInitialData(data: unknown): string | null {
  const candidates = [
    dig(data, 'metadata', 'channelMetadataRenderer', 'externalId'),
    dig(data, 'header', 'c4TabbedHeaderRenderer', 'channelId'),
    dig(data, 'microformat', 'microformatDataRenderer', 'externalId'),
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.startsWith('UC')) return value;
  }
  return null;
}

/**
 * The owner of the video a player payload describes.
 *
 * `videoId` is checked rather than trusted: navigation leaves earlier pages'
 * scripts in the document, so a payload found here may describe the video you
 * were watching a minute ago. Matching it against the id in the URL is a
 * stronger guard than "the last script wins" — the same reasoning that scopes
 * the channel-page lookup to a handle.
 */
export function videoOwnerIdFromPlayerResponse(data: unknown, videoId: string): string | null {
  if (dig(data, 'videoDetails', 'videoId') !== videoId) return null;
  const id = dig(data, 'videoDetails', 'channelId');
  return typeof id === 'string' && id.startsWith('UC') ? id : null;
}

/**
 * The owner of the video a `ytInitialData` payload describes.
 *
 * Second source for the same fact, because the two payloads are shipped by
 * different parts of the page and a layout change rarely moves both at once.
 */
export function videoOwnerIdFromInitialData(data: unknown): string | null {
  const contents = dig(data, 'contents', 'twoColumnWatchNextResults', 'results', 'results', 'contents');
  if (!Array.isArray(contents)) return null;

  for (const item of contents) {
    const id = dig(
      item,
      'videoSecondaryInfoRenderer',
      'owner',
      'videoOwnerRenderer',
      'navigationEndpoint',
      'browseEndpoint',
      'browseId',
    );
    if (typeof id === 'string' && id.startsWith('UC')) return id;
  }
  return null;
}
