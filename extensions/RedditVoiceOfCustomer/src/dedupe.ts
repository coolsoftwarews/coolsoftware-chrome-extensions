/**
 * Pure quote-list operations — no chrome.* here, so scripts/selftest.mjs can
 * exercise the save/dedupe/edit logic directly. storage.ts is the only file
 * that turns these into chrome.storage.local reads and writes.
 *
 * PRD §7: "Quotes from the same comment saved twice (dedupe, keep the longer
 * span)." Same comment = same permalink. A save that is equal to, or a
 * substring of, an existing quote from that permalink is a duplicate and is
 * dropped; a save that is a superset of one replaces it — keeping the
 * existing quote's id, note, theme and creation date, because a user's note
 * must never be lost just because they re-selected a wider span later.
 */

import { NewQuoteInput, Quote, SaveOutcome, Theme } from './types';

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newQuoteId(): string {
  return randomId('q');
}

export function newThemeId(): string {
  return randomId('t');
}

export interface MergeResult {
  quotes: Quote[];
  outcome: SaveOutcome;
}

export function mergeQuote(existing: Quote[], input: NewQuoteInput): MergeResult {
  const text = input.quote.trim();
  const siblings = existing.filter(q => q.permalink === input.permalink);

  for (const candidate of siblings) {
    const existingText = candidate.quote.trim();

    if (existingText === text || existingText.includes(text)) {
      return { quotes: existing, outcome: { status: 'duplicate', quote: candidate } };
    }

    if (text.includes(existingText)) {
      const replaced: Quote = {
        ...candidate,
        ...input,
        quote: text,
        // Keep what the user already put on this quote.
        id: candidate.id,
        note: candidate.note,
        themeId: candidate.themeId,
        createdAt: candidate.createdAt,
      };
      return {
        quotes: existing.map(q => (q.id === candidate.id ? replaced : q)),
        outcome: { status: 'replaced', quote: replaced },
      };
    }
  }

  const quote: Quote = { ...input, quote: text, id: newQuoteId(), note: '', themeId: '', createdAt: Date.now() };
  return { quotes: [...existing, quote], outcome: { status: 'saved', quote } };
}

export function assignTheme(quotes: Quote[], id: string, themeId: string): Quote[] {
  return quotes.map(q => (q.id === id ? { ...q, themeId } : q));
}

export function setNote(quotes: Quote[], id: string, note: string): Quote[] {
  return quotes.map(q => (q.id === id ? { ...q, note } : q));
}

/** One-way: strips a username the user decides they no longer want attached. */
export function hideAuthor(quotes: Quote[], id: string): Quote[] {
  return quotes.map(q => (q.id === id ? { ...q, author: '', anonymized: true } : q));
}

export function removeQuote(quotes: Quote[], id: string): Quote[] {
  return quotes.filter(q => q.id !== id);
}

export interface ThemeRemoval {
  themes: Theme[];
  quotes: Quote[];
}

/** Deleting a theme moves its quotes to Uncategorized rather than orphaning them. */
export function removeTheme(themes: Theme[], quotes: Quote[], id: string): ThemeRemoval {
  return {
    themes: themes.filter(t => t.id !== id),
    quotes: quotes.map(q => (q.themeId === id ? { ...q, themeId: '' } : q)),
  };
}

export function renameTheme(themes: Theme[], id: string, name: string): Theme[] {
  return themes.map(t => (t.id === id ? { ...t, name } : t));
}
