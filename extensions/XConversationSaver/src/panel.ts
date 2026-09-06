/**
 * The side panel: the library, the people view, the export controls, and the
 * data ownership surface (export / import / clear).
 *
 * Unlike WebHighlighter, the panel here does not need to ask a content script
 * for state — everything a saved item needs is already in chrome.storage.local
 * once it's captured, so the panel reads/writes storage directly. The content
 * script's only job is capturing new items and telling the panel a save just
 * happened, so an open panel updates live.
 */

import { groupByPerson, matchesSearch, PersonGroup } from './capture';
import { buildExportFilename, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, threadShareRate, track } from './metrics';
import {
  clearAllData,
  deleteItem,
  exportBackup,
  importBackup,
  moveItemToCollection,
  quotaStatus,
  readAllItems,
  readCollections,
  readPeople,
  renameCollection,
  setItemNote,
  writePersonNote,
} from './storage';
import { Collection, ContentToPanel, PersonNote, SavedItem } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  count: $('count'),
  refresh: $<HTMLButtonElement>('refresh'),
  search: $<HTMLInputElement>('search'),
  viewLibrary: $<HTMLButtonElement>('view-library'),
  viewPeople: $<HTMLButtonElement>('view-people'),
  collectionRow: $('collection-row'),
  collectionFilter: $<HTMLSelectElement>('collection-filter'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
  peopleList: $<HTMLOListElement>('people-list'),
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

let items: SavedItem[] = [];
let collections: Collection[] = [];
let people: PersonNote[] = [];
let view: 'library' | 'people' = 'library';
let collectionFilter = 'all';
let query = '';
const expandedItems = new Set<string>();
const expandedPeople = new Set<string>();
let searchDebounce: number | undefined;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function kindLabel(kind: SavedItem['kind']): string {
  return kind === 'thread' ? 'Thread' : kind === 'conversation' ? 'Conversation' : 'Post';
}

function collectionName(id: string): string {
  return collections.find(c => c.id === id)?.name ?? 'Uncategorized';
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function loadAll(): Promise<void> {
  [items, collections, people] = await Promise.all([readAllItems(), readCollections(), readPeople()]);
  renderCollectionFilter();
  render();
}

function renderCollectionFilter(): void {
  const previous = els.collectionFilter.value || collectionFilter;
  els.collectionFilter.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = 'all';
  allOption.textContent = 'All collections';
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

/* ── State surfaces ──────────────────────────────────────────────────── */

function showEmpty(title: string, body: string): void {
  els.list.hidden = true;
  els.peopleList.hidden = true;
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

/* ── Render dispatch ─────────────────────────────────────────────────── */

function render(): void {
  els.collectionRow.hidden = view !== 'library';
  els.list.hidden = view !== 'library';
  els.peopleList.hidden = view !== 'people';

  if (view === 'library') renderLibrary();
  else renderPeople();
}

/* ── Library view ────────────────────────────────────────────────────── */

function filteredItems(): SavedItem[] {
  return items
    .filter(item => collectionFilter === 'all' || item.collectionId === collectionFilter)
    .filter(item => matchesSearch(item, query))
    .sort((a, b) => b.savedAt - a.savedAt);
}

function renderLibrary(): void {
  if (!items.length) {
    showEmpty(
      'Nothing saved yet',
      'Open a post or thread on X and click “+ Save” or “+ Save thread”. Saved items show up here.'
    );
    els.count.textContent = '';
    return;
  }

  const list = filteredItems();
  els.count.textContent = `${items.length} saved`;

  if (!list.length) {
    showEmpty('No matches', query.trim() ? `Nothing matches “${query.trim()}”.` : 'No items in this collection yet.');
    return;
  }

  hideEmpty();
  els.list.replaceChildren();
  for (const item of list) els.list.appendChild(buildItemCard(item));
}

function buildItemCard(item: SavedItem): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';

  const root = item.posts[0];
  const expanded = expandedItems.has(item.id);

  const head = document.createElement('div');
  head.className = 'item__head';
  const chip = document.createElement('span');
  chip.className = `chip${item.kind === 'thread' ? ' chip--thread' : item.kind === 'conversation' ? ' chip--conversation' : ''}`;
  chip.textContent = item.kind === 'post' ? 'Post' : `${kindLabel(item.kind)} · ${item.posts.length}`;
  const author = document.createElement('span');
  author.className = 'item__author';
  author.textContent = root.author || 'Unknown';
  const handle = document.createElement('span');
  handle.className = 'item__handle';
  handle.textContent = root.handle ? `@${root.handle}` : '';
  head.append(chip, author, handle);
  li.appendChild(head);

  const postsToShow = expanded ? item.posts : item.posts.slice(0, 1);
  for (const post of postsToShow) {
    const wrap = document.createElement('div');
    wrap.className = 'item__post';
    if (item.kind !== 'post' && expanded) {
      const by = document.createElement('div');
      by.className = 'item__handle';
      by.textContent = `${post.author} @${post.handle}`;
      wrap.appendChild(by);
    }
    const text = document.createElement('p');
    text.className = 'item__text';
    text.textContent = post.text || (post.mediaCount ? '(media only, no text)' : '(no text)');
    wrap.appendChild(text);
    li.appendChild(wrap);
  }

  if (item.posts.length > 1) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'link-btn';
    toggle.textContent = expanded ? 'Show less' : `Show all ${item.posts.length} posts`;
    toggle.addEventListener('click', () => {
      if (expanded) expandedItems.delete(item.id);
      else expandedItems.add(item.id);
      renderLibrary();
    });
    li.appendChild(toggle);
  }

  if (item.truncated) {
    const warn = document.createElement('p');
    warn.className = 'item__warn';
    warn.textContent = 'More replies were available on X when this was captured.';
    li.appendChild(warn);
  }

  const meta = document.createElement('p');
  meta.className = 'item__meta';
  meta.textContent = `Saved ${new Date(item.savedAt).toISOString().slice(0, 10)}`;
  li.appendChild(meta);

  const note = document.createElement('textarea');
  note.className = 'item__note';
  note.rows = 2;
  note.value = item.note;
  note.placeholder = 'Note on this item…';
  note.setAttribute('aria-label', `Note for ${root.author || 'this item'}`);
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
  select.setAttribute('aria-label', `Move ${root.author || 'this item'} to a collection`);
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
  openLink.href = root.url || `https://x.com/${root.handle}`;
  openLink.target = '_blank';
  openLink.rel = 'noopener noreferrer';
  openLink.textContent = 'Open on X';
  openLink.addEventListener('click', () => void track('post_opened'));

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'link-btn';
  deleteButton.textContent = 'Delete';
  deleteButton.style.marginLeft = 'auto';
  deleteButton.addEventListener('click', () => {
    if (!confirm('Delete this saved item?')) return;
    void deleteItem(item.id).then(() => {
      void track('item_deleted');
      void loadAll();
    });
  });

  actions.append(select, openLink, deleteButton);
  li.appendChild(actions);

  return li;
}

/* ── People view ─────────────────────────────────────────────────────── */

function renderPeople(): void {
  const allGroups = groupByPerson(items);
  els.count.textContent = `${allGroups.length} people`;

  if (!items.length) {
    showEmpty('Nothing saved yet', 'Save a post from someone on X — they will show up here, grouped by person.');
    return;
  }

  const groups = allGroups.filter(g => matchesGroup(g, query));
  if (!groups.length) {
    showEmpty('No matches', `Nothing matches “${query.trim()}”.`);
    return;
  }

  hideEmpty();
  els.peopleList.replaceChildren();
  for (const group of groups) els.peopleList.appendChild(buildPersonCard(group));
}

function matchesGroup(group: PersonGroup, q: string): boolean {
  const query_ = q.trim().toLowerCase();
  if (!query_) return true;
  if (group.handle.toLowerCase().includes(query_) || group.author.toLowerCase().includes(query_)) return true;
  return group.items.some(item => matchesSearch(item, query_));
}

function buildPersonCard(group: PersonGroup): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'person';
  const expanded = expandedPeople.has(group.handle);
  const personNote = people.find(p => p.handle === group.handle)?.note ?? '';

  const head = document.createElement('div');
  head.className = 'person__head';
  head.setAttribute('role', 'button');
  head.tabIndex = 0;
  head.setAttribute('aria-expanded', String(expanded));

  const who = document.createElement('div');
  const author = document.createElement('div');
  author.className = 'item__author';
  author.textContent = group.author || `@${group.handle}`;
  const handle = document.createElement('div');
  handle.className = 'item__handle';
  handle.textContent = `@${group.handle}`;
  who.append(author, handle);

  const count = document.createElement('span');
  count.className = 'person__count';
  count.textContent = `saved ${group.items.length} post${group.items.length === 1 ? '' : 's'} from this person`;

  head.append(who, count);
  const toggle = () => {
    if (expanded) expandedPeople.delete(group.handle);
    else expandedPeople.add(group.handle);
    renderPeople();
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggle();
    }
  });
  li.appendChild(head);

  const note = document.createElement('textarea');
  note.className = 'item__note';
  note.rows = 2;
  note.value = personNote;
  note.placeholder = 'Note on this person…';
  note.setAttribute('aria-label', `Note for @${group.handle}`);
  note.addEventListener('blur', () => {
    if (note.value === personNote) return;
    void writePersonNote(group.handle, note.value).then(() => {
      void track('person_note_saved');
      void loadAll();
    });
  });
  li.appendChild(note);

  if (expanded) {
    const list = document.createElement('div');
    list.className = 'person__items';
    for (const item of [...group.items].sort((a, b) => b.savedAt - a.savedAt)) {
      const row = document.createElement('div');
      row.className = 'item__meta';
      const link = document.createElement('a');
      link.className = 'link-btn';
      link.href = item.posts[0].url || '#';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = `${kindLabel(item.kind)} — ${(item.posts[0].text || '(no text)').slice(0, 60)}`;
      row.appendChild(link);
      list.appendChild(row);
    }
    li.appendChild(list);
  }

  return li;
}

/* ── Search / view / filter wiring ──────────────────────────────────── */

els.search.addEventListener('input', () => {
  query = els.search.value;
  render();
  window.clearTimeout(searchDebounce);
  if (query.trim()) searchDebounce = window.setTimeout(() => void track('search_used'), 600);
});

function setView(next: 'library' | 'people'): void {
  view = next;
  els.viewLibrary.classList.toggle('seg--on', next === 'library');
  els.viewPeople.classList.toggle('seg--on', next === 'people');
  render();
}
els.viewLibrary.addEventListener('click', () => setView('library'));
els.viewPeople.addEventListener('click', () => setView('people'));

els.collectionFilter.addEventListener('change', () => {
  collectionFilter = els.collectionFilter.value;
  renderLibrary();
});

els.refresh.addEventListener('click', () => void loadAll());

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
    setStatus(`Exported ${backup.items.length} item${backup.items.length === 1 ? '' : 's'}`);
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
      `Imported ${result.items} item${result.items === 1 ? '' : 's'} (${result.newItems} new), ${result.newCollections} new collection${result.newCollections === 1 ? '' : 's'}`
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
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some items.`
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
  if (!confirm('Delete every saved item, collection rename and person note? Export first if you want a copy.')) return;
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
  const rate = threadShareRate(metrics);
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    rate === null ? 'Thread-save rate: no data yet' : `Thread-save rate: ${rate}% of saves captured more than one post`,
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

/* ── Collection rename (via the filter dropdown's context) ─────────────
   PRD §4: all four defaults are renameable. A dedicated "Rename collection"
   affordance next to the filter keeps this reachable without adding a whole
   settings surface (out of scope for a narrow V1). */

const renameButton = document.createElement('button');
renameButton.type = 'button';
renameButton.className = 'link-btn';
renameButton.textContent = 'Rename';
renameButton.style.marginLeft = '4px';
renameButton.addEventListener('click', () => {
  if (collectionFilter === 'all') {
    setStatus('Choose a collection first, then Rename.');
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
els.collectionRow.appendChild(renameButton);

/* ── Live updates from the content script ───────────────────────────── */

chrome.runtime.onMessage.addListener((message: ContentToPanel) => {
  if (message?.type === 'XCS_ITEM_SAVED') void loadAll();
});

/* ── Boot ────────────────────────────────────────────────────────────── */

void (async () => {
  void track('panel_opened');
  await loadAll();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
})();
