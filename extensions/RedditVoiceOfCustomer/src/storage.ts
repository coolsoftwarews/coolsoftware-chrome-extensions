/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §6). This file is the only
 * place that touches chrome.storage.*; every mutation it exposes just wraps
 * a pure function from dedupe.ts / backup.ts, which is what makes those
 * testable in scripts/selftest.mjs without a browser.
 */

import { assignTheme, hideAuthor, mergeQuote, newThemeId, removeQuote, removeTheme, renameTheme, setNote } from './dedupe';
import { buildBackup, mergeImport } from './backup';
import {
  Backup,
  DEFAULT_OPTIONS,
  DEFAULT_THEMES,
  ImportResult,
  NewQuoteInput,
  Options,
  Quote,
  QuotaStatus,
  SaveOutcome,
  Theme,
} from './types';

const QUOTES_KEY = 'rvoc:quotes';
const THEMES_KEY = 'rvoc:themes';
const OPTIONS_KEY = 'rvoc:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested — not
 * requested here, so the panel's 80% warning (PRD §4) is the only guard. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

export async function readQuotes(): Promise<Quote[]> {
  const stored = await chrome.storage.local.get(QUOTES_KEY);
  return (stored?.[QUOTES_KEY] as Quote[] | undefined) ?? [];
}

async function writeQuotes(quotes: Quote[]): Promise<void> {
  await chrome.storage.local.set({ [QUOTES_KEY]: quotes });
}

export async function readThemes(): Promise<Theme[]> {
  const stored = await chrome.storage.local.get(THEMES_KEY);
  const themes = stored?.[THEMES_KEY] as Theme[] | undefined;
  if (!themes) {
    await chrome.storage.local.set({ [THEMES_KEY]: DEFAULT_THEMES });
    return DEFAULT_THEMES;
  }
  return themes;
}

async function writeThemes(themes: Theme[]): Promise<void> {
  await chrome.storage.local.set({ [THEMES_KEY]: themes });
}

/**
 * Mutations are read-modify-write over one or two keys, so a save that races
 * a note edit would drop one of them. A single queue is enough at this
 * volume — everything here is one flat list, unlike WebHighlighter's
 * per-page queue.
 */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => undefined);
  return next;
}

export function saveQuote(input: NewQuoteInput): Promise<SaveOutcome> {
  return mutate(async () => {
    const quotes = await readQuotes();
    const { quotes: next, outcome } = mergeQuote(quotes, input);
    if (next !== quotes) await writeQuotes(next);
    return outcome;
  });
}

export function setQuoteTheme(id: string, themeId: string): Promise<void> {
  return mutate(async () => {
    await writeQuotes(assignTheme(await readQuotes(), id, themeId));
  });
}

export function setQuoteNote(id: string, note: string): Promise<void> {
  return mutate(async () => {
    await writeQuotes(setNote(await readQuotes(), id, note));
  });
}

export function hideQuoteAuthor(id: string): Promise<void> {
  return mutate(async () => {
    await writeQuotes(hideAuthor(await readQuotes(), id));
  });
}

export function deleteQuote(id: string): Promise<void> {
  return mutate(async () => {
    await writeQuotes(removeQuote(await readQuotes(), id));
  });
}

export function addTheme(name: string): Promise<Theme> {
  return mutate(async () => {
    const themes = await readThemes();
    const theme: Theme = { id: newThemeId(), name };
    await writeThemes([...themes, theme]);
    return theme;
  });
}

export function renameThemeById(id: string, name: string): Promise<void> {
  return mutate(async () => {
    await writeThemes(renameTheme(await readThemes(), id, name));
  });
}

export function deleteTheme(id: string): Promise<void> {
  return mutate(async () => {
    const [themes, quotes] = await Promise.all([readThemes(), readQuotes()]);
    const result = removeTheme(themes, quotes, id);
    await Promise.all([writeThemes(result.themes), writeQuotes(result.quotes)]);
  });
}

export async function exportBackup(): Promise<Backup> {
  const [quotes, themes] = await Promise.all([readQuotes(), readThemes()]);
  return buildBackup(quotes, themes);
}

export function importBackup(raw: unknown): Promise<ImportResult> {
  return mutate(async () => {
    const [quotes, themes] = await Promise.all([readQuotes(), readThemes()]);
    const merged = mergeImport(quotes, themes, raw);
    await Promise.all([writeQuotes(merged.quotes), writeThemes(merged.themes)]);
    return merged.result;
  });
}

export function clearAllData(): Promise<void> {
  return mutate(async () => {
    await chrome.storage.local.remove([QUOTES_KEY, THEMES_KEY]);
  });
}

export async function quotaStatus(): Promise<QuotaStatus> {
  let bytes = 0;
  try {
    bytes = await chrome.storage.local.getBytesInUse(null);
  } catch {
    /* not implemented everywhere; treat as empty */
  }
  const ratio = bytes / QUOTA_BYTES;
  return { bytes, ratio, warn: ratio >= WARN_RATIO };
}

export async function readOptions(): Promise<Options> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...DEFAULT_OPTIONS, ...((stored?.[OPTIONS_KEY] as Partial<Options>) ?? {}) };
}

export async function writeOptions(options: Options): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
