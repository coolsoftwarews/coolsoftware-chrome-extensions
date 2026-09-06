/**
 * The export layer: indexed bookmarks in, CSV or Markdown out (PRD §4). JSON
 * export is the backup itself (storage.ts#exportBackup) — this file only
 * handles the two human-facing formats.
 *
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly.
 */

import { BookmarkItem, Collection } from './types';

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function collectionName(collections: Collection[], id: string): string {
  return collections.find(c => c.id === id)?.name ?? 'Uncategorized';
}

const CSV_HEADERS = [
  'Folder',
  'Tags',
  'Item ID',
  'Author',
  'Handle',
  'Text',
  'Replies',
  'Reposts',
  'Likes',
  'Views',
  'Post date',
  'Post URL',
  'Indexed date',
  'Note',
];

export function toCsv(items: BookmarkItem[], collections: Collection[]): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const item of items) {
    const { post } = item;
    rows.push(
      [
        collectionName(collections, item.collectionId),
        item.tags.join('; '),
        item.id,
        post.author,
        post.handle,
        post.text,
        post.metrics.replies === null ? '' : String(post.metrics.replies),
        post.metrics.reposts === null ? '' : String(post.metrics.reposts),
        post.metrics.likes === null ? '' : String(post.metrics.likes),
        post.metrics.views === null ? '' : String(post.metrics.views),
        post.postDate,
        post.url,
        new Date(item.indexedAt).toISOString(),
        item.note,
      ]
        .map(v => csvCell(String(v)))
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

/** A readable digest, grouped by folder (PRD §4). */
export function toMarkdown(items: BookmarkItem[], collections: Collection[]): string {
  if (!items.length) return '_No bookmarks indexed yet._\n';

  const byCollection = new Map<string, BookmarkItem[]>();
  for (const item of items) {
    const list = byCollection.get(item.collectionId) ?? [];
    list.push(item);
    byCollection.set(item.collectionId, list);
  }

  const knownIds = new Set(collections.map(c => c.id));
  const hasStray = [...byCollection.keys()].some(id => !knownIds.has(id));
  const orderedCollections = [
    ...collections,
    ...(hasStray ? [{ id: '__uncategorized__', name: 'Uncategorized', createdAt: 0 }] : []),
  ];

  const parts: string[] = [];
  for (const collection of orderedCollections) {
    const list =
      collection.id === '__uncategorized__'
        ? [...byCollection.entries()].filter(([id]) => !knownIds.has(id)).flatMap(([, l]) => l)
        : byCollection.get(collection.id);
    if (!list?.length) continue;

    parts.push(`# ${collection.name}`, '');
    for (const item of [...list].sort((a, b) => b.indexedAt - a.indexedAt)) {
      const { post } = item;
      parts.push(`## ${post.author || 'Unknown'} (@${post.handle || 'unknown'})`, '');
      parts.push(...(post.text || '_(no text — media only)_').split('\n').map(line => `> ${line}`), '');
      parts.push(
        `- Replies: ${formatMetric(post.metrics.replies)} · Reposts: ${formatMetric(post.metrics.reposts)} · Likes: ${formatMetric(post.metrics.likes)} · Views: ${formatMetric(post.metrics.views)}`
      );
      if (item.tags.length) parts.push(`- Tags: ${item.tags.join(', ')}`);
      parts.push(`- Indexed: ${new Date(item.indexedAt).toISOString().slice(0, 10)}`, '');
      if (item.note.trim()) parts.push(`**Note:** ${item.note.trim()}`, '');
      parts.push(`[Open on X](${post.url})`, '');
    }
  }

  return (parts.length ? parts.join('\n') : '_No bookmarks indexed yet._').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildExportFilename(kind: 'csv' | 'md' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `x-bookmark-organizer-${stamp}.${kind}`;
}
