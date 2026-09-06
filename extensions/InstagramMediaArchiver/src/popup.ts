/**
 * The toolbar popup: the local archive log, and the three actions PRD §4
 * asks for — export CSV, export JSON, clear all. Nothing here reads
 * Instagram's DOM or reaches the network; it only reads/writes
 * chrome.storage.local through storage.ts.
 */

import { buildExportFilename, toCsv, toJson } from './formatters';
import { clearAllEntries, readAllEntries } from './storage';
import { LogEntry } from './types';

const summaryEl = document.getElementById('summary') as HTMLParagraphElement;
const emptyEl = document.getElementById('empty') as HTMLDivElement;
const listEl = document.getElementById('list') as HTMLUListElement;
const exportCsvBtn = document.getElementById('export-csv') as HTMLButtonElement;
const exportJsonBtn = document.getElementById('export-json') as HTMLButtonElement;
const clearAllBtn = document.getElementById('clear-all') as HTMLButtonElement;

function renderItem(entry: LogEntry): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';

  const head = document.createElement('div');
  head.className = 'item__head';

  const handle = document.createElement('span');
  handle.className = 'item__handle';
  handle.textContent = `@${entry.handle}`;
  head.appendChild(handle);

  const date = document.createElement('span');
  date.className = 'muted';
  date.textContent = new Date(entry.savedAt).toLocaleDateString();
  head.appendChild(date);

  li.appendChild(head);

  const file = document.createElement('span');
  file.className = 'item__file';
  file.textContent = entry.filename;
  li.appendChild(file);

  return li;
}

async function render(): Promise<void> {
  const entries = await readAllEntries();
  summaryEl.textContent = entries.length
    ? `${entries.length} saved item${entries.length === 1 ? '' : 's'}`
    : 'Nothing saved yet';

  listEl.replaceChildren();
  if (!entries.length) {
    emptyEl.hidden = false;
    listEl.hidden = true;
    return;
  }
  emptyEl.hidden = true;
  listEl.hidden = false;
  for (const entry of entries) listEl.appendChild(renderItem(entry));

  const hasEntries = entries.length > 0;
  exportCsvBtn.disabled = !hasEntries;
  exportJsonBtn.disabled = !hasEntries;
  clearAllBtn.disabled = !hasEntries;
}

function downloadTextFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  void chrome.downloads.download({ url, filename, saveAs: false }).finally(() => {
    // Revoking immediately can race the download read on some platforms;
    // a short delay is cheap insurance and this is the only place in the
    // extension that creates an object URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
  });
}

exportCsvBtn.addEventListener('click', async () => {
  const entries = await readAllEntries();
  downloadTextFile(buildExportFilename('csv'), toCsv(entries), 'text/csv');
});

exportJsonBtn.addEventListener('click', async () => {
  const entries = await readAllEntries();
  downloadTextFile(buildExportFilename('json'), toJson(entries), 'application/json');
});

clearAllBtn.addEventListener('click', async () => {
  if (!window.confirm('Clear the local archive log? Files already saved to your device are not affected.')) return;
  await clearAllEntries();
  void render();
});

void render();
