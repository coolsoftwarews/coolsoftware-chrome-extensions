/**
 * The side panel: every noted profile, searchable and sortable, with tag
 * filtering, inline editing, CSV export and the data-ownership surface.
 * Everything here reads chrome.storage.local directly — there is no per-tab
 * state to ask a content script for, since notes are global, not per-page
 * (PRD §4).
 */

import { buildFilename, toCsv } from './export';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  clearAllData,
  deleteNote,
  exportBackup,
  importBackup,
  listNotes,
  quotaStatus,
  upsertNote,
} from './storage';
import { ProfileNote, SortMode } from './types';
import { formatRelativeTime } from './text';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  refresh: $<HTMLButtonElement>('refresh'),
  controls: $('controls'),
  search: $<HTMLInputElement>('search'),
  sortRecency: $<HTMLButtonElement>('sort-recency'),
  sortAlpha: $<HTMLButtonElement>('sort-alpha'),
  tagFilters: $('tag-filters'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  body: $('body'),
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

let notes: ProfileNote[] = [];
let sortMode: SortMode = 'recency';
let activeTag: string | null = null;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(text: string, variant: '' | 'error' = ''): void {
  els.state.hidden = false;
  els.state.className = `state${variant ? ` state--${variant}` : ''}`;
  els.state.replaceChildren();
  const p = document.createElement('p');
  p.className = 'state__text';
  p.textContent = text;
  els.state.append(p);
  els.list.hidden = true;
}

/** The empty state shown when nothing can be shown yet — same shape across the portfolio. */
function showGate(title: string, body: string, actionLabel?: string, action?: () => void): void {
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

  if (actionLabel && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary gate__action';
    button.textContent = actionLabel;
    button.addEventListener('click', action);
    els.state.append(button);
  }
}

/* ── Loading + refresh ───────────────────────────────────────────────── */

async function refresh(): Promise<void> {
  try {
    notes = await listNotes();
  } catch {
    // Never surface the raw storage error — just say what the user can do.
    showState('Something went wrong loading your notes. Try reopening the panel.', 'error');
    els.controls.hidden = true;
    return;
  }

  if (!notes.length) {
    els.controls.hidden = true;
    els.summary.textContent = '';
    showGate(
      'Note your first profile',
      'Open a LinkedIn profile and click "+ Note" next to their name. Your notes stay on this device — no account, no cloud.',
      'Open LinkedIn',
      () => void chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' })
    );
    return;
  }

  if (activeTag && !notes.some(note => note.tag === activeTag)) activeTag = null;

  els.controls.hidden = false;
  renderTagFilters();
  renderList();
}

/* ── Tag filter chips ───────────────────────────────────────────────── */

function renderTagFilters(): void {
  const tags = Array.from(new Set(notes.map(note => note.tag).filter(Boolean))).sort();
  els.tagFilters.replaceChildren();
  if (!tags.length) return;

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `chip${activeTag === null ? ' chip--on' : ''}`;
  allChip.setAttribute('aria-pressed', String(activeTag === null));
  allChip.textContent = 'All tags';
  allChip.addEventListener('click', () => {
    activeTag = null;
    void track('tag_filter_changed');
    renderTagFilters();
    renderList();
  });
  els.tagFilters.append(allChip);

  for (const tag of tags) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${activeTag === tag ? ' chip--on' : ''}`;
    chip.setAttribute('aria-pressed', String(activeTag === tag));
    chip.textContent = tag;
    chip.addEventListener('click', () => {
      activeTag = activeTag === tag ? null : tag;
      void track('tag_filter_changed');
      renderTagFilters();
      renderList();
    });
    els.tagFilters.append(chip);
  }
}

/* ── Note list ───────────────────────────────────────────────────────── */

function visibleNotes(): ProfileNote[] {
  const query = els.search.value.trim().toLowerCase();
  let rows = notes;
  if (activeTag) rows = rows.filter(note => note.tag === activeTag);
  if (query) {
    rows = rows.filter(note =>
      [note.name, note.headline, note.tag, note.text].some(field => field.toLowerCase().includes(query))
    );
  }
  return [...rows].sort((a, b) => {
    if (sortMode === 'alpha') return a.name.localeCompare(b.name);
    return b.lastNotedAt - a.lastNotedAt;
  });
}

function renderList(): void {
  const rows = visibleNotes();

  els.summary.textContent = `${notes.length} noted profile${notes.length === 1 ? '' : 's'}`;

  els.list.replaceChildren();

  if (!rows.length) {
    els.list.hidden = true;
    els.state.hidden = false;
    els.state.className = 'state';
    els.state.replaceChildren();
    const p = document.createElement('p');
    p.className = 'state__text';
    p.textContent = els.search.value.trim() || activeTag
      ? 'No notes match that search or filter.'
      : 'No notes yet.';
    els.state.append(p);
    setStatus('');
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;

  for (const note of rows) {
    const item = document.createElement('li');
    item.className = 'item';

    const head = document.createElement('div');
    head.className = 'item__head';

    const name = document.createElement('a');
    name.className = 'item__name';
    name.href = note.id;
    name.target = '_blank';
    name.rel = 'noopener noreferrer';
    name.textContent = note.name || note.id;
    head.append(name);

    if (note.tag) {
      const tag = document.createElement('span');
      tag.className = 'item__tag';
      tag.textContent = note.tag;
      head.append(tag);
    }

    const meta = document.createElement('span');
    meta.className = 'item__meta';
    meta.textContent = `last noted ${formatRelativeTime(note.lastNotedAt)}`;
    head.append(meta);
    item.append(head);

    if (note.headline) {
      const headline = document.createElement('p');
      headline.className = 'item__headline';
      headline.textContent = note.headline;
      item.append(headline);
    }

    const editor = document.createElement('textarea');
    editor.className = 'item__note-edit';
    editor.rows = 3;
    editor.value = note.text;
    editor.placeholder = 'Your note…';

    const tagEditor = document.createElement('input');
    tagEditor.type = 'text';
    tagEditor.className = 'item__tag-edit';
    tagEditor.value = note.tag;
    tagEditor.placeholder = 'tag';

    async function saveEdits(): Promise<void> {
      if (editor.value === note.text && tagEditor.value === note.tag) return;
      await upsertNote({
        id: note.id,
        name: note.name,
        headline: note.headline,
        avatarUrl: note.avatarUrl,
        text: editor.value,
        tag: tagEditor.value.trim(),
      });
      void track('note_saved');
      void refresh();
    }
    editor.addEventListener('blur', () => void saveEdits());
    tagEditor.addEventListener('blur', () => void saveEdits());

    const actions = document.createElement('div');
    actions.className = 'item__actions';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'link-btn';
    deleteButton.textContent = 'Delete note';
    deleteButton.addEventListener('click', () => {
      if (!confirm(`Delete your note on ${note.name || 'this profile'}?`)) return;
      void deleteNote(note.id).then(() => {
        void track('note_deleted');
        void refresh();
      });
    });
    actions.append(deleteButton);

    item.append(editor, tagEditor, actions);
    els.list.append(item);
  }

  setStatus(`${rows.length} note${rows.length === 1 ? '' : 's'} shown`);
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

async function exportCsv(): Promise<void> {
  try {
    await download(new Blob([toCsv(notes)], { type: 'text/csv;charset=utf-8' }), buildFilename('csv'));
    setStatus('Saved .csv');
    void track('export_csv');
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'Could not save the .csv file.'));
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and consider clearing some of it.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `linkedin-profile-notes-backup-${stamp}.json`);
    setStatus(`Exported ${backup.notes.length} notes`);
    void track('data_exported');
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'Could not save the backup.'));
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.notes} notes`);
    void track('data_imported');
    await refresh();
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'That file could not be read.'));
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `Notes now: ${notes.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

function setSort(next: SortMode): void {
  sortMode = next;
  els.sortRecency.classList.toggle('seg--on', next === 'recency');
  els.sortRecency.setAttribute('aria-pressed', String(next === 'recency'));
  els.sortAlpha.classList.toggle('seg--on', next === 'alpha');
  els.sortAlpha.setAttribute('aria-pressed', String(next === 'alpha'));
  void track('sort_changed');
  renderList();
}

els.refresh.addEventListener('click', () => void refresh());
els.sortRecency.addEventListener('click', () => setSort('recency'));
els.sortAlpha.addEventListener('click', () => setSort('alpha'));

let searchTimer: number | undefined;
els.search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(renderList, 120);
});

els.exportCsv.addEventListener('click', () => void exportCsv());

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
  if (!confirm('Delete every noted profile? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void refresh();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

// Content scripts write directly to storage as the user browses; the panel
// should pick that up without the user having to press refresh.
let liveRefreshTimer: number | undefined;
chrome.storage.onChanged.addListener(changes => {
  const relevant = Object.keys(changes).some(key => key.startsWith('lpn:note:'));
  if (!relevant) return;
  window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = window.setTimeout(() => void refresh(), 300);
});

void (async () => {
  void track('panel_opened');
  await refresh();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from "Data".');
})();
