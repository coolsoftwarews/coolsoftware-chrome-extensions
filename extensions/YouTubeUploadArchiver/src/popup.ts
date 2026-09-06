/**
 * Popup: the local archive — search, per-item watch/Studio links, export and
 * "Clear all data" (README's data-ownership constraint). An extension page,
 * so — unlike content.ts — it can call chrome.downloads directly for the
 * text exports; only the thumbnail *image* download is relayed through the
 * background worker, and only because it's triggered from the content
 * script, not from here.
 */

import { buildExportFilename } from './parse';
import { clearAllData, exportBackup, exportCsvText, exportMarkdownText, quotaStatus, readAll } from './storage';
import { UploadRecord } from './types';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
}

let allRecords: UploadRecord[] = [];

function matchesQuery(record: UploadRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    record.title.toLowerCase().includes(needle) ||
    record.description.toLowerCase().includes(needle) ||
    record.videoId.toLowerCase().includes(needle)
  );
}

function renderList(records: UploadRecord[]): void {
  const list = $<HTMLUListElement>('yua-list');
  const count = $<HTMLElement>('yua-count');
  list.replaceChildren();

  count.textContent = `${records.length} archived upload${records.length === 1 ? '' : 's'}`;

  if (!records.length) {
    const empty = document.createElement('li');
    empty.className = 'yua-empty';
    empty.textContent = allRecords.length ? 'No matches.' : 'Nothing archived yet.';
    list.appendChild(empty);
    return;
  }

  for (const record of records) {
    const item = document.createElement('li');
    item.className = 'yua-item';

    const img = document.createElement('img');
    img.src = record.thumbnailUrl;
    img.alt = '';
    img.loading = 'lazy';

    const body = document.createElement('div');
    body.className = 'yua-item-body';

    const title = document.createElement('div');
    title.className = 'yua-item-title';
    title.textContent = record.title || record.videoId;
    title.title = record.title;

    const meta = document.createElement('div');
    meta.className = 'yua-item-meta';
    const parts = [record.publishDateText || 'unknown date'];
    if (record.views !== null) parts.push(`${record.views.toLocaleString()} views`);
    if (record.likes !== null) parts.push(`${record.likes.toLocaleString()} likes`);
    meta.textContent = parts.join(' · ');

    const links = document.createElement('div');
    links.className = 'yua-item-links';
    const watchLink = document.createElement('a');
    watchLink.href = record.url;
    watchLink.target = '_blank';
    watchLink.rel = 'noopener noreferrer';
    watchLink.textContent = 'Watch';
    const studioLink = document.createElement('a');
    studioLink.href = record.studioUrl;
    studioLink.target = '_blank';
    studioLink.rel = 'noopener noreferrer';
    studioLink.textContent = 'Open in Studio';
    links.append(watchLink, studioLink);

    body.append(title, meta, links);
    item.append(img, body);
    list.appendChild(item);
  }
}

function setStatus(message: string): void {
  $<HTMLElement>('yua-status').textContent = message;
}

async function refresh(): Promise<void> {
  allRecords = await readAll();
  const query = $<HTMLInputElement>('yua-search').value;
  renderList(allRecords.filter(record => matchesQuery(record, query)));

  const status = await quotaStatus();
  const kb = Math.round(status.bytes / 1024);
  $<HTMLElement>('yua-quota').textContent = status.warn
    ? `Using ${kb} KB of local storage (getting full — export your archive).`
    : `Using ${kb} KB of local storage.`;
}

function download(filename: string, mimeType: string, content: string): void {
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({ url, filename, saveAs: false });
}

function wireSearch(): void {
  $<HTMLInputElement>('yua-search').addEventListener('input', () => {
    renderList(allRecords.filter(record => matchesQuery(record, $<HTMLInputElement>('yua-search').value)));
  });
}

function wireExports(): void {
  $<HTMLButtonElement>('yua-export-csv').addEventListener('click', () => {
    void exportCsvText().then(csv => {
      download(buildExportFilename('csv'), 'text/csv', csv);
      setStatus('CSV exported.');
    });
  });
  $<HTMLButtonElement>('yua-export-md').addEventListener('click', () => {
    void exportMarkdownText().then(md => {
      download(buildExportFilename('md'), 'text/markdown', md);
      setStatus('Markdown exported.');
    });
  });
  $<HTMLButtonElement>('yua-export-json').addEventListener('click', () => {
    void exportBackup().then(backup => {
      download(buildExportFilename('json'), 'application/json', JSON.stringify(backup, null, 2));
      setStatus('JSON exported.');
    });
  });
}

function wireClear(): void {
  $<HTMLButtonElement>('yua-clear-btn').addEventListener('click', () => {
    if (!confirm('Clear all YouTube Upload Archiver data on this device? This cannot be undone.')) return;
    void clearAllData().then(() => {
      setStatus('Cleared.');
      void refresh();
    });
  });
}

wireSearch();
wireExports();
wireClear();
void refresh();
