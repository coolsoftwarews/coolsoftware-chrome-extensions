/**
 * CSV and Markdown export (PRD §4). Deliberately pure — no DOM, no chrome.* —
 * so scripts/selftest.mjs can check the output byte-for-byte.
 */

import { ExportOptions } from './types';
import { RatedPost } from './types';
import { WatchedPerson } from './types';

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function formatDate(post: RatedPost): string {
  if (post.postedAt) return new Date(post.postedAt).toISOString().slice(0, 10);
  return post.postedAtLabel || '';
}

function formatRatio(ratio: number | null): string {
  return ratio === null ? '' : `${ratio.toFixed(1)}x`;
}

/** CSV columns exactly as PRD §4 lists them: person, post, metrics, ratio, date, link, note. */
export function toCsv(people: Map<string, WatchedPerson>, posts: RatedPost[], options: ExportOptions): string {
  const header = ['person', 'post', 'reactions', 'comments', 'reposts', 'ratio', 'date', 'link', 'note'];
  const rows = posts.map(post => {
    const person = people.get(post.personId);
    return [
      csvCell(person?.name ?? post.personId),
      csvCell(post.text),
      csvCell(post.reactions),
      csvCell(post.comments),
      csvCell(post.reposts),
      csvCell(formatRatio(post.ratio)),
      csvCell(formatDate(post)),
      csvCell(post.url),
      csvCell(options.includeNotes ? post.note : ''),
    ].join(',');
  });
  return [header.join(','), ...rows].join('\r\n') + '\r\n';
}

const DAY_MS = 86_400_000;

/** "no posts seen in 30 days" (PRD §7). null when there is nothing to judge quietness by. */
export function daysSinceLastPost(
  posts: Array<Pick<RatedPost, 'postedAt' | 'firstSeenAt'>>,
  now: number = Date.now()
): number | null {
  const latest = posts.reduce<number | null>((max, post) => {
    const at = post.postedAt ?? post.firstSeenAt;
    return max === null || at > max ? at : max;
  }, null);
  return latest === null ? null : Math.floor((now - latest) / DAY_MS);
}

/** A readable digest, one section per person (PRD §4). */
export function toMarkdown(people: WatchedPerson[], postsByPerson: Map<string, RatedPost[]>, options: ExportOptions): string {
  const parts: string[] = [`# LinkedIn Creator Watchlist`, '', `_Exported ${new Date().toISOString().slice(0, 10)}_`, ''];

  if (!people.length) {
    parts.push('_No one is being watched yet._', '');
    return parts.join('\n');
  }

  for (const person of people) {
    const posts = [...(postsByPerson.get(person.id) ?? [])].sort(
      (a, b) => (b.postedAt ?? b.firstSeenAt) - (a.postedAt ?? a.firstSeenAt)
    );
    const quietDays = daysSinceLastPost(posts);

    parts.push(`## ${person.name}`, '');
    if (person.headline) parts.push(`_${person.headline}_`, '');
    parts.push(`Collected from ${posts.length} post${posts.length === 1 ? '' : 's'} you've seen.`, '');
    if (quietDays !== null && quietDays >= 30) {
      parts.push(`**No posts seen in ${quietDays} days.**`, '');
    }
    if (options.includeNotes && person.note.trim()) {
      parts.push(`> ${person.note.trim()}`, '');
    }

    if (!posts.length) {
      parts.push('_No posts collected yet — visit their profile or catch them in the feed._', '');
      continue;
    }

    for (const post of posts) {
      const date = formatDate(post);
      const ratio = post.ratio !== null ? ` · ${formatRatio(post.ratio)} outlier` : '';
      const repost = post.seenAsRepost ? ' · seen via a repost' : '';
      parts.push(
        `- **${date || 'undated'}**${ratio}${repost} — ${post.reactions} reactions, ${post.comments} comments, ${post.reposts} reposts`
      );
      if (post.text) parts.push(`  > ${post.text.replace(/\n/g, '\n  > ')}`);
      if (post.url) parts.push(`  [Open post](${post.url})`);
      if (options.includeNotes && post.note.trim()) parts.push(`  Note: ${post.note.trim()}`);
      parts.push('');
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** `linkedin-watchlist-{yyyy-mm-dd}.{ext}` — no page title to build a filename from here. */
export function buildFilename(ext: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `linkedin-watchlist-${stamp}.${ext}`;
}
