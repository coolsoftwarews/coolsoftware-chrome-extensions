/**
 * The side panel: the research library. Grouped by theme, searchable across
 * quote/note/subreddit/author (PRD §4), with export and data-ownership
 * controls.
 *
 * Unlike a per-page highlighter panel, this one owns no "which tab am I
 * looking at" state — the saved quotes are a standing library, not a view of
 * the active page — so it reads chrome.storage.local directly and refreshes
 * on chrome.storage.onChanged, which fires in every context (including this
 * one) whenever content.ts saves a quote. No messaging layer needed.
 */

import { buildFilename, groupByTheme, statsBySubreddit, statsByTheme, toCsv, toJson, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  addTheme,
  clearAllData,
  deleteQuote,
  deleteTheme,
  exportBackup,
  hideQuoteAuthor,
  importBackup,
  quotaStatus,
  readOptions,
  readQuotes,
  readThemes,
  renameThemeById,
  setQuoteNote,
  setQuoteTheme,
  writeOptions,
} from './storage';
import { Options, Quote, Theme, UNCATEGORIZED_THEME } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  refresh: $<HTMLButtonElement>('refresh'),
  search: $<HTMLInputElement>('search'),
  stats: $('stats'),
  themeStats: $('theme-stats'),
  subredditStats: $('subreddit-stats'),
  optAnonymize: $<HTMLInputElement>('opt-anonymize'),
  copy: $<HTMLButtonElement>('copy'),
  dlMd: $<HTMLButtonElement>('dl-md'),
  dlCsv: $<HTMLButtonElement>('dl-csv'),
  dlJson: $<HTMLButtonElement>('dl-json'),
  state: $('state'),
  groups: $('groups'),
  status: $('status'),

  themes: $<HTMLDialogElement>('themes'),
  themesToggle: $<HTMLButtonElement>('themes-toggle'),
  themesList: $('themes-list'),
  themeNew: $<HTMLInputElement>('theme-new'),
  themeAdd: $<HTMLButtonElement>('theme-add'),
  themesClose: $<HTMLButtonElement>('themes-close'),

  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),

  usage: $<HTMLDialogElement>('usage'),
  usageToggle: $<HTMLButtonElement>('usage-toggle'),
  usageBody: $('usage-body'),
  usageClear: $<HTMLButtonElement>('usage-clear'),
  usageClose: $<HTMLButtonElement>('usage-close'),
};

let quotes: Quote[] = [];
let themes: Theme[] = [];
let options: Options = { anonymizeByDefault: false };
let search = '';

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function loadAll(): Promise<void> {
  [quotes, themes, options] = await Promise.all([readQuotes(), readThemes(), readOptions()]);
  els.optAnonymize.checked = options.anonymizeByDefault;
  render();
  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
}

/* ── Filtering + rendering ──────────────────────────────────────────── */

function matches(quote: Quote, query: string): boolean {
  if (!query) return true;
  const haystack = `${quote.quote} ${quote.note} ${quote.subreddit} ${quote.author} ${quote.threadTitle}`.toLowerCase();
  return haystack.includes(query);
}

function render(): void {
  const query = search.trim().toLowerCase();
  const filtered = quotes.filter(q => matches(q, query));

  els.summary.textContent = quotes.length
    ? `${quotes.length} quote${quotes.length === 1 ? '' : 's'} · ${themes.length} theme${themes.length === 1 ? '' : 's'}`
    : '';

  renderStats();

  if (!quotes.length) {
    showEmpty('Select text on a Reddit post or comment, then click “+ Save quote”. Saved quotes show up here, grouped by theme.');
    return;
  }
  if (!filtered.length) {
    showEmpty(`No quotes match “${search.trim()}”.`);
    return;
  }

  els.state.hidden = true;
  els.groups.hidden = false;
  els.groups.replaceChildren();

  for (const group of groupByTheme(filtered, themes)) {
    els.groups.appendChild(renderGroup(group.theme, group.quotes));
  }

  setStatus(`Showing ${filtered.length} of ${quotes.length} quote${quotes.length === 1 ? '' : 's'}`);
}

function showEmpty(message: string): void {
  els.groups.hidden = true;
  els.state.hidden = false;
  els.state.className = 'state';
  els.state.replaceChildren();
  const text = document.createElement('p');
  text.className = 'state__text';
  text.textContent = message;
  els.state.append(text);
  setStatus('');
}

function renderStats(): void {
  if (!quotes.length) {
    els.stats.hidden = true;
    return;
  }
  els.stats.hidden = false;

  els.themeStats.replaceChildren();
  for (const stat of statsByTheme(quotes, themes)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${stat.count} ${stat.name.toLowerCase()}`;
    chip.addEventListener('click', () => {
      document.getElementById(`group-${stat.id || 'uncategorized'}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    els.themeStats.appendChild(chip);
  }

  els.subredditStats.replaceChildren();
  for (const stat of statsBySubreddit(quotes).slice(0, 6)) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = `${stat.count} from ${stat.subreddit}`;
    chip.addEventListener('click', () => {
      els.search.value = stat.subreddit;
      search = stat.subreddit;
      void track('search_used');
      render();
    });
    els.subredditStats.appendChild(chip);
  }
}

function renderGroup(theme: Theme, groupQuotes: Quote[]): HTMLElement {
  const section = document.createElement('section');
  section.id = `group-${theme.id || 'uncategorized'}`;

  const header = document.createElement('h2');
  header.className = 'group__header';
  header.textContent = theme.name;
  const count = document.createElement('span');
  count.className = 'group__count';
  count.textContent = `(${groupQuotes.length})`;
  header.appendChild(count);
  section.appendChild(header);

  const list = document.createElement('ol');
  list.className = 'group__list';
  for (const quote of groupQuotes) list.appendChild(renderCard(quote));
  section.appendChild(list);

  return section;
}

function renderCard(quote: Quote): HTMLElement {
  const item = document.createElement('li');
  item.className = 'item';

  const text = document.createElement('p');
  text.className = 'item__quote';
  text.textContent = quote.quote;
  text.title = 'Click to expand or collapse';
  text.addEventListener('click', () => text.classList.toggle('item__quote--full'));
  item.appendChild(text);

  const meta = document.createElement('p');
  meta.className = 'item__meta';
  const who = quote.author ? `u/${quote.author}` : 'anonymous';
  const when = quote.postedAt ? new Date(quote.postedAt).toLocaleDateString() : '';
  const scoreText = quote.score === null ? '' : ` · ${quote.score} pts`;
  const metaBits = [who, quote.subreddit, when].filter(Boolean).join(' · ') + scoreText;
  meta.textContent = metaBits;
  if (quote.permalink) {
    meta.appendChild(document.createTextNode(' · '));
    const link = document.createElement('a');
    link.href = quote.permalink;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open thread ↗';
    link.addEventListener('click', () => void track('permalink_opened'));
    meta.appendChild(link);
  }
  item.appendChild(meta);

  if (quote.note.trim()) {
    const note = document.createElement('p');
    note.className = 'item__note';
    note.textContent = quote.note;
    item.appendChild(note);
  }

  const editor = document.createElement('textarea');
  editor.className = 'item__note-edit';
  editor.rows = 2;
  editor.value = quote.note;
  editor.placeholder = 'Note on this quote…';
  editor.addEventListener('blur', () => {
    if (editor.value === quote.note) return;
    void setQuoteNote(quote.id, editor.value).then(() => {
      if (editor.value.trim()) void track('note_added');
      void loadAll();
    });
  });

  const actions = document.createElement('div');
  actions.className = 'item__actions';

  const themeSelect = document.createElement('select');
  themeSelect.className = 'item__theme';
  themeSelect.setAttribute('aria-label', 'Theme');
  const uncategorizedOption = document.createElement('option');
  uncategorizedOption.value = UNCATEGORIZED_THEME.id;
  uncategorizedOption.textContent = UNCATEGORIZED_THEME.name;
  themeSelect.appendChild(uncategorizedOption);
  for (const theme of themes) {
    const option = document.createElement('option');
    option.value = theme.id;
    option.textContent = theme.name;
    themeSelect.appendChild(option);
  }
  themeSelect.value = themes.some(t => t.id === quote.themeId) ? quote.themeId : '';
  themeSelect.addEventListener('change', () => {
    void setQuoteTheme(quote.id, themeSelect.value).then(() => {
      void track('theme_assigned');
      void loadAll();
    });
  });
  actions.appendChild(themeSelect);

  const noteButton = document.createElement('button');
  noteButton.type = 'button';
  noteButton.className = 'link-btn';
  noteButton.textContent = quote.note.trim() ? 'Edit note' : 'Add note';
  noteButton.addEventListener('click', () => {
    editor.classList.toggle('item__note-edit--open');
    editor.focus();
  });
  actions.appendChild(noteButton);

  if (quote.author && !quote.anonymized) {
    const hideButton = document.createElement('button');
    hideButton.type = 'button';
    hideButton.className = 'link-btn';
    hideButton.textContent = 'Hide author';
    hideButton.title = 'Remove the username from this saved quote';
    hideButton.addEventListener('click', () => {
      void hideQuoteAuthor(quote.id).then(() => {
        void track('author_hidden');
        void loadAll();
      });
    });
    actions.appendChild(hideButton);
  }

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'link-btn';
  deleteButton.textContent = 'Delete';
  deleteButton.style.marginLeft = 'auto';
  deleteButton.addEventListener('click', () => {
    void deleteQuote(quote.id).then(() => {
      void track('quote_deleted');
      void loadAll();
    });
  });
  actions.appendChild(deleteButton);

  item.appendChild(actions);
  item.appendChild(editor);
  return item;
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Revoke late: Chrome reads the blob asynchronously after download() resolves.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportAs(kind: 'md' | 'csv' | 'json'): Promise<void> {
  const content = kind === 'md' ? toMarkdown(quotes, themes) : kind === 'csv' ? toCsv(quotes, themes) : toJson(quotes, themes);
  const type = kind === 'md' ? 'text/markdown' : kind === 'csv' ? 'text/csv' : 'application/json';
  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename(kind));
    setStatus(`Saved .${kind}`);
    void track(kind === 'md' ? 'export_md' : kind === 'csv' ? 'export_csv' : 'export_json');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${kind} file.`);
  }
}

async function copyMarkdown(): Promise<void> {
  try {
    await navigator.clipboard.writeText(toMarkdown(quotes, themes));
    setStatus('Copied as Markdown');
    void track('copy_markdown');
  } catch {
    setStatus('Clipboard access was blocked.');
  }
}

/* ── Data ownership ─────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some quotes.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `reddit-voice-of-customer-backup-${stamp}.json`);
    setStatus(`Exported ${backup.quotes.length} quote${backup.quotes.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.quotes} quote${result.quotes === 1 ? '' : 's'} and ${result.themes} theme${result.themes === 1 ? '' : 's'}`);
    void track('data_imported');
    await loadAll();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Themes sheet ────────────────────────────────────────────────────── */

function renderThemesList(): void {
  els.themesList.replaceChildren();
  for (const theme of themes) {
    const row = document.createElement('div');
    row.className = 'theme-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = theme.name;
    input.addEventListener('blur', () => {
      if (!input.value.trim() || input.value === theme.name) {
        input.value = theme.name;
        return;
      }
      void renameThemeById(theme.id, input.value.trim()).then(() => {
        void track('theme_renamed');
        void loadAll().then(renderThemesList);
      });
    });
    row.appendChild(input);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-btn';
    remove.textContent = 'Delete';
    remove.addEventListener('click', () => {
      if (!confirm(`Delete "${theme.name}"? Its quotes move to Uncategorized.`)) return;
      void deleteTheme(theme.id).then(() => {
        void track('theme_deleted');
        void loadAll().then(renderThemesList);
      });
    });
    row.appendChild(remove);

    els.themesList.appendChild(row);
  }
}

/* ── Usage sheet ─────────────────────────────────────────────────────── */

async function openUsage(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.usageBody.textContent = lines.join('\n');
  els.usage.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void loadAll());

let searchTimer: number | undefined;
els.search.addEventListener('input', () => {
  search = els.search.value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    render();
    if (search.trim()) void track('search_used');
  }, 60);
});

els.optAnonymize.addEventListener('change', () => {
  options = { ...options, anonymizeByDefault: els.optAnonymize.checked };
  void writeOptions(options);
  void track('anonymize_toggled');
});

els.copy.addEventListener('click', () => void copyMarkdown());
els.dlMd.addEventListener('click', () => void exportAs('md'));
els.dlCsv.addEventListener('click', () => void exportAs('csv'));
els.dlJson.addEventListener('click', () => void exportAs('json'));

els.themesToggle.addEventListener('click', () => {
  renderThemesList();
  els.themes.showModal();
});
els.themesClose.addEventListener('click', () => els.themes.close());
els.themeAdd.addEventListener('click', () => {
  const name = els.themeNew.value.trim();
  if (!name) return;
  void addTheme(name).then(() => {
    els.themeNew.value = '';
    void track('theme_created');
    void loadAll().then(renderThemesList);
  });
});

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());
els.dataExport.addEventListener('click', () => void exportAllData());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every saved quote and theme? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void loadAll();
  });
});

els.usageToggle.addEventListener('click', () => void openUsage());
els.usageClose.addEventListener('click', () => els.usage.close());
els.usageClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.usageBody.textContent = 'Counters reset.';
  });
});

// content.ts and this panel never message each other directly — both write to
// chrome.storage.local, and this fires in every context when either does.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['rvoc:quotes'] || changes['rvoc:themes']) void loadAll();
});

void (async () => {
  void track('panel_opened');
  await loadAll();
})();
