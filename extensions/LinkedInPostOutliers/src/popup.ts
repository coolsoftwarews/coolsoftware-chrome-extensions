/**
 * The toolbar popup: local usage counters and the data-ownership surface
 * (export all / import / clear all). The overlay itself lives on the
 * LinkedIn page — this popup never has to talk to the content script.
 */

import { clearMetrics, readMetrics } from './metrics';
import { clearAllData, exportBackup, importBackup } from './storage';

const LABELS: Record<string, string> = {
  profile_scanned: 'Profile histories scanned',
  mixed_page_scanned: 'Hashtag/search pages scanned',
  filter_used: 'Filter used',
  sort_used: 'Sort used',
  export_csv: 'CSV exports',
  export_md: 'Markdown exports',
  data_exported: 'Backups exported',
  data_imported: 'Backups imported',
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  gate: $('gate'),
  intro: $('intro'),
  openLinkedIn: $<HTMLButtonElement>('open-linkedin'),
  metrics: $('metrics'),
  resetMetrics: $<HTMLButtonElement>('reset-metrics'),
  exportData: $<HTMLButtonElement>('export-data'),
  importData: $<HTMLButtonElement>('import-data'),
  importFile: $<HTMLInputElement>('import-file'),
  clearData: $<HTMLButtonElement>('clear-data'),
  status: $('status'),
};

function setStatus(message: string): void {
  els.status.textContent = message;
}

async function renderMetrics(): Promise<void> {
  const metrics = await readMetrics();
  els.metrics.replaceChildren();

  const entries = Object.entries(LABELS).filter(([key]) => metrics.counts[key]);
  const rows: Array<[string, number]> = entries.map(([key, label]) => [label, metrics.counts[key]]);
  // The health metric from PRD §8 — always shown, even at zero.
  rows.push(['Parse failures (health)', metrics.parseFailures]);

  if (entries.length === 0) {
    const empty = document.createElement('dt');
    empty.textContent = 'Nothing recorded yet.';
    els.metrics.append(empty);
  }

  for (const [label, value] of rows) {
    const term = document.createElement('dt');
    term.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = String(value);
    els.metrics.append(term, dd);
  }
}

/**
 * `tab.url` reads only for the tab activeTab grants access to on this popup
 * open — the same trick the rest of the portfolio uses to avoid the broader
 * "tabs" permission.
 */
async function checkPage(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onLinkedIn = /^https?:\/\/([^/]+\.)?linkedin\.com\//.test(tab?.url ?? '');
  els.gate.hidden = onLinkedIn;
  els.intro.hidden = !onLinkedIn;
}

els.openLinkedIn.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'https://www.linkedin.com/' });
});

els.resetMetrics.addEventListener('click', () => {
  void clearMetrics().then(renderMetrics);
});

els.exportData.addEventListener('click', async () => {
  const backup = await exportBackup();
  const content = JSON.stringify(backup, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await chrome.downloads.download({
      url: `data:application/json;charset=utf-8,${encodeURIComponent(content)}`,
      filename: `linkedin-post-outliers-backup-${stamp}.json`,
      saveAs: false,
    });
    setStatus(`Exported ${backup.authors.length} cached author median${backup.authors.length === 1 ? '' : 's'}.`);
  } catch {
    setStatus('Could not save the backup file.');
  }
});

els.importData.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', async () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (!file) return;
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.authors} cached author median${result.authors === 1 ? '' : 's'}.`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'That file could not be read.');
  }
});

els.clearData.addEventListener('click', () => {
  if (!confirm('Delete every cached median and your saved filter? Export first if you want a copy.')) return;
  void clearAllData().then(() => setStatus('All data cleared.'));
});

void checkPage();
void renderMetrics();
