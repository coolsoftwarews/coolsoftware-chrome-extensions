/**
 * Popup: the local save log (post URL, date, media type, filename) plus
 * Export CSV/JSON and Clear all (PRD §4). An extension page like this one
 * — unlike a content script — can call chrome.downloads directly, so the
 * export path here needs no background relay (that relay exists only for
 * content.ts, which cannot call chrome.downloads at all).
 */

import { buildExport, clearAllData, readAllLogEntries } from './storage';
import { ExportFormat, LogEntry } from './types';

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function renderRow(entry: LogEntry): HTMLTableRowElement {
  const row = document.createElement('tr');
  const cells = [entry.handle ? `@${entry.handle}` : '—', entry.mediaType, entry.filename, formatDate(entry.savedAt)];
  for (const value of cells) {
    const td = document.createElement('td');
    td.textContent = value;
    td.title = value;
    row.appendChild(td);
  }
  return row;
}

async function render(): Promise<void> {
  const entries = await readAllLogEntries();
  $('xma-count').textContent = String(entries.length);

  const body = $('xma-log-body') as HTMLTableSectionElement;
  body.replaceChildren();
  entries.forEach(entry => body.appendChild(renderRow(entry)));

  const table = $('xma-log-table');
  const empty = $('xma-empty');
  table.hidden = entries.length === 0;
  empty.hidden = entries.length > 0;
}

async function downloadExport(format: ExportFormat): Promise<void> {
  const status = $('xma-status');
  try {
    const { filename, content, mimeType } = await buildExport(format);
    const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
    try {
      await chrome.downloads.download({ url, filename, saveAs: false });
      status.textContent = `Exported ${filename}.`;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  } catch {
    status.textContent = "Couldn't export — try again.";
  }
}

function wireActions(): void {
  ($('xma-export-csv') as HTMLButtonElement).addEventListener('click', () => void downloadExport('csv'));
  ($('xma-export-json') as HTMLButtonElement).addEventListener('click', () => void downloadExport('json'));

  const clearBtn = $('xma-clear-btn') as HTMLButtonElement;
  const status = $('xma-status');
  clearBtn.addEventListener('click', () => {
    void (async () => {
      clearBtn.disabled = true;
      try {
        await clearAllData();
        status.textContent = 'Cleared.';
        await render();
      } catch {
        status.textContent = "Couldn't clear local data — try again.";
      } finally {
        clearBtn.disabled = false;
      }
    })();
  });
}

wireActions();
void render();
