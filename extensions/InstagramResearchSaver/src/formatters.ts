/**
 * The export layer: a list of saved posts in, CSV or Markdown out. JSON export
 * is the backup itself (see storage.ts#exportBackup) — this file only handles
 * the two human-facing formats.
 *
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly.
 */

import { Collection, SavedPost } from './types';

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function collectionName(collections: Collection[], id: string): string {
  return collections.find(c => c.id === id)?.name ?? 'Uncategorized';
}

const CSV_HEADERS = [
  'Collection',
  'Creator handle',
  'Post URL',
  'Thumbnail',
  'Views',
  'Likes',
  'Comments',
  'Caption',
  'Post date',
  'Saved date',
  'Note',
  'Carousel slides',
];

/** One row per saved post, every field from PRD §4's capture table. */
export function toCsv(posts: SavedPost[], collections: Collection[]): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const post of posts) {
    rows.push(
      [
        collectionName(collections, post.collectionId),
        post.creatorHandle,
        post.postUrl,
        post.thumbnail,
        post.metrics.views === null ? '' : String(post.metrics.views),
        post.metrics.likes === null ? '' : String(post.metrics.likes),
        post.metrics.comments === null ? '' : String(post.metrics.comments),
        post.caption,
        post.postDate,
        new Date(post.savedAt).toISOString(),
        post.note,
        post.carouselCount === null ? '' : String(post.carouselCount),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

/** One section per post: thumbnail, handle, numbers, caption, note, link (PRD §4). */
export function toMarkdown(posts: SavedPost[], collections: Collection[]): string {
  if (!posts.length) return '_No saved posts yet._\n';

  const byCollection = new Map<string, SavedPost[]>();
  for (const post of posts) {
    const list = byCollection.get(post.collectionId) ?? [];
    list.push(post);
    byCollection.set(post.collectionId, list);
  }

  // Posts whose collection was deleted out from under them (should not
  // normally happen — collections aren't deletable in V1 — but never drop a
  // card silently) get an "Uncategorized" section rather than vanishing.
  const knownIds = new Set(collections.map(c => c.id));
  const orderedCollections = [
    ...collections,
    ...(byCollection.has('__uncategorized__') || [...byCollection.keys()].some(id => !knownIds.has(id))
      ? [{ id: '__uncategorized__', name: 'Uncategorized', createdAt: 0 }]
      : []),
  ];

  const parts: string[] = [];
  for (const collection of orderedCollections) {
    const list =
      collection.id === '__uncategorized__'
        ? [...byCollection.entries()].filter(([id]) => !knownIds.has(id)).flatMap(([, l]) => l)
        : byCollection.get(collection.id);
    if (!list?.length) continue;

    parts.push(`# ${collection.name}`, '');
    for (const post of [...list].sort((a, b) => b.savedAt - a.savedAt)) {
      parts.push(`## @${post.creatorHandle || 'unknown'}`, '');
      if (post.thumbnail) parts.push(`![thumbnail](${post.thumbnail})`, '');
      parts.push(
        `- Views: ${formatMetric(post.metrics.views)} · Likes: ${formatMetric(post.metrics.likes)} · Comments: ${formatMetric(post.metrics.comments)}`
      );
      if (post.carouselCount) parts.push(`- Carousel: ${post.carouselCount} slides (first slide saved)`);
      if (post.postDate) parts.push(`- Posted: ${post.postDate}`);
      parts.push(`- Saved: ${new Date(post.savedAt).toISOString().slice(0, 10)}`, '');
      if (post.caption.trim()) {
        parts.push('> ' + post.caption.trim().split('\n').join('\n> '), '');
      }
      if (post.note.trim()) parts.push(`**Note:** ${post.note.trim()}`, '');
      parts.push(`[Open post](${post.postUrl})`, '');
    }
  }

  return (parts.length ? parts.join('\n') : '_No saved posts yet._').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildExportFilename(kind: 'csv' | 'md' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `instagram-research-${stamp}.${kind}`;
}
