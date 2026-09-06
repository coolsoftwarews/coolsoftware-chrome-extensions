/**
 * The side panel: sort controls, "load full playlist", the time-budget quick
 * filter, the table, and the data-ownership surface.
 *
 * The panel owns no playlist data of its own — the content script is the
 * single reader of the live page, and the panel asks it for the current
 * picture ("ask") whenever the active tab changes, plus listens for pushed
 * updates ("PLS_STATE") for the things that happen without the user doing
 * anything here: YouTube lazy-loading more rows, and auto-scroll progress.
 * Same shape as this portfolio's other panel/content pairs (WebHighlighter's
 * refresh()/ask()), extended with a sender-filtered broadcast listener since
 * this product's scan can be a multi-second background operation.
 */

import { greedyPackToFit, PackResult } from '../pack';
import { formatDuration } from '../parse';
import { sortRows } from '../sort';
import { toCsv, toMarkdown, buildFilename } from '../exporters';
import { clearAllData, exportBackup, importBackup, readPrefs, writePrefs } from '../storage';
import { clearMetrics, readMetrics, track } from '../metrics';
import { ContentToPanel, PlaylistRow, ScanState, SortKey, emptyScanState } from '../types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  title: $('playlist-title'),
  sub: $('playlist-sub'),
  refresh: $<HTMLButtonElement>('refresh'),
  emptyState: $('empty-state'),
  emptyText: $('empty-text'),
  errorState: $('error-state'),
  errorRetry: $<HTMLButtonElement>('error-retry'),
  controls: $('controls'),
  sortKey: $<HTMLSelectElement>('sort-key'),
  loadFull: $<HTMLButtonElement>('load-full'),
  loadCancel: $<HTMLButtonElement>('load-cancel'),
  loadProgress: $('load-progress'),
  loadedCount: $('loaded-count'),
  statedTotal: $('stated-total'),
  notice: $('notice'),
  budgetMinutes: $<HTMLInputElement>('budget-minutes'),
  budgetApply: $<HTMLButtonElement>('budget-apply'),
  budgetClear: $<HTMLButtonElement>('budget-clear'),
  budgetSummary: $('budget-summary'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  body: $('body'),
  listEmpty: $('list-empty'),
  list: $<HTMLTableElement>('list'),
  listBody: $('list-body'),
  status: $('status'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  data: $<HTMLDialogElement>('data'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  stats: $<HTMLDialogElement>('stats'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let tabId: number | null = null;
let current: ScanState = emptyScanState();
let sortKey: SortKey = 'custom';
let budgetMinutes: number | null = null;
let packResult: PackResult | null = null;

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Talking to the tab ─────────────────────────────────────────────── */

function looksLikeYouTubeTab(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith('youtube.com');
  } catch {
    return false;
  }
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask(message: unknown): Promise<ContentToPanel | null> {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as ContentToPanel;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;

  if (!tab || !looksLikeYouTubeTab(tab.url)) {
    setEmpty('Open a YouTube playlist page (a URL like youtube.com/playlist?list=...) to use this panel.');
    return;
  }

  const response = await ask({ type: 'PLS_GET_STATE' });
  if (!response) {
    showError();
    return;
  }
  setState(response.state);
}

function setEmpty(message: string): void {
  current = emptyScanState();
  els.title.textContent = 'Playlist Sorter';
  els.sub.textContent = '';
  els.controls.hidden = true;
  els.body.hidden = true;
  els.errorState.hidden = true;
  els.emptyState.hidden = false;
  els.emptyText.textContent = message;
}

function showError(): void {
  els.controls.hidden = true;
  els.body.hidden = true;
  els.emptyState.hidden = true;
  els.errorState.hidden = false;
}

function setState(state: ScanState): void {
  current = state;

  if (!state.supported) {
    setEmpty(state.notice ?? 'Open a YouTube playlist page to use this panel.');
    return;
  }

  els.emptyState.hidden = true;
  els.errorState.hidden = true;
  els.controls.hidden = false;
  els.body.hidden = false;

  els.title.textContent = state.playlistTitle || 'Untitled playlist';
  els.sub.textContent = state.isWatchLater ? 'Watch Later' : '';

  render();
}

/* ── Rendering ──────────────────────────────────────────────────────── */

function computeDisplay(): { rows: PlaylistRow[]; exportRows: PlaylistRow[]; excludedIds: Set<string> } {
  const sorted = sortRows(current.rows, sortKey);

  if (!packResult) {
    return { rows: sorted, exportRows: sorted, excludedIds: new Set() };
  }

  const excludedIds = new Set(
    [...packResult.excludedOverBudget, ...packResult.excludedUnusable].map((r) => r.id),
  );
  const exportRows = sortRows(packResult.included, sortKey);
  return { rows: sorted, exportRows, excludedIds };
}

function render(): void {
  els.sortKey.value = sortKey;

  // Load controls.
  els.loadFull.disabled = current.loading;
  els.loadFull.textContent = current.loading ? 'Loading…' : 'Load full playlist';
  els.loadCancel.hidden = !current.loading;
  els.loadProgress.textContent = current.loading ? current.loadProgress ?? 'starting…' : (current.loadProgress ?? '');

  // Loaded-vs-stated cross-check (PRD §5: never claim completeness unverified).
  els.loadedCount.textContent = `${current.rows.length} loaded`;
  els.statedTotal.textContent =
    current.statedTotal !== null ? `YouTube says ${current.statedTotal} videos` : '';

  if (current.notice) {
    els.notice.hidden = false;
    els.notice.textContent = current.notice;
  } else {
    els.notice.hidden = true;
  }

  const { rows, excludedIds } = computeDisplay();
  renderList(rows, excludedIds);
  renderBudgetSummary();
}

function renderList(rows: PlaylistRow[], excludedIds: Set<string>): void {
  if (!rows.length) {
    els.listEmpty.hidden = false;
    els.list.hidden = true;
    els.listBody.replaceChildren();
    return;
  }

  els.listEmpty.hidden = true;
  els.list.hidden = false;

  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (row.unavailable) tr.classList.add('unavailable');
    if (excludedIds.has(row.id)) tr.classList.add('excluded');

    const cells: Array<[string, string]> = [
      ['position-cell', String(row.position)],
      ['title-cell', row.unavailable ? row.title || 'Unavailable video' : row.title],
      ['duration-cell', row.durationText ?? '—'],
      ['views-cell', row.viewsText ?? '—'],
      ['date-cell', row.dateText ?? '—'],
    ];
    for (const [cls, text] of cells) {
      const td = document.createElement('td');
      td.className = cls;
      td.textContent = text; // never innerHTML — this is untrusted page text
      tr.append(td);
    }
    fragment.append(tr);
  }
  els.listBody.replaceChildren(fragment);
}

function renderBudgetSummary(): void {
  if (!packResult) {
    els.budgetSummary.hidden = true;
    els.budgetClear.hidden = true;
    return;
  }
  els.budgetClear.hidden = false;
  els.budgetSummary.hidden = false;

  const totalCandidates = packResult.included.length + packResult.excludedOverBudget.length;
  const skippedNote = packResult.excludedUnusable.length
    ? ` (${packResult.excludedUnusable.length} skipped — no readable duration or unavailable)`
    : '';
  els.budgetSummary.textContent =
    `${packResult.included.length} of ${totalCandidates} fit in ${formatDuration(packResult.budgetSeconds)} — ` +
    `using ${formatDuration(packResult.totalSeconds)}${skippedNote}`;
}

/* ── Controls ───────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void refresh());
els.errorRetry.addEventListener('click', () => void refresh());

els.sortKey.addEventListener('change', () => {
  sortKey = els.sortKey.value as SortKey;
  void writePrefs({ lastSortKey: sortKey, lastBudgetMinutes: budgetMinutes });
  void track('sort_changed');
  render();
});

els.loadFull.addEventListener('click', () => {
  void ask({ type: 'PLS_LOAD_FULL' }).then((response) => {
    if (response) setState(response.state);
  });
});

els.loadCancel.addEventListener('click', () => {
  void ask({ type: 'PLS_CANCEL_LOAD' });
});

els.budgetApply.addEventListener('click', () => {
  const value = Number(els.budgetMinutes.value);
  if (!Number.isFinite(value) || value <= 0) {
    setStatus('Enter a number of minutes greater than 0.');
    return;
  }
  budgetMinutes = value;
  packResult = greedyPackToFit(current.rows, value);
  void writePrefs({ lastSortKey: sortKey, lastBudgetMinutes: budgetMinutes });
  void track('budget_filter_used');
  render();
});

els.budgetClear.addEventListener('click', () => {
  budgetMinutes = null;
  packResult = null;
  els.budgetMinutes.value = '';
  void writePrefs({ lastSortKey: sortKey, lastBudgetMinutes: null });
  render();
});

function downloadText(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  // The panel is an extension page, so chrome.downloads is available directly
  // here — no background-worker relay needed (that's only required from a
  // content script, which has no chrome.downloads access at all).
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  });
}

els.exportCsv.addEventListener('click', () => {
  const { exportRows } = computeDisplay();
  const suffix = packResult ? `${budgetMinutes}min-set` : sortKey;
  downloadText(buildFilename(current.playlistTitle, suffix, 'csv'), 'text/csv;charset=utf-8', toCsv(exportRows));
  void track('export_csv');
  setStatus(`Exported ${exportRows.length} rows as CSV.`);
});

els.exportMd.addEventListener('click', () => {
  const { exportRows } = computeDisplay();
  const suffix = packResult ? `${budgetMinutes}min-set` : sortKey;
  downloadText(
    buildFilename(current.playlistTitle, suffix, 'md'),
    'text/markdown;charset=utf-8',
    toMarkdown(exportRows, current.playlistTitle),
  );
  void track('export_md');
  setStatus(`Exported ${exportRows.length} rows as Markdown.`);
});

/* ── Data sheet ─────────────────────────────────────────────────────── */

els.dataToggle.addEventListener('click', () => els.data.showModal());
els.dataClose.addEventListener('click', () => els.data.close());

els.dataExport.addEventListener('click', () => {
  void exportBackup().then((backup) => {
    downloadText('playlist-sorter-backup.json', 'application/json', JSON.stringify(backup, null, 2));
    void track('data_exported');
  });
});

els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  if (!file) return;
  void file
    .text()
    .then((text) => importBackup(JSON.parse(text)))
    .then(async () => {
      const prefs = await readPrefs();
      sortKey = prefs.lastSortKey;
      budgetMinutes = prefs.lastBudgetMinutes;
      void track('data_imported');
      setStatus('Preferences imported.');
      render();
    })
    .catch((err) => setStatus(err instanceof Error ? err.message : 'Import failed.'))
    .finally(() => {
      els.importFile.value = '';
    });
});

els.dataClear.addEventListener('click', () => {
  if (!confirm('Clear all locally stored preferences? This cannot be undone.')) return;
  void clearAllData().then(() => {
    sortKey = 'custom';
    budgetMinutes = null;
    packResult = null;
    setStatus('All local data cleared.');
    render();
  });
});

/* ── Usage sheet ────────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    ...Object.entries(metrics.counts).map(([event, count]) => `${event}: ${count}`),
    `active days (last 30): ${metrics.activeDays.length}`,
  ];
  els.statsBody.textContent = lines.length ? lines.join('\n') : 'No usage yet.';
  els.stats.showModal();
}

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

/* ── Live updates from the content script ──────────────────────────── */

chrome.runtime.onMessage.addListener((raw: unknown, sender) => {
  const message = raw as ContentToPanel;
  if (message?.type !== 'PLS_STATE') return;
  if (tabId === null || sender.tab?.id !== tabId) return;
  setState(message.state);
});

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && changeInfo.status === 'complete') void refresh();
});

void (async () => {
  const prefs = await readPrefs();
  sortKey = prefs.lastSortKey;
  budgetMinutes = prefs.lastBudgetMinutes;
  if (budgetMinutes !== null) els.budgetMinutes.value = String(budgetMinutes);
  void track('panel_opened');
  await refresh();
})();
