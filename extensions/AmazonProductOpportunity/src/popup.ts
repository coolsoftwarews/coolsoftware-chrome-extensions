/**
 * Toolbar popup: the current page's read (for when the in-page strip is out
 * of view), the watchlist across every search/product the user has watched,
 * and the data-ownership surface (export / import / clear).
 *
 * This is an extension page, so — unlike src/content.ts — it can call
 * chrome.downloads directly.
 */

import { buildFilename, buildWatchlistCsv, buildWatchlistMarkdown } from './exporters';
import { describeProductDelta, describeSearchDelta } from './deltas';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  clearAllData,
  exportBackup,
  importBackup,
  listProductWatches,
  listSearchWatches,
  quotaStatus,
  removeProductWatch,
  removeSearchWatch,
} from './storage';
import { CategoryStats, ProductWatch, SearchSnapshot, SearchWatch } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  refresh: $<HTMLButtonElement>('refresh'),
  pageState: $('page-state'),
  watchlist: $('watchlist'),
  exportWatchCsv: $<HTMLButtonElement>('export-watch-csv'),
  exportWatchMd: $<HTMLButtonElement>('export-watch-md'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

function setStatus(message: string): void {
  els.status.textContent = message;
}

function fmt(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits).replace(/\.0+$/, '');
}

/* ── This page ───────────────────────────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function loadPageState(): Promise<void> {
  els.pageState.replaceChildren();
  const tab = await activeTab();

  if (!tab?.id || !tab.url || !/amazon\./i.test(new URL(tab.url).hostname)) {
    const p = document.createElement('p');
    p.className = 'muted state__line';
    p.textContent = 'Open an Amazon search or category page to see its category read here.';
    els.pageState.append(p);
    return;
  }

  try {
    const response = (await chrome.tabs.sendMessage(tab.id, { type: 'APO_GET_SNAPSHOT' })) as
      | { snapshot: SearchSnapshot | null; stats: CategoryStats | null }
      | undefined;

    if (!response?.snapshot || !response.stats) {
      const p = document.createElement('p');
      p.className = 'muted state__line';
      p.textContent = 'No result cards read on this page yet — try a search results page, or reload this tab.';
      els.pageState.append(p);
      return;
    }

    const { snapshot, stats } = response;
    const line1 = document.createElement('p');
    line1.className = 'state__line';
    line1.textContent = `${stats.totalListings} results · median ${fmt(stats.medianReviews)} reviews · median rating ${fmt(stats.medianRating, 1)} · ${stats.distinctBrands} brands`;
    const line2 = document.createElement('p');
    line2.className = 'muted state__line small';
    line2.textContent = `Moat: ${stats.moat} · Ceiling: ${stats.ratingCeiling.label} · Concentration: ${stats.concentration.label}`;
    els.pageState.append(line1, line2);
  } catch {
    const p = document.createElement('p');
    p.className = 'muted state__line';
    p.textContent = 'This tab was open before the extension loaded — reload it to analyze this page.';
    els.pageState.append(p);
  }
}

/* ── Watchlist ───────────────────────────────────────────────────────── */

let searchWatches: SearchWatch[] = [];
let productWatches: ProductWatch[] = [];

async function loadWatchlist(): Promise<void> {
  searchWatches = await listSearchWatches();
  productWatches = await listProductWatches();

  els.watchlist.replaceChildren();

  if (!searchWatches.length && !productWatches.length) {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Nothing watched yet. Use "+ Watch this search" or the ☆ on a listing.';
    els.watchlist.append(p);
    return;
  }

  for (const watch of searchWatches) {
    const item = document.createElement('div');
    item.className = 'watch-item';

    const title = document.createElement('p');
    title.className = 'watch-item__title';
    title.textContent = `🔍 ${watch.query} — ${watch.marketplace}`;
    item.append(title);

    const delta = describeSearchDelta(watch);
    const deltaLine = document.createElement('p');
    deltaLine.className = delta ? 'watch-item__delta' : 'watch-item__delta muted';
    deltaLine.textContent = delta ?? `Watching since ${watch.createdAt.slice(0, 10)} — revisit to see the delta.`;
    item.append(deltaLine);

    item.append(removeButton(() => void removeWatch('search', watch.key)));
    els.watchlist.append(item);
  }

  for (const watch of productWatches) {
    const item = document.createElement('div');
    item.className = 'watch-item';

    const title = document.createElement('p');
    title.className = 'watch-item__title';
    title.title = watch.title;
    title.textContent = `📦 ${watch.title || watch.asin}`;
    item.append(title);

    const delta = describeProductDelta(watch);
    const deltaLine = document.createElement('p');
    deltaLine.className = delta ? 'watch-item__delta' : 'watch-item__delta muted';
    deltaLine.textContent = delta ?? `Watching since ${watch.createdAt.slice(0, 10)} — revisit to see the delta.`;
    item.append(deltaLine);

    item.append(removeButton(() => void removeWatch('product', watch.asin, watch.marketplace)));
    els.watchlist.append(item);
  }
}

function removeButton(onClick: () => void): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'watch-item__actions';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'link-btn';
  btn.textContent = 'Remove';
  btn.addEventListener('click', onClick);
  wrap.append(btn);
  return wrap;
}

async function removeWatch(kind: 'search' | 'product', key: string, marketplace?: string): Promise<void> {
  if (kind === 'search') await removeSearchWatch(key);
  else await removeProductWatch(marketplace ?? '', key);
  void track('watch_removed');
  await loadWatchlist();
}

/* ── Export / data / usage ──────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportWatchlist(format: 'csv' | 'md'): Promise<void> {
  const content = format === 'csv' ? buildWatchlistCsv(searchWatches, productWatches) : buildWatchlistMarkdown(searchWatches, productWatches);
  const type = format === 'csv' ? 'text/csv' : 'text/markdown';
  const filename = buildFilename(['amazon-opportunity-watchlist'], format);
  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), filename);
    void track(format === 'csv' ? 'export_watchlist_csv' : 'export_watchlist_md');
    setStatus(`Saved .${format}`);
  } catch {
    setStatus('Could not save the file.');
  }
}

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and remove some watches.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `amazon-product-opportunity-backup-${stamp}.json`);
    setStatus(`Exported ${backup.searchWatches.length} search + ${backup.productWatches.length} product watches`);
    void track('data_exported');
  } catch {
    setStatus('Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.searches} search + ${result.products} product watches`);
    void track('data_imported');
    await loadWatchlist();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `Searches analyzed: ${metrics.searchesAnalyzed}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void loadPageState());
els.exportWatchCsv.addEventListener('click', () => void exportWatchlist('csv'));
els.exportWatchMd.addEventListener('click', () => void exportWatchlist('md'));

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
  if (!confirm('Remove every watched search and product? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void loadWatchlist();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

void (async () => {
  void track('popup_opened');
  await Promise.all([loadPageState(), loadWatchlist()]);

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from "Data".');
})();
