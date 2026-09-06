/**
 * The side panel: the whole library (drafts, templates, archived published
 * posts), search/filter, "insert into composer", export and the data
 * ownership surface (export / import / clear).
 *
 * The panel owns no state of its own for library items — chrome.storage.local
 * is read directly (a Saver-shaped extension, per this portfolio's own
 * pattern notes: once an item is captured it's just data, no per-tab relay
 * needed for reads). It subscribes to chrome.storage.onChanged so any write
 * from the content script shows up here without polling.
 */

import { buildFilename, toCsv, toMarkdown } from './exporters';
import { clearMetrics, readMetrics, track } from './metrics';
import { parseTags, searchItems, uniqueTags } from './search';
import {
  clearAllData,
  exportBackup,
  importBackup,
  newId,
  quotaStatus,
  readAllItems,
  writeItem,
  deleteItem as removeItem,
} from './storage';
import { ComposerState, ItemKind, LibraryItem } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  composerStatus: $('composer-status'),
  search: $<HTMLInputElement>('search'),
  kindAll: $<HTMLButtonElement>('kind-all'),
  kindDraft: $<HTMLButtonElement>('kind-draft'),
  kindTemplate: $<HTMLButtonElement>('kind-template'),
  kindPublished: $<HTMLButtonElement>('kind-published'),
  tagFilter: $<HTMLSelectElement>('tag-filter'),
  newTemplateBtn: $<HTMLButtonElement>('new-template'),
  composer: $('composer'),
  composerText: $<HTMLTextAreaElement>('composer-text'),
  composerTags: $<HTMLInputElement>('composer-tags'),
  composerCancel: $<HTMLButtonElement>('composer-cancel'),
  composerSave: $<HTMLButtonElement>('composer-save'),
  state: $('state'),
  list: $<HTMLUListElement>('list'),
  status: $('status'),
  exportToggle: $<HTMLButtonElement>('export-toggle'),
  exportDialog: $<HTMLDialogElement>('export'),
  scopeVisible: $<HTMLButtonElement>('scope-visible'),
  scopeAll: $<HTMLButtonElement>('scope-all'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  exportClose: $<HTMLButtonElement>('export-close'),
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

let items: LibraryItem[] = [];
let query = '';
let kindFilter: ItemKind | null = null;
let tagFilter: string | null = null;
let exportScope: 'visible' | 'all' = 'visible';
let tabId: number | null = null;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function visibleItems(): LibraryItem[] {
  return searchItems(items, { query, kind: kindFilter ?? undefined, tag: tagFilter ?? undefined });
}

/* ── Talking to the active LinkedIn tab (composer only) ────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask<T>(message: unknown): Promise<T | null> {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

async function refreshComposerStatus(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;
  const state = await ask<ComposerState>({ type: 'PDB_GET_COMPOSER_STATE' });
  els.composerStatus.textContent = state?.open
    ? 'A post composer is open — templates can be inserted now.'
    : 'Open “Start a post” on LinkedIn to insert a template, or just to see the “see more” marker.';
}

/* ── List rendering ──────────────────────────────────────────────────── */

function renderTagFilter(): void {
  const tags = uniqueTags(items);
  const current = els.tagFilter.value;
  els.tagFilter.replaceChildren();
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All tags';
  els.tagFilter.appendChild(allOpt);
  for (const tag of tags) {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    els.tagFilter.appendChild(opt);
  }
  if (tags.includes(current)) els.tagFilter.value = current;
}

const KIND_LABEL: Record<ItemKind, string> = { draft: 'Draft', template: 'Template', published: 'Published' };

function itemDateLabel(item: LibraryItem): string {
  if (item.kind === 'published') return item.publishedAtLabel || new Date(item.updatedAt).toLocaleDateString('en-US');
  return new Date(item.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function render(): void {
  const shown = visibleItems();
  els.list.replaceChildren();

  if (!shown.length) {
    els.state.hidden = false;
    els.list.hidden = true;
    const text = els.state.querySelector('.state__text');
    if (text) {
      text.textContent = items.length
        ? 'Nothing matches this search or filter.'
        : 'Nothing here yet. Start a post on LinkedIn to save a draft, or add a template right here.';
    }
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;

  for (const item of shown) {
    const li = document.createElement('li');
    li.className = `item item--${item.kind}`;

    const head = document.createElement('div');
    head.className = 'item__head';

    const badge = document.createElement('span');
    badge.className = `badge badge--${item.kind}`;
    badge.textContent = KIND_LABEL[item.kind];
    head.appendChild(badge);

    if (item.kind === 'draft' && item.autosaved) {
      const auto = document.createElement('span');
      auto.className = 'badge badge--auto';
      auto.textContent = 'Auto-saved';
      head.appendChild(auto);
    }

    const meta = document.createElement('span');
    meta.className = 'item__meta';
    meta.textContent = itemDateLabel(item);
    head.appendChild(meta);

    const textEl = document.createElement('p');
    textEl.className = 'item__text';
    textEl.textContent = item.text;
    textEl.title = 'Click to expand';
    textEl.addEventListener('click', () => textEl.classList.toggle('item__text--full'));

    const textEdit = document.createElement('textarea');
    textEdit.className = 'item__text-edit';
    textEdit.value = item.text;
    textEdit.addEventListener('blur', () => {
      if (textEdit.value === item.text) return;
      void writeItem({ ...item, text: textEdit.value, updatedAt: Date.now() }).then(() => void refreshItems());
    });

    const tagsEl = document.createElement('div');
    tagsEl.className = 'item__tags';
    for (const tag of item.tags) {
      const chip = document.createElement('span');
      chip.className = 'tag';
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    }

    const tagEdit = document.createElement('input');
    tagEdit.className = 'item__tag-edit';
    tagEdit.type = 'text';
    tagEdit.value = item.tags.join(', ');
    tagEdit.placeholder = 'Tags (comma separated)';
    tagEdit.addEventListener('blur', () => {
      const next = parseTags(tagEdit.value);
      if (next.join(',') === item.tags.join(',')) return;
      void writeItem({ ...item, tags: next, updatedAt: Date.now() }).then(() => void refreshItems());
    });

    const actions = document.createElement('div');
    actions.className = 'item__actions';

    if (item.kind === 'template') {
      const insertBtn = document.createElement('button');
      insertBtn.type = 'button';
      insertBtn.className = 'link-btn';
      insertBtn.textContent = 'Insert into composer';
      insertBtn.addEventListener('click', () => void insertTemplate(item));
      actions.appendChild(insertBtn);
    }

    if (item.kind !== 'published') {
      const editTextBtn = document.createElement('button');
      editTextBtn.type = 'button';
      editTextBtn.className = 'link-btn';
      editTextBtn.textContent = 'Edit text';
      editTextBtn.addEventListener('click', () => {
        textEdit.classList.toggle('item__text-edit--open');
        textEdit.focus();
      });
      actions.appendChild(editTextBtn);
    }

    const editTagsBtn = document.createElement('button');
    editTagsBtn.type = 'button';
    editTagsBtn.className = 'link-btn';
    editTagsBtn.textContent = 'Edit tags';
    editTagsBtn.addEventListener('click', () => {
      tagEdit.classList.toggle('item__tag-edit--open');
      tagEdit.focus();
    });
    actions.appendChild(editTagsBtn);

    if (item.postUrl) {
      const link = document.createElement('a');
      link.href = item.postUrl;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'link-btn';
      link.textContent = 'Open post';
      actions.appendChild(link);
    }

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'link-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.style.marginLeft = 'auto';
    deleteBtn.addEventListener('click', () => void remove(item.id));
    actions.appendChild(deleteBtn);

    li.append(head, textEl, textEdit, tagsEl, tagEdit, actions);
    els.list.appendChild(li);
  }

  setStatus(`${shown.length} of ${items.length} item${items.length === 1 ? '' : 's'}`);
}

async function refreshItems(): Promise<void> {
  items = await readAllItems();
  renderTagFilter();
  render();
}

async function insertTemplate(item: LibraryItem): Promise<void> {
  const result = await ask<{ ok: boolean; error?: string }>({ type: 'PDB_INSERT_TEMPLATE', text: item.text });
  if (result?.ok) {
    setStatus('Inserted into the open composer.');
    void track('template_inserted');
  } else {
    setStatus(result?.error || 'Open a post composer on LinkedIn first.');
  }
}

async function remove(id: string): Promise<void> {
  await removeItem(id);
  void track('item_deleted');
  await refreshItems();
}

/* ── New template composer ──────────────────────────────────────────── */

function openComposer(): void {
  els.composer.classList.add('composer--open');
  els.composerText.value = '';
  els.composerTags.value = '';
  els.composerText.focus();
}

function closeComposer(): void {
  els.composer.classList.remove('composer--open');
}

async function saveNewTemplate(): Promise<void> {
  const text = els.composerText.value.trim();
  if (!text) {
    setStatus('Write something before saving a template.');
    return;
  }
  const now = Date.now();
  await writeItem({
    id: newId(),
    kind: 'template',
    text,
    tags: parseTags(els.composerTags.value),
    createdAt: now,
    updatedAt: now,
  });
  void track('template_saved');
  closeComposer();
  await refreshItems();
  setStatus('Template saved.');
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function exportRows(): LibraryItem[] {
  return exportScope === 'all' ? items : visibleItems();
}

async function exportAs(format: 'csv' | 'md'): Promise<void> {
  const rows = exportRows();
  const content = format === 'csv' ? toCsv(rows) : toMarkdown(rows);
  const type = format === 'csv' ? 'text/csv' : 'text/markdown';
  try {
    await download(
      new Blob([content], { type: `${type};charset=utf-8` }),
      buildFilename('linkedin-post-draft-bank', format)
    );
    setStatus(`Saved .${format} (${rows.length} item${rows.length === 1 ? '' : 's'})`);
    void track(format === 'csv' ? 'export_csv' : 'export_md');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${format} file.`);
  }
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some items.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `linkedin-post-draft-bank-backup-${stamp}.json`);
    setStatus(`Exported ${backup.items.length} item${backup.items.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.items} item${result.items === 1 ? '' : 's'} (${result.newItems} new)`);
    void track('data_imported');
    await refreshItems();
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

function setKindFilter(kind: ItemKind | null): void {
  kindFilter = kind;
  for (const [btn, k] of [
    [els.kindAll, null],
    [els.kindDraft, 'draft'],
    [els.kindTemplate, 'template'],
    [els.kindPublished, 'published'],
  ] as const) {
    btn.classList.toggle('seg--on', k === kind);
  }
  render();
}

els.search.addEventListener('input', () => {
  query = els.search.value;
  if (query.trim()) void track('search_used');
  render();
});

els.kindAll.addEventListener('click', () => setKindFilter(null));
els.kindDraft.addEventListener('click', () => setKindFilter('draft'));
els.kindTemplate.addEventListener('click', () => setKindFilter('template'));
els.kindPublished.addEventListener('click', () => setKindFilter('published'));

els.tagFilter.addEventListener('change', () => {
  tagFilter = els.tagFilter.value || null;
  render();
});

els.newTemplateBtn.addEventListener('click', () => openComposer());
els.composerCancel.addEventListener('click', () => closeComposer());
els.composerSave.addEventListener('click', () => void saveNewTemplate());

els.exportToggle.addEventListener('click', () => els.exportDialog.showModal());
els.exportClose.addEventListener('click', () => els.exportDialog.close());
els.scopeVisible.addEventListener('click', () => {
  exportScope = 'visible';
  els.scopeVisible.classList.add('seg--on');
  els.scopeAll.classList.remove('seg--on');
});
els.scopeAll.addEventListener('click', () => {
  exportScope = 'all';
  els.scopeAll.classList.add('seg--on');
  els.scopeVisible.classList.remove('seg--on');
});
els.exportCsv.addEventListener('click', () => void exportAs('csv'));
els.exportMd.addEventListener('click', () => void exportAs('md'));

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
  if (!confirm('Delete every draft, template and archived post? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void refreshItems();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

chrome.storage.onChanged.addListener(changes => {
  if (Object.keys(changes).some(key => key.startsWith('pdb:item:'))) void refreshItems();
});

chrome.tabs.onActivated.addListener(() => void refreshComposerStatus());
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (changeInfo.status === 'complete') void refreshComposerStatus();
});

void (async () => {
  void track('panel_opened');
  await refreshItems();
  await refreshComposerStatus();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
})();
