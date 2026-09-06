/**
 * The export layer: a list of saved pins in, CSV or Markdown out. JSON export
 * is the backup itself (see storage.ts#exportBackup) — this file only handles
 * the two human-facing formats.
 *
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly.
 */

import { Collection, PinCapture } from './types';

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function collectionName(collections: Collection[], id: string): string {
  return collections.find(c => c.id === id)?.name ?? 'Uncategorized';
}

/**
 * PRD §4's named columns (title, description, domain, URL, saves, collection,
 * note) plus the pin's own URL and a couple of fields worth having in a
 * planning spreadsheet — no new feature, just the data already captured.
 */
const CSV_HEADERS = [
  'Title',
  'Description',
  'Description truncated',
  'Domain',
  'Destination URL',
  'Pin URL',
  'Saves',
  'Board',
  'Creator',
  'Collection',
  'Note',
  'Date seen',
];

/** One row per saved pin — the primary artifact this product exists for (PRD §4). */
export function toCsv(pins: PinCapture[], collections: Collection[]): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const pin of pins) {
    rows.push(
      [
        pin.title,
        pin.description,
        pin.descriptionTruncated ? 'yes' : '',
        pin.destinationDomain,
        pin.destinationUrl,
        pin.pinUrl,
        pin.savesRaw,
        pin.boardName,
        pin.creator,
        collectionName(collections, pin.collectionId),
        pin.note,
        pin.dateSeen,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

function escapeAlt(text: string): string {
  return text.replace(/[[\]]/g, '').replace(/\n/g, ' ').trim();
}

/** A readable digest, grouped by collection, with thumbnails (PRD §4). */
export function toMarkdown(pins: PinCapture[], collections: Collection[]): string {
  if (!pins.length) return '_No saved pins yet._\n';

  const byCollection = new Map<string, PinCapture[]>();
  for (const pin of pins) {
    const list = byCollection.get(pin.collectionId) ?? [];
    list.push(pin);
    byCollection.set(pin.collectionId, list);
  }

  const knownIds = new Set(collections.map(c => c.id));
  const orderedCollections = [
    ...collections,
    ...([...byCollection.keys()].some(id => !knownIds.has(id))
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
    for (const pin of [...list].sort((a, b) => b.savedAt - a.savedAt)) {
      parts.push(`## ${pin.title || 'Untitled pin'}`, '');
      if (pin.imageUrl) parts.push(`![${escapeAlt(pin.title)}](${pin.imageUrl})`, '');
      parts.push(`- Domain: ${pin.destinationDomain || '—'}`);
      if (pin.destinationUrl) parts.push(`- Destination: ${pin.destinationUrl}`);
      const attribution = [pin.boardName, pin.creator].filter(Boolean).join(' · ');
      if (attribution) parts.push(`- Board / creator: ${attribution}`);
      if (pin.savesRaw) parts.push(`- Saves: ${pin.savesRaw}`);
      parts.push(`- Seen: ${pin.dateSeen}`, '');
      if (pin.description.trim()) {
        const quote = pin.description.trim().split('\n').join('\n> ');
        parts.push(`> ${quote}${pin.descriptionTruncated ? ' _(may be truncated — captured from the grid)_' : ''}`, '');
      } else if (pin.descriptionTruncated) {
        parts.push('_No description captured — save from the pin detail page for the full text._', '');
      }
      if (pin.note.trim()) parts.push(`**Note:** ${pin.note.trim()}`, '');
      parts.push(`[Open pin](${pin.pinUrl})`, '');
    }
  }

  return (parts.length ? parts.join('\n') : '_No saved pins yet._').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildExportFilename(kind: 'csv' | 'md' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `pinterest-competitor-research-${stamp}.${kind}`;
}
