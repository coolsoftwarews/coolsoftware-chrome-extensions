/**
 * The side panel: the library, the folder/tag filters, search, the re-index
 * trigger, export controls, and the data ownership surface (export / import
 * / clear).
 *
 * Like XConversationSaver's panel (the closest sibling on this platform),
 * this reads/writes chrome.storage.local directly rather than relaying
 * through the content script — a bookmark card is just data once it's
 * indexed. It subscribes to chrome.storage.onChanged (RedditVoiceOfCustomer's
 * pattern) so the library updates live while a passive index or a bounded
 * re-index pass is running on the Bookmarks tab, with zero custom messaging
 * needed for that. The one real message this file sends is the "start a
 * bounded auto-scroll re-index" command, which only makes sense as a live
 * command to a specific tab's content script.
 */

import { allTags, isPossiblyRemoved, matchesSearch } from './capture';
import { isBookmarksUrl } from './parse';
import { buildExportFilename, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  clearAllData,
  createCollection,
  deleteItem,
  exportBackup,
  importBackup,
  moveItemToCollection,
  quotaStatus,
  readAllItems,
  readCollections,
  readOptions,
  renameCollection,
  setItemNote,
  setItemTags,
} from './storage';
import { parseTags, tagsToInput } from './parse';
import { BookmarkItem, Collection, ContentToPanel, PanelOptions, PanelToContent } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  count: $('count'),
  refresh: $<HTMLButtonElement>('refresh'),
  search: $<HTMLInputElement>('search'),
  collectionFilter: $<HTMLSelectElement>('collection-filter'),
  collectionRename: $<HTMLButtonElement>('collection-rename'),
  collectionNew: $<HTMLButtonElement>('collection-new'),
  tagFilter: $<HTMLSelectElement>('tag-filter'),
  reindex: $<HTMLButtonElement>('reindex'),
  reindexStatus: $('reindex-status'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataClose: $<HTMLButtonElement>('data-close'),
  exportMd: $<HTMLButtonElement>('export-md'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportJson: $<HTMLButtonElement>('export-json'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let items: BookmarkItem[] = [];
let collections: Collection[] = [];
let options: PanelOptions = { lastReindexAt: null };
let collectionFilter = 'all';
let tagFilter = 'all';
let query = '';
let searchDebounce: number | undefined;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function collectionName(id: string): string {
  return collections.find(c => c.id === id)?.name ?? 'Uncategorized';
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function loadAll(): Promise<void> {
  [items, collections, options] = await Promise.all([readAllItems(), readCollections(), readOptions()]);
  renderCollectionFilter();
  renderTagFilter();
  render();
}

function renderCollectionFilter(): void {
  const previous = els.collectionFilter.value || collectionFilter;
  els.collectionFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All folders';
  els.collectionFilter.appendChild(allOption);
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    els.collectionFilter.appendChild(option);
  }
  collectionFilter = [...els.collectionFilter.options].some(o => o.value === previous) ? previous : 'all';
  els.collectionFilter.value = collectionFilter;
}

function renderTagFilter(): void {
  const previous = els.tagFilter.value || tagFilter;
  els.tagFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All tags';
  els.tagFilter.appendChild(allOption);
  for (const tag of allTags(items)) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = tag;
    els.tagFilter.appendChild(option);
  }
  tagFilter = [...els.tagFilter.options].some(o => o.value === previous) ? previous : 'all';
  els.tagFilter.value = tagFilter;
}

/* ── State surfaces ──────────────────────────────────────────────────── */

function showEmpty(title: string, body: string): void {
  els.list.hidden = true;
  els.state.hidden = false;
  els.state.className = 'state state--gate';
  els.state.replaceChildren();

  const icon = document.createElement('img');
  icon.className = 'gate__icon';
  icon.src = chrome.runtime.getURL('icons/icon-128.png');
  icon.alt = '';

  const heading = document.createElement('strong');
  heading.className = 'gate__title';
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'gate__body';
  text.textContent = body;

  els.state.append(icon, heading, text);
}

function hideEmpty(): void {
  els.state.hidden = true;
}

/* ── Library rendering ──────────────────────────────────────────────── */

function filteredItems(): BookmarkItem[] {
  return items
    .filter(item => collectionFilter === 'all' || item.collectionId === collectionFilter)
    .filter(item => tagFilter === 'all' || item.tags.some(t => t.toLowerCase() === tagFilter.toLowerCase()))
    .filter(item => matchesSearch(item, query))
    .sort((a, b) => b.indexedAt - a.indexedAt);
}

function render(): void {
  if (!items.length) {
    showEmpty(
      'Nothing indexed yet',
      'Open your Bookmarks page on X (the Bookmarks tab, not Likes) and scroll — bookmarks show up here as X renders them. We index what you’ve scrolled through; scroll further, or click Re-index, to add more.'
    );
    els.count.textContent = '';
    els.list.hidden = true;
    return;
  }

  const list = filteredItems();
  els.count.textContent = `${items.length} indexed`;

  if (!list.length) {
    showEmpty('No matches', query.trim() ? `Nothing matches “${query.trim()}”.` : 'Nothing in this folder/tag yet.');
    return;
  }

  hideEmpty();
  els.list.hidden = false;
  els.list.replaceChildren();
  for (const item of list) els.list.appendChild(buildItemCard(item));
}

function buildItemCard(item: BookmarkItem): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';
  const { post } = item;

  const head = document.createElement('div');
  head.className = 'item__head';
  const author = document.createElement('span');
  author.className = 'item__author';
  author.textContent = post.author || 'Unknown';
  const handle = document.createElement('span');
  handle.className = 'item__handle';
  handle.textContent = post.handle ? `@${post.handle}` : '';
  head.append(author, handle);
  li.appendChild(head);

  const text = document.createElement('p');
  text.className = 'item__text';
  text.textContent = post.text || (post.mediaCount ? '(media only, no text)' : '(no text)');
  li.appendChild(text);

  if (isPossiblyRemoved(item, options.lastReindexAt)) {
    const stale = document.createElement('span');
    stale.className = 'item__stale';
    stale.textContent = 'Not seen on your last visit — might be un-bookmarked, or you may not have scrolled that far';
    li.appendChild(stale);
  }

  const meta = document.createElement('p');
  meta.className = 'item__meta';
  meta.textContent = `Indexed ${new Date(item.indexedAt).toISOString().slice(0, 10)}`;
  li.appendChild(meta);

  if (item.tags.length) {
    const tagsRow = document.createElement('div');
    tagsRow.className = 'item__tags';
    for (const tag of item.tags) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = tag;
      tagsRow.appendChild(chip);
    }
    li.appendChild(tagsRow);
  }

  const tagsInput = document.createElement('input');
  tagsInput.type = 'text';
  tagsInput.className = 'item__tags-input';
  tagsInput.value = tagsToInput(item.tags);
  tagsInput.placeholder = 'Tags, comma separated…';
  tagsInput.setAttribute('aria-label', `Tags for ${post.author || 'this bookmark'}`);
  tagsInput.addEventListener('blur', () => {
    const next = parseTags(tagsInput.value);
    if (JSON.stringify(next) === JSON.stringify(item.tags)) return;
    void setItemTags(item.id, next).then(() => {
      void track('tag_added');
      void loadAll();
    });
  });
  li.appendChild(tagsInput);

  const note = document.createElement('textarea');
  note.className = 'item__note';
  note.rows = 2;
  note.value = item.note;
  note.placeholder = 'Note on this bookmark…';
  note.setAttribute('aria-label', `Note for ${post.author || 'this bookmark'}`);
  note.addEventListener('blur', () => {
    if (note.value === item.note) return;
    void setItemNote(item.id, note.value).then(() => {
      void track('note_saved');
      void loadAll();
    });
  });
  li.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'item__actions';

  const select = document.createElement('select');
  select.setAttribute('aria-label', `Move ${post.author || 'this bookmark'} to a folder`);
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    option.selected = collection.id === item.collectionId;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    void moveItemToCollection(item.id, select.value).then(() => {
      void track('move_collection');
      void loadAll();
    });
  });

  const openLink = document.createElement('a');
  openLink.className = 'link-btn';
  openLink.href = post.url || `https://x.com/${post.handle}`;
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.textContent = 'Open on X';
  openLink.addEventListener('click', () => void track('bookmark_opened'));

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'link-btn';
  deleteButton.textContent = 'Delete';
  deleteButton.style.marginLeft = 'auto';
  deleteButton.setAttribute(
    'title',
    'Removes this from your local library only — it does not un-bookmark the post on X.'
  );
  deleteButton.addEventListener('click', () => {
    if (!confirm('Remove this from your local library? This does not un-bookmark it on X.')) return;
    void deleteItem(item.id).then(() => {
      void track('item_deleted');
      void loadAll();
    });
  });

  actions.append(select, openLink, deleteButton);
  li.appendChild(actions);

  return li;
}

/* ── Search / filter wiring ─────────────────────────────────────────── */

els.search.addEventListener('input', () => {
  query = els.search.value;
  render();
  window.clearTimeout(searchDebounce);
  if (query.trim()) searchDebounce = window.setTimeout(() => void track('search_used'), 600);
});

els.collectionFilter.addEventListener('change', () => {
  collectionFilter = els.collectionFilter.value;
  render();
});

els.tagFilter.addEventListener('change', () => {
  tagFilter = els.tagFilter.value;
  render();
});

els.refresh.addEventListener('click', () => void loadAll());

els.collectionNew.addEventListener('click', () => {
  const name = prompt('New folder name:');
  if (!name) return;
  void createCollection(name).then(() => {
    void track('collection_created');
    void loadAll();
  });
});

els.collectionRename.addEventListener('click', () => {
  if (collectionFilter === 'all') {
    setStatus('Choose a folder first, then Rename.');
    return;
  }
  const current = collectionName(collectionFilter);
  const next = prompt(`Rename “${current}” to:`, current);
  if (next === null) return;
  void renameCollection(collectionFilter, next).then(() => {
    void track('collection_renamed');
    void loadAll();
  });
});

/* ── Re-index (bounded auto-scroll on the live Bookmarks tab) ─────────── */

async function startReindex(): Promise<void> {
  els.reindex.disabled = true;
  els.reindexStatus.textContent = 'Looking for your Bookmarks tab…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isBookmarksUrl(tab.url)) {
      els.reindexStatus.textContent = 'Open your Bookmarks page on X in this tab, then click Re-index.';
      return;
    }
    const message: PanelToContent = { type: 'XBO_START_REINDEX', screens: 12 };
    els.reindexStatus.textContent = 'Re-indexing… scrolling your bookmarks page.';
    await chrome.tabs.sendMessage(tab.id, message).catch(() => {
      throw new Error('no-receiver');
    });
  } catch {
    els.reindexStatus.textContent = 'Open your Bookmarks page on X in this tab, then click Re-index.';
    els.reindex.disabled = false;
  }
}

els.reindex.addEventListener('click', () => void startReindex());

chrome.runtime.onMessage.addListener((message: ContentToPanel) => {
  if (message?.type !== 'XBO_REINDEX_DONE') return;
  els.reindex.disabled = false;
  els.reindexStatus.textContent = message.wrongTab
    ? 'That tab is on Bookmarks/Likes history, but Likes is the active tab — switch to Bookmarks, then click Re-index.'
    : `Re-index complete — scrolled ${message.scrolled} screen${message.scrolled === 1 ? '' : 's'}.`;
  void loadAll();
});

/* ── Live updates while indexing runs on the Bookmarks tab ────────────
   No custom messaging needed for this — the content script writes straight
   to chrome.storage.local, and every extension context (including this
   panel) gets notified on any write, from any context. */

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area !== 'local') return;
  void loadAll();
});

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportMarkdown(): Promise<void> {
  try {
    const content = toMarkdown(items, collections);
    await download(new Blob([content], { type: 'text/markdown;charset=utf-8' }), buildExportFilename('md'));
    setStatus('Saved .md');
    void track('export_md');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not save the .md file.');
  }
}

async function exportCsv(): Promise<void> {
  try {
    const content = toCsv(items, collections);
    await download(new Blob([content], { type: 'text/csv;charset=utf-8' }), buildExportFilename('csv'));
    setStatus('Saved .csv');
    void track('export_csv');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not save the .csv file.');
  }
}

async function exportJson(): Promise<void> {
  try {
    const backup = await exportBackup();
    const content = JSON.stringify(backup, null, 2);
    await download(new Blob([content], { type: 'application/json;charset=utf-8' }), buildExportFilename('json'));
    setStatus(`Exported ${backup.items.length} bookmark${backup.items.length === 1 ? '' : 's'}`);
    void track('export_json');
    void track('data_exported');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(
      `Imported ${result.items} bookmark${result.items === 1 ? '' : 's'} (${result.newItems} new), ${result.newCollections} new folder${result.newCollections === 1 ? '' : 's'}`
    );
    void track('data_imported');
    await loadAll();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : 'That file could not be read.');
  }
}

/* ── Data dialog ─────────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some bookmarks.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());
els.exportMd.addEventListener('click', () => void exportMarkdown());
els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportJson.addEventListener('click', () => void exportJson());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every indexed bookmark, folder rename and tag? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    void track('data_cleared');
    els.data.close();
    setStatus('All data cleared.');
    void loadAll();
  });
});

/* ── Usage dialog ────────────────────────────────────────────────────── */

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

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

/* ── Boot ────────────────────────────────────────────────────────────── */

void (async () => {
  void track('panel_opened');
  await loadAll();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
})();
