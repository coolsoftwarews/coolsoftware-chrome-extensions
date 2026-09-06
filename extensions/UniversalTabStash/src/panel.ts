/**
 * The side panel: pick tabs to stash, browse and search stashes, restore or
 * export them, and own the data (export / import / clear).
 *
 * All the decisions — what to include, when to batch a restore, when to ask
 * for confirmation — are made by the pure functions in stash.ts. This file
 * wires them to the DOM and to the two impure edges: tabs.ts (chrome.tabs)
 * and storage.ts (chrome.storage.local).
 */

import { buildFilename, toCsv, toCsvAll, toMarkdown, toMarkdownAll } from './formatters';
import { clearMetrics, readMetrics, restoreRatio, track } from './metrics';
import { createStash, defaultStashName, planRestore, searchStashes } from './stash';
import {
  clearAllData,
  deleteStash as deleteStashRecord,
  exportBackup,
  importBackup,
  quotaStatus,
  readAllStashes,
  readOptions,
  writeOptions,
  writeStash,
} from './storage';
import { closeTabs, currentWindowTabs, restoreSingleTab, restoreTabs } from './tabs';
import { OpenTab, Stash } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  newStash: $<HTMLButtonElement>('new-stash'),
  search: $<HTMLInputElement>('search'),
  state: $('state'),
  searchList: $<HTMLOListElement>('search-list'),
  stashList: $<HTMLOListElement>('stash-list'),
  status: $('status'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),

  newStashDialog: $<HTMLDialogElement>('new-stash-dialog'),
  selectAll: $<HTMLButtonElement>('select-all'),
  selectNone: $<HTMLButtonElement>('select-none'),
  tabPicker: $<HTMLUListElement>('tab-picker'),
  stashName: $<HTMLInputElement>('stash-name'),
  stashNotes: $<HTMLTextAreaElement>('stash-notes'),
  closeAfter: $<HTMLInputElement>('close-after'),
  newStashCancel: $<HTMLButtonElement>('new-stash-cancel'),
  newStashSave: $<HTMLButtonElement>('new-stash-save'),

  restoreConfirm: $<HTMLDialogElement>('restore-confirm'),
  restoreConfirmBody: $('restore-confirm-body'),
  restoreConfirmCancel: $<HTMLButtonElement>('restore-confirm-cancel'),
  restoreConfirmGo: $<HTMLButtonElement>('restore-confirm-go'),

  data: $<HTMLDialogElement>('data'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  exportAllMd: $<HTMLButtonElement>('export-all-md'),
  exportAllCsv: $<HTMLButtonElement>('export-all-csv'),

  stats: $<HTMLDialogElement>('stats'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let stashes: Stash[] = [];
let openIds = new Set<string>();
let pickerTabs: OpenTab[] = [];
let pendingRestore: { stash: Stash; tabIds?: string[] } | null = null;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function favicon(url?: string): string {
  return url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="14" height="14"/%3E';
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function load(): Promise<void> {
  stashes = await readAllStashes();
  els.summary.textContent = stashes.length
    ? `${stashes.length} stash${stashes.length === 1 ? '' : 'es'} · ${stashes.reduce((n, s) => n + s.tabs.length, 0)} tabs`
    : '';
  render();
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function render(): void {
  const query = els.search.value.trim();
  if (query) {
    renderSearch(query);
    return;
  }

  els.searchList.hidden = true;
  els.searchList.replaceChildren();

  if (!stashes.length) {
    els.state.hidden = false;
    els.stashList.hidden = true;
    return;
  }

  els.state.hidden = true;
  els.stashList.hidden = false;
  els.stashList.replaceChildren();
  for (const stash of stashes) els.stashList.appendChild(renderStashCard(stash));
}

function renderSearch(query: string): void {
  els.state.hidden = true;
  els.stashList.hidden = true;
  els.searchList.hidden = false;
  els.searchList.replaceChildren();

  const hits = searchStashes(stashes, query);
  void track('search_used');

  if (!hits.length) {
    const empty = document.createElement('li');
    empty.className = 'state';
    empty.innerHTML = '<p class="state__text">No stashed tabs match that search.</p>';
    els.searchList.appendChild(empty);
    return;
  }

  for (const hit of hits) {
    const li = document.createElement('li');
    li.className = 'hit';

    const stashLine = document.createElement('p');
    stashLine.className = 'hit__stash';
    stashLine.textContent = hit.stashName;
    li.appendChild(stashLine);

    const title = document.createElement('a');
    title.className = 'hit__title';
    title.href = hit.tab.url;
    title.textContent = hit.tab.title;
    title.title = 'Open this tab';
    title.addEventListener('click', event => {
      event.preventDefault();
      void restoreSingleTab({ url: hit.tab.url, pinned: hit.tab.pinned }).then(() => {
        void track('tab_restored_single');
      });
    });
    li.appendChild(title);

    const url = document.createElement('p');
    url.className = 'hit__url';
    url.textContent = hit.tab.url;
    li.appendChild(url);

    els.searchList.appendChild(li);
  }
}

function renderStashCard(stash: Stash): HTMLLIElement {
  const li = document.createElement('li');
  li.className = `stash${openIds.has(stash.id) ? ' stash--open' : ''}`;

  const head = document.createElement('div');
  head.className = 'stash__head';
  head.addEventListener('click', () => {
    if (openIds.has(stash.id)) openIds.delete(stash.id);
    else openIds.add(stash.id);
    render();
  });

  const icon = document.createElement('div');
  icon.className = 'stash__icon';
  icon.textContent = String(stash.tabs.length);

  const info = document.createElement('div');
  info.className = 'stash__info';

  const name = document.createElement('p');
  name.className = 'stash__name';
  name.textContent = stash.name;

  const meta = document.createElement('p');
  meta.className = 'stash__meta';
  meta.textContent = `${stash.tabs.length} tab${stash.tabs.length === 1 ? '' : 's'} · ${new Date(stash.createdAt).toLocaleDateString()}`;

  info.append(name, meta);

  if (stash.notes.trim()) {
    const notes = document.createElement('p');
    notes.className = 'stash__notes';
    notes.textContent = stash.notes;
    info.appendChild(notes);
  }

  head.append(icon, info);

  const actions = document.createElement('div');
  actions.className = 'stash__actions';

  const restoreAll = document.createElement('button');
  restoreAll.type = 'button';
  restoreAll.className = 'btn btn--small';
  restoreAll.textContent = 'Restore all';
  restoreAll.addEventListener('click', () => void requestRestore(stash));

  const exportMd = document.createElement('button');
  exportMd.type = 'button';
  exportMd.className = 'btn btn--small';
  exportMd.textContent = 'Export .md';
  exportMd.addEventListener('click', () => void exportOne(stash, 'md'));

  const exportCsv = document.createElement('button');
  exportCsv.type = 'button';
  exportCsv.className = 'btn btn--small';
  exportCsv.textContent = 'Export .csv';
  exportCsv.addEventListener('click', () => void exportOne(stash, 'csv'));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--small btn--danger';
  del.textContent = 'Delete';
  del.addEventListener('click', () => void removeStash(stash));

  actions.append(restoreAll, exportMd, exportCsv, del);

  const tabsWrap = document.createElement('div');
  tabsWrap.className = 'stash__tabs';
  for (const tab of stash.tabs) {
    const row = document.createElement('div');
    row.className = 'tab-row';

    const img = document.createElement('img');
    img.src = favicon(tab.favIconUrl);
    img.alt = '';

    const link = document.createElement('a');
    link.className = 'tab-row__title';
    link.href = tab.url;
    link.textContent = tab.title;
    link.title = tab.url;
    link.addEventListener('click', event => {
      event.preventDefault();
      void restoreSingleTab({ url: tab.url, pinned: tab.pinned }).then(() => void track('tab_restored_single'));
    });

    row.append(img, link);

    if (tab.pinned) {
      const pin = document.createElement('span');
      pin.className = 'tab-row__pin';
      pin.textContent = 'pinned';
      row.appendChild(pin);
    }

    tabsWrap.appendChild(row);
  }

  li.append(head, actions, tabsWrap);
  return li;
}

/* ── New stash ───────────────────────────────────────────────────────── */

async function openNewStashDialog(): Promise<void> {
  pickerTabs = await currentWindowTabs();
  const { includePinnedByDefault } = await readOptions();

  els.tabPicker.replaceChildren();
  for (const tab of pickerTabs) {
    const li = document.createElement('li');

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = `pick-${tab.chromeTabId}`;
    checkbox.checked = includePinnedByDefault || !tab.pinned;
    checkbox.dataset.tabId = String(tab.chromeTabId);

    const img = document.createElement('img');
    img.src = favicon(tab.favIconUrl);
    img.alt = '';

    const label = document.createElement('label');
    label.htmlFor = checkbox.id;
    label.textContent = tab.pinned ? `${tab.title} (pinned)` : tab.title;

    li.append(checkbox, img, label);
    els.tabPicker.appendChild(li);
  }

  els.stashName.value = '';
  els.stashName.placeholder = defaultStashName(selectedCount());
  els.stashNotes.value = '';
  els.closeAfter.checked = false;
  els.newStashDialog.showModal();
}

function pickerCheckboxes(): HTMLInputElement[] {
  return Array.from(els.tabPicker.querySelectorAll('input[type="checkbox"]'));
}

function selectedCount(): number {
  return pickerCheckboxes().filter(cb => cb.checked).length;
}

async function saveNewStash(): Promise<void> {
  const selectedIds = new Set(
    pickerCheckboxes()
      .filter(cb => cb.checked)
      .map(cb => Number(cb.dataset.tabId))
  );
  const selected = pickerTabs.filter(tab => selectedIds.has(tab.chromeTabId));

  if (!selected.length) {
    setStatus('Select at least one tab to stash.');
    return;
  }

  const stash = createStash({ name: els.stashName.value, notes: els.stashNotes.value, tabs: selected });
  await writeStash(stash);
  void track('stash_created');

  if (els.closeAfter.checked) {
    await closeTabs(selected.map(tab => tab.chromeTabId));
    void track('tabs_closed_on_stash');
  }

  els.newStashDialog.close();
  setStatus(`Saved “${stash.name}”`);
  await load();
}

/* ── Restore ─────────────────────────────────────────────────────────── */

async function requestRestore(stash: Stash, tabIds?: string[]): Promise<void> {
  const plan = planRestore(stash, tabIds);
  if (!plan.tabs.length) return;

  if (plan.needsConfirmation) {
    pendingRestore = { stash, tabIds };
    els.restoreConfirmBody.textContent = `This opens ${plan.tabs.length} tabs — continue?`;
    els.restoreConfirm.showModal();
    return;
  }

  await restoreTabs(plan);
  void track('stash_restored_all');
  setStatus(`Restored ${plan.tabs.length} tab${plan.tabs.length === 1 ? '' : 's'}`);
}

async function confirmRestore(): Promise<void> {
  if (!pendingRestore) return;
  const plan = planRestore(pendingRestore.stash, pendingRestore.tabIds);
  els.restoreConfirm.close();
  await restoreTabs(plan);
  void track('stash_restored_all');
  setStatus(`Restored ${plan.tabs.length} tabs`);
  pendingRestore = null;
}

/* ── Delete / export ─────────────────────────────────────────────────── */

async function removeStash(stash: Stash): Promise<void> {
  if (!confirm(`Delete “${stash.name}”? This can't be undone unless you exported it first.`)) return;
  await deleteStashRecord(stash.id);
  void track('stash_deleted');
  setStatus('Stash deleted.');
  await load();
}

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportOne(stash: Stash, format: 'md' | 'csv'): Promise<void> {
  const content = format === 'md' ? toMarkdown(stash) : toCsv(stash);
  const type = format === 'md' ? 'text/markdown' : 'text/csv';
  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename(stash.name, format));
    setStatus(`Saved .${format}`);
    void track(format === 'md' ? 'export_md' : 'export_csv');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${format} file.`);
  }
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear old stashes.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `tab-stash-backup-${stamp}.json`);
    setStatus(`Exported ${backup.stashes.length} stash${backup.stashes.length === 1 ? '' : 'es'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.tabs} tab${result.tabs === 1 ? '' : 's'} across ${result.stashes} new stash${result.stashes === 1 ? '' : 'es'}`);
    void track('data_imported');
    await load();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const ratio = restoreRatio(metrics);
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    ratio === null ? 'Restore rate: no data yet' : `Restore rate: ${ratio}% of stashes created have been restored`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Export all (Markdown/CSV across every stash) ───────────────────── */

async function exportAll(format: 'md' | 'csv'): Promise<void> {
  const content = format === 'md' ? toMarkdownAll(stashes) : toCsvAll(stashes);
  const type = format === 'md' ? 'text/markdown' : 'text/csv';
  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename('all stashes', format));
    setStatus(`Saved .${format}`);
    void track(format === 'md' ? 'export_md' : 'export_csv');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${format} file.`);
  }
}
/* ── Wiring ──────────────────────────────────────────────────────────── */

els.newStash.addEventListener('click', () => void openNewStashDialog());
els.selectAll.addEventListener('click', () => {
  pickerCheckboxes().forEach(cb => (cb.checked = true));
  els.stashName.placeholder = defaultStashName(selectedCount());
});
els.selectNone.addEventListener('click', () => {
  pickerCheckboxes().forEach(cb => (cb.checked = false));
  els.stashName.placeholder = defaultStashName(selectedCount());
});
els.tabPicker.addEventListener('change', () => {
  els.stashName.placeholder = defaultStashName(selectedCount());
});
els.newStashCancel.addEventListener('click', () => els.newStashDialog.close());
els.newStashSave.addEventListener('click', () => void saveNewStash());

els.restoreConfirmCancel.addEventListener('click', () => {
  pendingRestore = null;
  els.restoreConfirm.close();
});
els.restoreConfirmGo.addEventListener('click', () => void confirmRestore());

els.search.addEventListener('input', () => render());

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());
els.dataExport.addEventListener('click', () => void exportAllData());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.exportAllMd.addEventListener('click', () => void exportAll('md'));
els.exportAllCsv.addEventListener('click', () => void exportAll('csv'));
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every stash? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void load();
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
  void track('panel_opened');
  await load();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');

  const options = await readOptions();
  void writeOptions(options); // ensures the key exists on first run
})();
