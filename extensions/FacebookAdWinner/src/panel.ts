/**
 * The action popup: the swipe file — search, collections, notes, export and
 * the data-ownership surface (export / import / clear). Everything here
 * reads and writes chrome.storage.local directly; there is no content
 * script relay needed because the swipe file is just data, not live page
 * state (unlike WebHighlighter, which must ask the page for its DOM state).
 */

import { buildFilename, swipeFileToCsv, swipeFileToMarkdown } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  clearAllData,
  createCollection,
  deleteItem,
  exportBackup,
  importBackup,
  quotaStatus,
  readCollections,
  readItems,
  searchItems,
  updateItem,
} from './storage';
import { Collection, SavedAd } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  search: $<HTMLInputElement>('search'),
  collectionFilter: $<HTMLSelectElement>('collection-filter'),
  newCollection: $<HTMLButtonElement>('new-collection'),
  dlCsv: $<HTMLButtonElement>('dl-csv'),
  dlMd: $<HTMLButtonElement>('dl-md'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
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

let items: SavedAd[] = [];
let collections: Collection[] = [];

function setStatus(message: string): void {
  els.status.textContent = message;
}

async function download(content: string, filename: string, mime: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function loadAll(): Promise<void> {
  [items, collections] = await Promise.all([readItems(), readCollections()]);
  renderCollectionOptions();
  renderList();
}

function renderCollectionOptions(): void {
  const current = els.collectionFilter.value;
  els.collectionFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All collections';
  els.collectionFilter.appendChild(allOption);
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    els.collectionFilter.appendChild(option);
  }
  els.collectionFilter.value = collections.some(c => c.id === current) ? current : '';
}

function collectionOptionsFor(select: HTMLSelectElement, selectedId: string | null): void {
  select.replaceChildren();
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Uncategorized';
  select.appendChild(none);
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    select.appendChild(option);
  }
  select.value = selectedId ?? '';
}

/* ── List ────────────────────────────────────────────────────────────── */

function currentFiltered(): SavedAd[] {
  let list = items;
  const collectionId = els.collectionFilter.value;
  if (collectionId) list = list.filter(item => item.collectionId === collectionId);
  return searchItems(list, els.search.value);
}

function renderList(): void {
  const visible = currentFiltered();
  els.list.replaceChildren();

  if (!items.length) {
    els.state.hidden = false;
    els.list.hidden = true;
    setStatus('');
    return;
  }

  if (!visible.length) {
    els.state.hidden = false;
    els.state.replaceChildren();
    const text = document.createElement('p');
    text.className = 'state__text';
    text.textContent = 'Nothing matches that search or collection.';
    els.state.appendChild(text);
    els.list.hidden = true;
    setStatus(`${items.length} saved total`);
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;

  for (const item of visible) {
    els.list.appendChild(renderItem(item));
  }

  setStatus(`${visible.length} of ${items.length} shown`);
}

function renderItem(item: SavedAd): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';

  if (item.thumbnailUrl) {
    const img = document.createElement('img');
    img.className = 'item__thumb';
    img.src = item.thumbnailUrl;
    img.alt = '';
    li.appendChild(img);
  }

  const body = document.createElement('div');
  body.className = 'item__body';

  const advertiser = document.createElement('p');
  advertiser.className = 'item__advertiser';
  advertiser.textContent = item.advertiser || 'Unknown advertiser';
  body.appendChild(advertiser);

  const badge = document.createElement('p');
  badge.className = 'item__badge';
  badge.textContent = `🏆 ${item.daysRunning} day${item.daysRunning === 1 ? '' : 's'} running · ${item.variantCount} variant${
    item.variantCount === 1 ? '' : 's'
  } · ${item.status === 'active' ? 'still active' : 'stopped'}`;
  body.appendChild(badge);

  if (item.adText) {
    const text = document.createElement('p');
    text.className = 'item__text';
    text.textContent = item.adText;
    body.appendChild(text);
  }

  const row = document.createElement('div');
  row.className = 'item__row';

  const collectionSelect = document.createElement('select');
  collectionOptionsFor(collectionSelect, item.collectionId);
  collectionSelect.addEventListener('change', () => {
    void updateItem(item.id, { collectionId: collectionSelect.value || null }).then(loadAll);
  });

  const link = document.createElement('a');
  link.className = 'link-btn';
  link.href = item.libraryUrl;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = 'Open';

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'link-btn';
  removeButton.textContent = 'Remove';
  removeButton.style.marginLeft = 'auto';
  removeButton.addEventListener('click', () => {
    void deleteItem(item.id).then(loadAll);
  });

  row.append(collectionSelect, link, removeButton);
  body.appendChild(row);

  const note = document.createElement('textarea');
  note.className = 'item__note';
  note.rows = 2;
  note.placeholder = 'Note…';
  note.value = item.note;
  note.addEventListener('blur', () => {
    if (note.value === item.note) return;
    void updateItem(item.id, { note: note.value }).then(() => {
      if (note.value.trim()) void track('note_added');
      void loadAll();
    });
  });
  body.appendChild(note);

  li.appendChild(body);
  return li;
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function exportSwipeFile(format: 'csv' | 'md'): Promise<void> {
  if (!items.length) {
    setStatus('Nothing to export yet.');
    return;
  }
  const content = format === 'csv' ? swipeFileToCsv(items, collections) : swipeFileToMarkdown(items, collections);
  const mime = format === 'csv' ? 'text/csv' : 'text/markdown';
  try {
    await download(content, buildFilename('meta-ad-winner-swipefile', format), mime);
    setStatus(`Saved .${format}`);
    void track(format === 'csv' ? 'export_swipefile_csv' : 'export_swipefile_md');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${format} file.`);
  }
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear old collections.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const content = JSON.stringify(backup, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(content, `meta-ad-winner-backup-${stamp}.json`, 'application/json');
    setStatus(`Exported ${backup.items.length} ad${backup.items.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.items} ad${result.items === 1 ? '' : 's'}, ${result.collections} collection${result.collections === 1 ? '' : 's'}`);
    void track('data_imported');
    await loadAll();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.search.addEventListener('input', () => {
  void track('search_used');
  renderList();
});
els.collectionFilter.addEventListener('change', renderList);

els.newCollection.addEventListener('click', () => {
  const name = prompt('Collection name');
  if (name === null) return;
  void createCollection(name).then(() => {
    void track('collection_created');
    return loadAll();
  });
});

els.dlCsv.addEventListener('click', () => void exportSwipeFile('csv'));
els.dlMd.addEventListener('click', () => void exportSwipeFile('md'));

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
  if (!confirm('Delete every saved ad and collection? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void loadAll();
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
  await loadAll();
  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
})();
