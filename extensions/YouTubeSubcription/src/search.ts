/**
 * The search rule, in one place.
 *
 * Two surfaces filter by the same query — the charts and the CSV export — so
 * the rule cannot live in either of them, or a search that narrowed the picture
 * would export a different set of videos.
 *
 * The rule itself has one wrinkle, and it exists because a three-letter query
 * is genuinely ambiguous. Searching "has" matched HASfit (intended) *and*
 * "pur**chas**e", "**chas**ed", "was**has**" (not intended), because a
 * substring match cannot tell the difference. So:
 *
 *   • short queries (under 4 characters) match at the start of a word
 *   • longer queries match anywhere
 *
 * Two rules is worse than one and only earns its place because the results are
 * visible: matches are highlighted in the table, so what the rule did is on
 * screen rather than inferred.
 */

const WORD_QUERY_LIMIT = 4;

/**
 * The fields a search can look at.
 *
 * Chosen by the reader rather than explained in prose: a paragraph describing
 * which fields are searched is a paragraph nobody reads, and it cannot answer
 * "only channels, please". A control can.
 */
export type SearchField = 'title' | 'channel' | 'handle' | 'group';

export const SEARCH_FIELDS: Array<{ id: SearchField; label: string }> = [
  { id: 'title', label: 'Video title' },
  { id: 'channel', label: 'Channel name' },
  { id: 'handle', label: '@handle' },
  { id: 'group', label: 'Group name' },
];

export const DEFAULT_FIELDS: SearchField[] = ['title', 'channel'];

/** What a row offers up to be searched. */
export interface Searchable {
  title: string;
  channel: string;
  handle: string;
  groups: string[];
}

export interface Matcher {
  /** True when nothing is being searched for — callers skip filtering. */
  empty: boolean;
  test(text: string): boolean;
  /** Character ranges that matched, for highlighting. */
  ranges(text: string): Array<[number, number]>;
}

const NEVER: Matcher = {
  empty: true,
  test: () => true,
  ranges: () => [],
};

export function makeMatcher(rawQuery: string): Matcher {
  const query = rawQuery.trim();
  if (query === '') return NEVER;

  /*
   * Short queries must match at the *start* of a word — not as a whole word.
   *
   * Whole-word was the obvious rule and it was wrong: "has" would stop matching
   * HASfit, which is the exact search that prompted all of this. A leading
   * boundary keeps HASfit and "it has arrived" while dropping "pur-chas-e" and
   * "c-has-ed", where the letters sit mid-word.
   *
   * The boundary is only applied when the query starts with a word character —
   * `\b` before punctuation means the opposite of what it looks like.
   */
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lead = /^\w/.test(query) ? '\\b' : '';
  const source = query.length < WORD_QUERY_LIMIT ? `${lead}${escaped}` : escaped;

  const build = () => new RegExp(source, 'giu');

  return {
    empty: false,
    test(text: string): boolean {
      return build().test(text);
    },
    ranges(text: string): Array<[number, number]> {
      const found: Array<[number, number]> = [];
      const pattern = build();
      for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
        found.push([match.index, match.index + match[0].length]);
        // A zero-length match would loop forever; nothing here produces one,
        // but the guard costs nothing and the failure would be a hung tab.
        if (match[0].length === 0) pattern.lastIndex++;
      }
      return found;
    },
  };
}

/**
 * Does this row match, in the fields the reader chose?
 *
 * An empty field list matches nothing rather than everything: unticking every
 * box is a deliberate act, and answering it with "here is all of it" would be
 * ignoring the instruction.
 */
export function matchesVideo(
  matcher: Matcher,
  row: Searchable,
  fields: SearchField[] = DEFAULT_FIELDS,
): boolean {
  if (matcher.empty) return true;

  for (const field of fields) {
    if (field === 'title' && matcher.test(row.title)) return true;
    if (field === 'channel' && matcher.test(row.channel)) return true;
    if (field === 'handle' && matcher.test(row.handle)) return true;
    if (field === 'group' && row.groups.some((name) => matcher.test(name))) return true;
  }
  return false;
}

/**
 * Split text into plain and matched parts, for rendering with the matched
 * pieces marked.
 */
export function highlight(matcher: Matcher, text: string): Array<{ text: string; hit: boolean }> {
  if (matcher.empty) return [{ text, hit: false }];

  const ranges = matcher.ranges(text);
  if (ranges.length === 0) return [{ text, hit: false }];

  const parts: Array<{ text: string; hit: boolean }> = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start > cursor) parts.push({ text: text.slice(cursor, start), hit: false });
    parts.push({ text: text.slice(start, end), hit: true });
    cursor = end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), hit: false });
  return parts;
}
