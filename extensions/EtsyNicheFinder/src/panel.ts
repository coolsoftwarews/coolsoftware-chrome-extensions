/**
 * The popup: status of the page you're on, the library of niches you've
 * saved, and the data-ownership surface (export all / import / clear all —
 * the hard constraint every product that stores anything has to meet).
 *
 * The popup owns no listing state of its own — the content script is the
 * single writer for a page's read, same discipline as WebHighlighter's panel.
 */

import { clearMetrics, distinctQueriesAnalyzed, readMetrics, track } from './metrics';
import {
  clearAllData,
  deleteSnapshotRecord,
  exportBackup,
  importBackup,
  quotaStatus,
  readAllSnapshotSummaries,
  SnapshotSummary,
} from './storage';
import { ContentState } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  meta: $('page-meta'),
  refresh: $<HTMLButtonElement>('refresh'),
  pageState: $('page-state'),
  pageControls: $('page-controls'),
  pageSummary: $('page-summary'),
  pageDelta: $('page-delta'),
  saveSnapshot: $<HTMLButtonElement>('save-snapshot'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  pageStatus: $('page-status'),
  snapshotCount: $('snapshot-count'),
  snapshotList: $<HTMLUListElement>('snapshot-list'),
  snapshotEmpty: $('snapshot-empty'),
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

let tabId: number | null = null;

function setStatus(message: string): void {
  els.pageStatus.textContent = message;
}

function money(currency: string, value: number | null): string {
  if (value === null) return '—';
  return `${currency}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

/* ── Talking to the content script ──────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask<T>(message: unknown): Promise<T | null> {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    // No content script here: not an Etsy tab, or the tab predates install.
    return null;
  }
}

/**
 * The empty/gate state, shared shape with the other extensions in this
 * portfolio: a sentence, as plainly as possible, and nothing that looks like
 * an error when nothing has actually gone wrong.
 */
function showGate(message: string): void {
  els.pageControls.hidden = true;
  els.pageState.hidden = false;
  els.pageState.querySelector('.state__text')!.textContent = message;
}

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;

  if (!tab?.url || !/(^|\.)etsy\.com$/i.test(new URL(tab.url).hostname)) {
    els.meta.textContent = '';
    showGate('Open an Etsy search or category page to see the niche read here.');
    return;
  }

  const state = await ask<ContentState>({ type: 'ENF_GET_STATE' });
  if (!state) {
    els.meta.textContent = '';
    showGate('This tab was open before the extension was installed or updated — reload it to load the reader.');
    return;
  }

  if (!state.supported || !state.stats || !state.context) {
    els.meta.textContent = '';
    showGate(state.reason ?? 'Not a search or category results page with a readable listing grid.');
    return;
  }

  els.meta.textContent = state.context.query;
  els.pageState.hidden = true;
  els.pageControls.hidden = false;

  const { stats } = state;
  const kind = stats.medianCountKind === 'sales' ? 'sales' : stats.medianCountKind === 'reviews' ? 'reviews' : 'sales/reviews';
  els.pageSummary.textContent =
    `${stats.organicListings} listings · ${stats.distinctShops} shops\n` +
    `median ${stats.medianCount ?? '—'} ${kind} · median price ${money(stats.currency, stats.medianPrice)}\n` +
    `top 3 shops hold ${stats.top3Pct === null ? '—' : Math.round(stats.top3Pct)}% · ` +
    `price band ${money(stats.currency, stats.priceBandLow)}–${money(stats.currency, stats.priceBandHigh)}\n` +
    `from ${stats.samplePages} page(s), ${stats.sampleListings} listings (${stats.adListings} ads excluded) · showing ${state.filteredCount} after filters`;

  els.pageDelta.textContent = state.delta
    ? `Since last save: ${describeDeltaFallback(state)}`
    : 'No saved snapshot for this query yet.';
}

function describeDeltaFallback(state: ContentState): string {
  // The content script already formats this precisely (stats.ts); the popup
  // only needs a short version when it has a delta and no formatter import
  // is worth adding for one line.
  const d = state.delta!;
  if (d.countKindChanged) return 'sales/reviews label changed — not comparable';
  const parts: string[] = [];
  if (d.medianCountDelta !== null) parts.push(`median ${d.medianCountDelta > 0 ? '+' : ''}${d.medianCountDelta}`);
  if (d.medianPriceDelta !== null) parts.push(`price ${d.medianPriceDelta > 0 ? '+' : ''}${d.medianPriceDelta}`);
  if (d.top3PctDelta !== null) parts.push(`top-3 ${d.top3PctDelta > 0 ? '+' : ''}${d.top3PctDelta}pp`);
  return parts.length ? parts.join(' · ') : 'no comparable change';
}

async function handleSave(): Promise<void> {
  const result = await ask<ContentState>({ type: 'ENF_SAVE_SNAPSHOT' });
  if (result) {
    setStatus('Niche saved.');
    void refreshSnapshots();
    await refresh();
  } else {
    setStatus('Could not save — reload the Etsy tab and try again.');
  }
}

async function handleExport(format: 'csv' | 'md'): Promise<void> {
  const result = await ask<{ ok: boolean }>({ type: 'ENF_EXPORT', format });
  setStatus(result?.ok ? `Saved .${format}` : `Could not save the .${format} file.`);
}

/* ── Saved niches ────────────────────────────────────────────────────── */

async function refreshSnapshots(): Promise<void> {
  const summaries = await readAllSnapshotSummaries();
  els.snapshotCount.textContent = summaries.length ? `${summaries.length}` : '';
  els.snapshotEmpty.hidden = summaries.length > 0;
  els.snapshotList.replaceChildren();

  for (const summary of summaries) {
    els.snapshotList.appendChild(renderSnapshotItem(summary));
  }
}

function renderSnapshotItem(summary: SnapshotSummary): HTMLLIElement {
  const item = document.createElement('li');
  item.className = 'item';

  const info = document.createElement('div');
  info.className = 'item__info';
  const query = document.createElement('p');
  query.className = 'item__query';
  query.textContent = summary.query;
  query.title = summary.query;
  const meta = document.createElement('p');
  meta.className = 'item__meta';
  meta.textContent = `${summary.count} save${summary.count === 1 ? '' : 's'} · last ${new Date(summary.savedAt).toLocaleDateString()}`;
  info.append(query, meta);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link-btn';
  remove.textContent = 'Delete';
  remove.addEventListener('click', () => {
    if (!confirm(`Delete the saved history for "${summary.query}"?`)) return;
    void deleteSnapshotRecord(summary.queryKey).then(() => refreshSnapshots());
  });

  item.append(info, remove);
  return item;
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function download(content: string, mime: string, filename: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some niches.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(JSON.stringify(backup, null, 2), 'application/json', `etsy-niche-finder-backup-${stamp}.json`);
    setStatus(`Exported ${backup.snapshots.length} saved niche${backup.snapshots.length === 1 ? '' : 's'}.`);
    void track('data_exported');
  } catch (error: unknown) {
    setStatus(error instanceof Error ? error.message : 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.snapshots} snapshot(s) across ${result.queries} quer${result.queries === 1 ? 'y' : 'ies'}.`);
    void track('data_imported');
    await refreshSnapshots();
  } catch (error: unknown) {
    setStatus(error instanceof Error ? error.message : 'That file could not be read.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `Distinct searches analysed: ${distinctQueriesAnalyzed(metrics)}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void refresh());
els.saveSnapshot.addEventListener('click', () => void handleSave());
els.exportCsv.addEventListener('click', () => void handleExport('csv'));
els.exportMd.addEventListener('click', () => void handleExport('md'));

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
  if (!confirm('Delete every saved niche? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void refreshSnapshots();
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
  await refresh();
  await refreshSnapshots();
})();
