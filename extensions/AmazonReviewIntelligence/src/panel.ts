/**
 * The popup: this product's recurring themes, filters, evidence, note and
 * exports, plus the data-ownership surface (export / import / clear).
 *
 * The panel owns no review data of its own — content.ts is the single writer
 * of a product's record, and this file only reads chrome.storage.local and
 * re-derives everything from it. That keeps two writers from racing over one
 * storage key, same pattern as WebHighlighter.
 */

import { analyze, applyFilters, summarize } from './analyze';
import { themeKey, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, track, trackAnalyzed } from './metrics';
import { buildFilename } from './parse';
import {
  clearAllData,
  clearAsin,
  exportBackup,
  importBackup,
  previousSnapshot,
  quotaStatus,
  readAsin,
  readFilters,
  recordSnapshot,
  setNote,
  writeFilters,
} from './storage';
import { AnalysisResult, AsinRecord, DEFAULT_FILTERS, Filters, PageContext, Review, ThemeCluster } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  title: $('page-title'),
  meta: $('page-meta'),
  refresh: $<HTMLButtonElement>('refresh'),
  state: $('state'),
  body: $('body'),
  summaryLine: $('summary-line'),
  moreHint: $('more-hint'),
  filtersToggle: $<HTMLButtonElement>('filters-toggle'),
  filtersBody: $('filters-body'),
  filtersClear: $<HTMLButtonElement>('filters-clear'),
  langSelect: $<HTMLSelectElement>('lang-select'),
  fStar: $<HTMLSelectElement>('f-star'),
  fVerified: $<HTMLInputElement>('f-verified'),
  fKeyword: $<HTMLInputElement>('f-keyword'),
  fDateFrom: $<HTMLInputElement>('f-date-from'),
  fDateTo: $<HTMLInputElement>('f-date-to'),
  negativeNote: $('negative-note'),
  negativeList: $<HTMLOListElement>('negative-list'),
  praiseNote: $('praise-note'),
  praiseList: $<HTMLOListElement>('praise-list'),
  note: $<HTMLTextAreaElement>('note'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  productClear: $<HTMLButtonElement>('product-clear'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

const EVIDENCE_CAP = 15;

let context: PageContext | null = null;
let record: AsinRecord | null = null;
let filters: Filters = { ...DEFAULT_FILTERS };
let selectedLanguage: string | null = null;
let unfilteredResults: AnalysisResult[] = [];

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(message: string): void {
  els.state.hidden = false;
  els.state.replaceChildren();
  const p = document.createElement('p');
  p.className = 'state__text';
  p.textContent = message;
  els.state.appendChild(p);
  els.body.hidden = true;
}

function showBody(): void {
  els.state.hidden = true;
  els.body.hidden = false;
}

/* ── Talking to the content script ───────────────────────────────────── */

let tabId: number | null = null;

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask<T>(message: unknown): Promise<T | null> {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

/* ── Loading and rendering ───────────────────────────────────────────── */

function filtersActive(): boolean {
  return (
    filters.starBand !== 0 || filters.verifiedOnly || Boolean(filters.keyword.trim()) || Boolean(filters.dateFrom) || Boolean(filters.dateTo)
  );
}

function reviewsById(): Map<string, Review> {
  return new Map((record?.reviews ?? []).map(r => [r.id, r]));
}

function groupByLanguage(results: AnalysisResult[]): Map<string, { negative?: AnalysisResult; praise?: AnalysisResult }> {
  const grouped = new Map<string, { negative?: AnalysisResult; praise?: AnalysisResult }>();
  for (const result of results) {
    const entry = grouped.get(result.language) ?? {};
    entry[result.band] = result;
    grouped.set(result.language, entry);
  }
  return grouped;
}

const LANGUAGE_LABELS: Record<string, string> = {
  latin: 'Latin script',
  cyrillic: 'Cyrillic',
  cjk: 'CJK',
  arabic: 'Arabic',
  hangul: 'Hangul',
  greek: 'Greek',
  hebrew: 'Hebrew',
  other: 'Other',
};

async function load(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;

  const ctx = await ask<PageContext>({ type: 'ARI_GET_CONTEXT' });
  if (!ctx) {
    els.title.textContent = 'Amazon Review Intelligence';
    els.meta.textContent = '';
    showState('Reload this tab if it was open before the extension was installed, then reopen this panel.');
    return;
  }
  context = ctx;

  if (!ctx.supported || !ctx.asin) {
    els.title.textContent = 'Amazon Review Intelligence';
    els.meta.textContent = '';
    showState(ctx.unsupportedReason || 'Open a product page or its reviews on Amazon to get started.');
    return;
  }

  // Make sure storage has whatever is rendered on the page right now.
  await ask({ type: 'ARI_RESCAN' });

  record = await readAsin(ctx.asin);
  els.title.textContent = ctx.productTitle || record?.productTitle || 'Untitled product';
  els.meta.textContent = [ctx.asin, ctx.domain].filter(Boolean).join(' · ');

  if (!record || !record.reviews.length) {
    showState('No reviews were found on this page yet. Scroll down to the reviews section, or open the full reviews page.');
    return;
  }

  if (document.activeElement !== els.note) els.note.value = record.note;

  showBody();
  render();
}

function render(): void {
  if (!record || !context) return;

  const filtered = applyFilters(record.reviews, filters);
  const summary = summarize(filtered);
  const results = analyze(filtered);
  unfilteredResults = analyze(record.reviews);

  els.summaryLine.textContent =
    `${summary.totalReviews} review${summary.totalReviews === 1 ? '' : 's'} read` +
    (filtered.length !== record.reviews.length ? ` (${record.reviews.length} total, filtered)` : '') +
    `  ·  ${summary.negativeCount} negative (1–2★)`;
  els.moreHint.hidden = !context.hasMorePages;
  if (context.hasMorePages) {
    els.moreHint.textContent = 'Scroll or open more review pages on Amazon to include them.';
  }

  const grouped = groupByLanguage(results);
  const languages = [...grouped.keys()];
  if (!selectedLanguage || !grouped.has(selectedLanguage)) selectedLanguage = languages[0] ?? null;

  els.langSelect.hidden = languages.length <= 1;
  if (languages.length > 1) {
    els.langSelect.replaceChildren(
      ...languages.map(lang => {
        const opt = document.createElement('option');
        opt.value = lang;
        opt.textContent = LANGUAGE_LABELS[lang] ?? lang;
        opt.selected = lang === selectedLanguage;
        return opt;
      }),
    );
  }

  const active = selectedLanguage ? grouped.get(selectedLanguage) : undefined;
  const previous = filtersActive() ? null : previousSnapshot(record);

  renderThemeSection('negative', active?.negative, els.negativeNote, els.negativeList, previous);
  renderThemeSection('praise', active?.praise, els.praiseNote, els.praiseList, previous);

  // Snapshot the *unfiltered* view once per day so re-running later shows deltas.
  const primaryLanguage = unfilteredResults[0]?.language;
  if (primaryLanguage) {
    const unfilteredGrouped = groupByLanguage(unfilteredResults);
    const primary = unfilteredGrouped.get(primaryLanguage);
    const themeCounts: Record<string, number> = {};
    for (const theme of [...(primary?.negative?.themes ?? []), ...(primary?.praise?.themes ?? [])]) {
      themeCounts[themeKey(theme)] = theme.count;
    }
    if (Object.keys(themeCounts).length) {
      const asin = context.asin!;
      void recordSnapshot(asin, { totalReviews: record.reviews.length, negativeCount: summarize(record.reviews).negativeCount, themeCounts });
      void trackAnalyzed(asin);
    }
  }
  void track('analysis_viewed');
}

function renderThemeSection(
  band: 'negative' | 'praise',
  result: AnalysisResult | undefined,
  noteEl: HTMLElement,
  listEl: HTMLOListElement,
  previous: ReturnType<typeof previousSnapshot>,
): void {
  listEl.replaceChildren();

  if (!result || result.insufficient) {
    noteEl.hidden = false;
    noteEl.textContent = result
      ? `Not enough ${band === 'negative' ? 'negative' : 'positive'} reviews yet (${result.reviewsInBand}) to cluster reliably — 20+ needed.`
      : 'No reviews in this language yet.';
    return;
  }

  if (!result.themes.length) {
    noteEl.hidden = false;
    noteEl.textContent = 'Nothing recurred often enough to call a theme.';
    return;
  }

  noteEl.hidden = true;
  const byId = reviewsById();

  for (const theme of result.themes) {
    listEl.appendChild(renderThemeRow(theme, band, byId, previous));
  }
}

function renderThemeRow(
  theme: ThemeCluster,
  band: 'negative' | 'praise',
  byId: Map<string, Review>,
  previous: ReturnType<typeof previousSnapshot>,
): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `theme theme--${band}`;

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'theme__row';
  row.setAttribute('aria-expanded', 'false');

  const label = document.createElement('span');
  label.className = 'theme__label';
  label.textContent = theme.label;

  const count = document.createElement('span');
  count.className = 'theme__count';
  const before = previous?.themeCounts[themeKey(theme)];
  count.textContent = `${theme.count} mention${theme.count === 1 ? '' : 's'}`;
  if (before !== undefined && before !== theme.count) {
    const delta = document.createElement('span');
    delta.className = 'theme__delta';
    delta.textContent = ` (${theme.count > before ? 'up' : 'down'} from ${before})`;
    count.appendChild(delta);
  }

  row.append(label, count);

  const evidence = document.createElement('ul');
  evidence.className = 'theme__evidence';
  evidence.hidden = true;

  row.addEventListener('click', () => {
    const open = evidence.hidden;
    evidence.hidden = !open;
    row.setAttribute('aria-expanded', String(open));
    if (open && !evidence.childElementCount) {
      renderEvidence(evidence, theme, byId);
      void track('theme_expanded');
    }
  });

  li.append(row, evidence);
  return li;
}

function renderEvidence(container: HTMLUListElement, theme: ThemeCluster, byId: Map<string, Review>): void {
  const reviews = theme.reviewIds.map(id => byId.get(id)).filter((r): r is Review => Boolean(r));
  const shown = reviews.slice(0, EVIDENCE_CAP);

  for (const review of shown) {
    const li = document.createElement('li');
    li.className = 'evidence';

    const meta = document.createElement('p');
    meta.className = 'evidence__meta';
    meta.textContent = [
      `${review.rating}★`,
      review.verified ? 'Verified' : 'Unverified',
      review.variation || null,
      review.dateIso || review.dateRaw || null,
    ]
      .filter(Boolean)
      .join(' · ');

    const text = document.createElement('p');
    text.className = 'evidence__text';
    text.textContent = review.text || review.title || '(no text — image/video review)';

    li.append(meta, text);
    container.appendChild(li);
  }

  if (reviews.length > shown.length) {
    const more = document.createElement('li');
    more.className = 'evidence__more';
    const p = document.createElement('p');
    p.className = 'evidence__more';
    p.textContent = `+ ${reviews.length - shown.length} more — see the CSV or Markdown export for the full list.`;
    more.appendChild(p);
    container.appendChild(more);
  }
}

/* ── Filters ──────────────────────────────────────────────────────────── */

function syncFilterInputs(): void {
  els.fStar.value = String(filters.starBand);
  els.fVerified.checked = filters.verifiedOnly;
  els.fKeyword.value = filters.keyword;
  els.fDateFrom.value = filters.dateFrom;
  els.fDateTo.value = filters.dateTo;
}

let keywordDebounce: number | undefined;

function bindFilters(): void {
  els.filtersToggle.addEventListener('click', () => {
    const open = els.filtersBody.hidden;
    els.filtersBody.hidden = !open;
    els.filtersToggle.setAttribute('aria-expanded', String(open));
  });

  els.fStar.addEventListener('change', () => {
    filters = { ...filters, starBand: Number(els.fStar.value) as Filters['starBand'] };
    void writeFilters(filters);
    void track('filter_applied');
    render();
  });
  els.fVerified.addEventListener('change', () => {
    filters = { ...filters, verifiedOnly: els.fVerified.checked };
    void writeFilters(filters);
    void track('filter_applied');
    render();
  });
  els.fKeyword.addEventListener('input', () => {
    window.clearTimeout(keywordDebounce);
    keywordDebounce = window.setTimeout(() => {
      filters = { ...filters, keyword: els.fKeyword.value };
      void writeFilters(filters);
      void track('filter_applied');
      render();
    }, 250);
  });
  els.fDateFrom.addEventListener('change', () => {
    filters = { ...filters, dateFrom: els.fDateFrom.value };
    void writeFilters(filters);
    void track('filter_applied');
    render();
  });
  els.fDateTo.addEventListener('change', () => {
    filters = { ...filters, dateTo: els.fDateTo.value };
    void writeFilters(filters);
    void track('filter_applied');
    render();
  });
  els.filtersClear.addEventListener('click', () => {
    filters = { ...DEFAULT_FILTERS };
    syncFilterInputs();
    void writeFilters(filters);
    render();
  });

  els.langSelect.addEventListener('change', () => {
    selectedLanguage = els.langSelect.value;
    render();
  });
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function currentFilteredResults(): AnalysisResult[] {
  if (!record) return [];
  return analyze(applyFilters(record.reviews, filters));
}

async function exportCsv(): Promise<void> {
  if (!record || !context) return;
  const results = currentFilteredResults();
  const csv = toCsv(results, reviewsById());
  await download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), buildFilename(record.productTitle, record.asin, 'csv'));
  setStatus('Saved .csv');
  void track('export_csv');
}

async function exportMd(): Promise<void> {
  if (!record || !context) return;
  const filtered = applyFilters(record.reviews, filters);
  const summary = summarize(filtered);
  const results = currentFilteredResults();
  const previous = filtersActive() ? null : previousSnapshot(record);

  const md = toMarkdown({
    asin: record.asin,
    productTitle: record.productTitle,
    productUrl: record.productUrl,
    domain: record.domain,
    totalReviews: summary.totalReviews,
    negativeCount: summary.negativeCount,
    positiveCount: summary.positiveCount,
    hasMorePages: context.hasMorePages,
    note: record.note,
    results,
    reviewsById: reviewsById(),
    previousSnapshot: previous,
    generatedAt: new Date().toISOString().slice(0, 10),
  });

  await download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), buildFilename(record.productTitle, record.asin, 'md'));
  setStatus('Saved .md');
  void track('export_md');
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some products.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `amazon-review-intelligence-backup-${stamp}.json`);
    setStatus(`Exported ${backup.products.length} product${backup.products.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.reviews} review${result.reviews === 1 ? '' : 's'} across ${result.products} product${result.products === 1 ? '' : 's'}`);
    void track('data_imported');
    await load();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `Products analysed: ${metrics.asinsAnalyzed.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void load());
els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportMd.addEventListener('click', () => void exportMd());

els.note.addEventListener('blur', () => {
  if (!record || !context?.asin || els.note.value === record.note) return;
  record.note = els.note.value;
  void setNote(context.asin, els.note.value).then(() => void track('note_saved'));
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

els.productClear.addEventListener('click', () => {
  if (!context?.asin) return;
  if (!confirm('Remove every stored review and note for this product?')) return;
  void clearAsin(context.asin).then(() => {
    els.data.close();
    void load();
  });
});

els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every product analysed so far? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void track('data_cleared');
    void load();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

bindFilters();

void (async () => {
  filters = await readFilters(DEFAULT_FILTERS);
  syncFilterInputs();
  void track('panel_opened');
  await load();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
})();
