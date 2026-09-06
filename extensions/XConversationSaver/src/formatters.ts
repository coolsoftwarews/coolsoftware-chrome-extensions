/**
 * The export layer: saved items in, CSV or Markdown out (PRD §4). JSON export
 * is the backup itself (storage.ts#exportBackup) — this file only handles the
 * two human-facing formats.
 *
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly.
 */

import { Collection, ItemKind, SavedItem } from './types';

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
  'Kind',
  'Item ID',
  'Post #',
  'Author',
  'Handle',
  'Text',
  'Replies',
  'Reposts',
  'Likes',
  'Views',
  'Post date',
  'Post URL',
  'Saved date',
  'Note',
];

/** One row per post (PRD §4: "one row per post, for the spreadsheet users") —
 *  a 12-post thread produces 12 rows sharing one item id, so a sales user can
 *  filter/pivot on individual posts while still grouping back to the thread. */
export function toCsv(items: SavedItem[], collections: Collection[]): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const item of items) {
    const collection = collectionName(collections, item.collectionId);
    item.posts.forEach((post, index) => {
      rows.push(
        [
          collection,
          item.kind,
          item.id,
          String(index + 1),
          post.author,
          post.handle,
          post.text,
          post.metrics.replies === null ? '' : String(post.metrics.replies),
          post.metrics.reposts === null ? '' : String(post.metrics.reposts),
          post.metrics.likes === null ? '' : String(post.metrics.likes),
          post.metrics.views === null ? '' : String(post.metrics.views),
          post.postDate,
          post.url,
          new Date(item.savedAt).toISOString(),
          index === 0 ? item.note : '',
        ]
          .map(v => csvCell(String(v)))
          .join(',')
      );
    });
  }
  return rows.join('\r\n') + '\r\n';
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

const KIND_LABEL: Record<ItemKind, string> = { post: 'Post', thread: 'Thread', conversation: 'Conversation' };

/** A readable digest, grouped by collection; threads render as threads (PRD
 *  §4 — "the feature bookmarks don't have"), not as a flat list of quotes. */
export function toMarkdown(items: SavedItem[], collections: Collection[]): string {
  if (!items.length) return '_No saved items yet._\n';

  const byCollection = new Map<string, SavedItem[]>();
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
    for (const item of [...list].sort((a, b) => b.savedAt - a.savedAt)) {
      const root = item.posts[0];
      parts.push(`## ${KIND_LABEL[item.kind]} — ${root.author || 'Unknown'} (@${root.handle || 'unknown'})`, '');

      for (const post of item.posts) {
        if (item.kind !== 'post') parts.push(`**${post.author} (@${post.handle})**`);
        parts.push(...(post.text || '_(no text — media only)_').split('\n').map(line => `> ${line}`));
        if (post.quoted) {
          parts.push('>', `> Quoting **${post.quoted.author} (@${post.quoted.handle})**:`);
          parts.push(...post.quoted.text.split('\n').map(line => `> > ${line}`));
        }
        parts.push('');
      }

      parts.push(
        `- Replies: ${formatMetric(root.metrics.replies)} · Reposts: ${formatMetric(root.metrics.reposts)} · Likes: ${formatMetric(root.metrics.likes)} · Views: ${formatMetric(root.metrics.views)}`
      );
      if (item.posts.length > 1) parts.push(`- Posts captured: ${item.posts.length}`);
      if (item.truncated) parts.push('- More replies were available on X when this was captured.');
      parts.push(`- Saved: ${new Date(item.savedAt).toISOString().slice(0, 10)}`, '');
      if (item.note.trim()) parts.push(`**Note:** ${item.note.trim()}`, '');
      parts.push(`[Open on X](${root.url})`, '');
    }
  }

  return (parts.length ? parts.join('\n') : '_No saved items yet._').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildExportFilename(kind: 'csv' | 'md' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `x-conversation-saver-${stamp}.${kind}`;
}
