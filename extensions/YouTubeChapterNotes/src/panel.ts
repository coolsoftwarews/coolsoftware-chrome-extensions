/**
 * The side panel: the current video's chapter notes. Unlike
 * RedditVoiceOfCustomer's standing library, this panel *is* a per-page view —
 * "the notes for the video in front of you" is the whole product — so it
 * needs the one live-tab-state message RedditOpportunityMonitor's memory
 * note calls out (a single request/response pair, everything else storage-
 * only). Notes themselves are never relayed through messaging: content.ts
 * writes them straight to chrome.storage.local, and this panel refreshes on
 * chrome.storage.onChanged like every other Saver-shaped panel in this
 * portfolio.
 */

import { buildFilename, timeLabel, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import { notesForVideo } from './notes';
import {
  clearAllData,
  deleteNote,
  exportBackup,
  importBackup,
  quotaStatus,
  readNotes,
  updateNoteText,
} from './storage';
import { TabState, VideoNote } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  videoTitle: $('video-title'),
  refresh: $<HTMLButtonElement>('refresh'),
  search: $<HTMLInputElement>('search'),
  dlMd: $<HTMLButtonElement>('dl-md'),
  dlCsv: $<HTMLButtonElement>('dl-csv'),
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

  usage: $<HTMLDialogElement>('usage'),
  usageToggle: $<HTMLButtonElement>('usage-toggle'),
  usageBody: $('usage-body'),
  usageClear: $<HTMLButtonElement>('usage-clear'),
  usageClose: $<HTMLButtonElement>('usage-close'),
};

let allNotes: VideoNote[] = [];
let currentTab: TabState | null = null;
let currentTabId: number | null = null;
let search = '';

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Talking to the content script: the only live-tab state this panel
   needs (which video, which tab) — everything else is chrome.storage.local. */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function pingState(tabId: number): Promise<TabState | null> {
  try {
    const state = (await chrome.tabs.sendMessage(tabId, { type: 'YCN_GET_STATE' })) as TabState | null;
    return state ?? null;
  } catch {
    return null;
  }
}

async function loadState(): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id) {
    currentTab = null;
    currentTabId = null;
    await loadNotes();
    return;
  }
  currentTabId = tab.id;
  currentTab = await pingState(tab.id);
  await loadNotes();
}

async function loadNotes(): Promise<void> {
  allNotes = await readNotes();
  render();
  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your notes from “Data”.');
}

/* ── Filtering + rendering ──────────────────────────────────────────── */

function matches(note: VideoNote, query: string): boolean {
  if (!query) return true;
  return note.text.toLowerCase().includes(query);
}

function render(): void {
  els.dlMd.disabled = !currentTab;
  els.dlCsv.disabled = !currentTab;

  if (!currentTab) {
    els.videoTitle.textContent = '';
    els.search.disabled = true;
    showEmpty('Open a YouTube video to start taking notes. Click “+ Note” under the player, or press Alt+Shift+N.');
    return;
  }

  els.search.disabled = false;
  els.videoTitle.textContent = currentTab.videoTitle;

  const videoNotes = notesForVideo(allNotes, currentTab.videoId);
  const query = search.trim().toLowerCase();
  const filtered = videoNotes.filter(n => matches(n, query));

  if (!videoNotes.length) {
    showEmpty('No notes yet for this video. Click “+ Note” under the player (or press Alt+Shift+N) to add your first one.');
    return;
  }
  if (!filtered.length) {
    showEmpty(`No notes match “${search.trim()}”.`);
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;
  els.list.replaceChildren();
  for (const note of filtered) els.list.appendChild(renderItem(note));

  setStatus(`Showing ${filtered.length} of ${videoNotes.length} note${videoNotes.length === 1 ? '' : 's'}`);
}

function showEmpty(message: string): void {
  els.list.hidden = true;
  els.state.hidden = false;
  els.state.replaceChildren();
  const text = document.createElement('p');
  text.className = 'state__text';
  text.textContent = message;
  els.state.appendChild(text);
  setStatus('');
}

function renderItem(note: VideoNote): HTMLElement {
  const item = document.createElement('li');
  item.className = 'item';

  const badge = document.createElement('button');
  badge.type = 'button';
  badge.className = note.isLive ? 'item__timestamp item__timestamp--live' : 'item__timestamp';
  badge.textContent = note.isLive ? `${timeLabel(note.seconds)} · live` : timeLabel(note.seconds);
  if (note.isLive) {
    badge.disabled = true;
    badge.title = 'Captured during a livestream — the buffer may have moved on, so this timestamp may not land back here.';
  } else {
    badge.title = 'Jump to this moment';
    badge.addEventListener('click', () => void seekTo(note));
  }
  item.appendChild(badge);

  const main = document.createElement('div');
  main.className = 'item__main';

  const text = document.createElement('p');
  text.className = 'item__text';
  text.textContent = note.text;
  text.title = 'Click to edit';
  text.addEventListener('click', () => {
    editor.classList.add('item__edit--open');
    text.style.display = 'none';
    editor.focus();
  });
  main.appendChild(text);

  const editor = document.createElement('textarea');
  editor.className = 'item__edit';
  editor.rows = 2;
  editor.value = note.text;
  editor.addEventListener('blur', () => {
    editor.classList.remove('item__edit--open');
    text.style.display = '';
    const value = editor.value.trim();
    if (value === note.text || !value) {
      editor.value = note.text;
      return;
    }
    void updateNoteText(note.id, value).then(() => {
      void track('note_edited');
      void loadNotes();
    });
  });
  main.appendChild(editor);

  const actions = document.createElement('div');
  actions.className = 'item__actions';

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'link-btn';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => {
    void deleteNote(note.id).then(() => {
      void track('note_deleted');
      void loadNotes();
    });
  });
  actions.appendChild(deleteButton);

  main.appendChild(actions);
  item.appendChild(main);
  return item;
}

async function seekTo(note: VideoNote): Promise<void> {
  if (currentTabId === null) return;
  try {
    await chrome.tabs.sendMessage(currentTabId, { type: 'YCN_SEEK', seconds: note.seconds });
    void track('seek_used');
  } catch {
    setStatus('Could not reach the video. Reload the YouTube tab.');
  }
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

async function exportAs(kind: 'md' | 'csv'): Promise<void> {
  if (!currentTab) return;
  const videoNotes = notesForVideo(allNotes, currentTab.videoId);
  const content = kind === 'md' ? toMarkdown(currentTab.videoTitle, currentTab.videoId, videoNotes) : toCsv(currentTab.videoTitle, currentTab.videoId, videoNotes);
  const type = kind === 'md' ? 'text/markdown' : 'text/csv';
  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename(currentTab.videoTitle, kind));
    setStatus(`Saved .${kind}`);
    void track(kind === 'md' ? 'export_md' : 'export_csv');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${kind} file.`);
  }
}

/* ── Data ownership ─────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some notes.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `youtube-chapter-notes-backup-${stamp}.json`);
    setStatus(`Exported ${backup.notes.length} note${backup.notes.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.notes} note${result.notes === 1 ? '' : 's'}`);
    void track('data_imported');
    await loadNotes();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage sheet ─────────────────────────────────────────────────────── */

async function openUsage(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.usageBody.textContent = lines.join('\n');
  els.usage.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void loadState());

let searchTimer: number | undefined;
els.search.addEventListener('input', () => {
  search = els.search.value;
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    render();
    if (search.trim()) void track('search_used');
  }, 60);
});

els.dlMd.addEventListener('click', () => void exportAs('md'));
els.dlCsv.addEventListener('click', () => void exportAs('csv'));

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
  if (!confirm('Delete every saved note? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void loadNotes();
  });
});

els.usageToggle.addEventListener('click', () => void openUsage());
els.usageClose.addEventListener('click', () => els.usage.close());
els.usageClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.usageBody.textContent = 'Counters reset.';
  });
});

// content.ts and this panel never message each other about the notes
// themselves — both write to chrome.storage.local, and this fires in every
// context when either does.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['ycn:notes']) void loadNotes();
});

// The one thing storage can never tell this panel: which video is on screen
// right now. content.ts pushes this on every YouTube SPA navigation while
// the panel happens to be open; switching tabs/windows re-asks directly.
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'YCN_VIDEO_CHANGED') {
    currentTab = (message.state as TabState | null) ?? null;
    render();
  }
});

chrome.tabs.onActivated.addListener(() => void loadState());

void (async () => {
  void track('panel_opened');
  await loadState();
})();
