/**
 * The whole-library backup shape and its merge-on-import logic. Pure, like
 * dedupe.ts, so it is covered by scripts/selftest.mjs without a browser.
 */

import { Backup, ImportResult, Quote, Theme } from './types';

export function buildBackup(quotes: Quote[], themes: Theme[], exportedAt = new Date().toISOString()): Backup {
  return { format: 'reddit-voice-of-customer', version: 1, exportedAt, quotes, themes };
}

export interface MergedImport {
  quotes: Quote[];
  themes: Theme[];
  result: ImportResult;
}

/**
 * Merges a backup into what's already stored. Quotes and themes are matched
 * by id — importing the same file twice must not double a single quote (PRD
 * §6 data ownership). A record whose id is already known is overwritten by
 * the incoming one; anything the backup doesn't mention is left untouched.
 */
export function mergeImport(existingQuotes: Quote[], existingThemes: Theme[], raw: unknown): MergedImport {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'reddit-voice-of-customer' || !Array.isArray(backup.quotes)) {
    throw new Error('That file is not a Reddit Voice-of-Customer backup.');
  }

  const themeById = new Map(existingThemes.map(t => [t.id, t]));
  let themesChanged = 0;
  for (const theme of backup.themes ?? []) {
    if (!theme?.id || typeof theme.name !== 'string') continue;
    if (!themeById.has(theme.id)) themesChanged++;
    themeById.set(theme.id, theme);
  }

  const quoteById = new Map(existingQuotes.map(q => [q.id, q]));
  let quotesChanged = 0;
  for (const quote of backup.quotes) {
    if (!quote?.id || typeof quote.quote !== 'string' || typeof quote.permalink !== 'string') continue;
    if (!quoteById.has(quote.id)) quotesChanged++;
    quoteById.set(quote.id, quote);
  }

  return {
    quotes: [...quoteById.values()].sort((a, b) => a.createdAt - b.createdAt),
    themes: [...themeById.values()],
    result: { quotes: quotesChanged, themes: themesChanged },
  };
}
