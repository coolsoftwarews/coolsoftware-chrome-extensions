/**
 * Search across the whole library — drafts, templates and archived published
 * posts together (PRD §4). Deliberately simple: case-insensitive substring
 * matching over text and tags, no stemming/NLP, same "don't pretend to do
 * NLP" discipline as this portfolio's Rules engine. Pure, so it is fully
 * covered by scripts/selftest.mjs.
 */

import { ItemKind, SearchableItem } from './types';

export interface SearchOptions {
  query?: string;
  kind?: ItemKind;
  tag?: string;
}

function normalize(value: string): string {
  return value.toLowerCase().trim();
}

export function searchItems<T extends SearchableItem>(items: T[], options: SearchOptions = {}): T[] {
  const query = normalize(options.query ?? '');
  const tag = options.tag ? normalize(options.tag) : null;

  return items.filter(item => {
    if (options.kind && item.kind !== options.kind) return false;
    if (tag && !item.tags.some(t => normalize(t) === tag)) return false;
    if (!query) return true;
    if (normalize(item.text).includes(query)) return true;
    return item.tags.some(t => normalize(t).includes(query));
  });
}

/** Every distinct tag currently in use, sorted, for building a filter list in the panel. */
export function uniqueTags(items: SearchableItem[]): string[] {
  const set = new Set<string>();
  for (const item of items) {
    for (const tag of item.tags) {
      const trimmed = tag.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Splits a free-typed tag field ("hooks, carousels,  hooks") into a clean, deduped list. */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
