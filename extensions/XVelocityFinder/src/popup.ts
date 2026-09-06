/**
 * The action popup: this tab's live status, and the data-ownership surface
 * (export / import / clear) every product that stores anything owes the
 * user. The in-page filter bar is the primary control surface for filters —
 * this popup is deliberately secondary and global.
 */

import { clearAllData, clearMetrics, exportBackup, importBackup, readMetrics, track } from './storage';
import { StatusRequest, StatusResponse } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  statusText: $('status-text'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataStatus: $('data-status'),
  importFile: $<HTMLInputElement>('import-file'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
};

async function loadStatus(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url || !/^https?:\/\/(www\.)?(x|twitter)\.com\//.test(tab.url)) {
      els.statusText.textContent = 'Open a page on x.com to see live status.';
      return;
    }
    const request: StatusRequest = { type: 'XVF_GET_STATUS' };
    const response = (await chrome.tabs.sendMessage(tab.id, request).catch(() => null)) as StatusResponse | null;
    if (!response) {
      els.statusText.textContent = 'Reload the tab to connect — the extension was updated or just installed.';
      return;
    }
    const parts = [`${response.postsShown} of ${response.postsSeen} posts shown`];
    if (response.filters.minVelocity !== null) parts.push(`min ${response.filters.minVelocity}/h`);
    if (response.filters.minRatio !== null) parts.push(`min ${response.filters.minRatio}×`);
    if (response.filters.ageBand !== 'any') parts.push(`< ${response.filters.ageBand}`);
    parts.push(response.filters.mode === 'hide' ? 'hiding' : 'dimming');
    els.statusText.textContent = parts.join(' · ');
  } catch {
    els.statusText.textContent = 'Open a page on x.com to see live status.';
  }
}

async function renderMetrics(): Promise<void> {
  const metrics = await readMetrics();
  const lines: string[] = [];
  const entries = Object.entries(metrics.counts).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) {
    lines.push('Nothing recorded yet.');
  } else {
    for (const [key, value] of entries) lines.push(`${key}: ${value}`);
  }
  const failureEntries = Object.entries(metrics.failures);
  if (failureEntries.length) {
    lines.push('', 'parse health:');
    for (const [key, value] of failureEntries) lines.push(`${key}: ${value}`);
  }
  els.statsBody.textContent = lines.join('\n');
}

function setDataStatus(message: string): void {
  els.dataStatus.textContent = message;
  window.setTimeout(() => {
    if (els.dataStatus.textContent === message) els.dataStatus.textContent = '';
  }, 4000);
}

async function download(filename: string, contents: string): Promise<void> {
  const blob = new Blob([contents], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

els.dataExport.addEventListener('click', async () => {
  const backup = await exportBackup();
  const date = new Date().toISOString().slice(0, 10);
  await download(`x-velocity-finder-backup-${date}.json`, JSON.stringify(backup, null, 2));
  setDataStatus('Exported.');
});

els.dataImport.addEventListener('click', () => els.importFile.click());

els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const result = await importBackup(JSON.parse(text));
    setDataStatus(`Imported ${result.baselines} author baseline(s).`);
    await loadStatus();
  } catch (error) {
    setDataStatus(error instanceof Error ? error.message : 'That file could not be imported.');
  }
});

els.dataClear.addEventListener('click', async () => {
  if (!window.confirm('Clear all author medians and filter settings? This cannot be undone.')) return;
  await clearAllData();
  setDataStatus('Cleared.');
  await loadStatus();
});

els.statsClear.addEventListener('click', async () => {
  await clearMetrics();
  await renderMetrics();
});

void track('popup_opened');
void loadStatus();
void renderMetrics();
