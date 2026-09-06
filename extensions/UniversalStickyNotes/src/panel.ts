/**
 * The side panel: a live, searchable list of every note across every page
 * (PRD §4). Unlike WebHighlighter's panel, which is scoped to whatever page
 * is currently open, this panel's whole job is the cross-page view — so it
 * reads storage directly rather than only asking a content script, which is
 * what lets it show and manage pages that aren't even open in a tab right
 * now. The "This page" section at the top is the one place it still talks to
 * the live content script, for the two things that need a real DOM: creating
 * a note at a sensible default spot, and scrolling to one.
 */

import { buildBackupFilename, buildMarkdownFilename, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  clearAllData,
  exportBackup,
  importBackup,
  mutateExistingPage,
  PAGE_PREFIX,
  quotaStatus,
  readAllPages,
  readPage,
} from './storage';
import { COLOR_VALUES, Note, PageRecord, PageState } from './types';
import { isSupportedUrl, normalizeUrl } from './url';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  thisGate: $('this-gate'),
  thisHead: $('this-head'),
  thisTitle: $('this-title'),
  thisMeta: $('this-meta'),
  thisAdd: $<HTMLButtonElement>('this-add'),
  thisHidden: $<HTMLInputElement>('this-hidden'),
  thisEmpty: $('this-empty'),
  thisList: $<HTMLUListElement>('this-list'),
  search: $<HTMLInputElement>('search'),
  state: $('state'),
  allList: $('all-list'),
  status: $('status'),
  exportMd: $<HTMLButtonElement>('export-md'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  data: $<HTMLDialogElement>('data'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let pages: PageRecord[] = [];
let activeTabId: number | null = null;
let activeUrl: string | null = null;
let query = '';
let searchDebounce: number | undefined;

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Talking to the active tab ───────────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask<T>(tabId: number, message: unknown): Promise<T | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    // No content script: a restricted page, or the tab hasn't finished loading.
    return null;
  }
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function refresh(): Promise<void> {
  pages = await readAllPages();

  const tab = await activeTab();
  activeTabId = tab?.id ?? null;
  activeUrl = tab?.url && isSupportedUrl(tab.url) ? normalizeUrl(tab.url) : null;

  await renderThisPage(tab ?? null);
  renderAllNotes();
}

async function renderThisPage(tab: chrome.tabs.Tab | null): Promise<void> {
  if (!tab || !activeUrl || activeTabId === null) {
    els.thisGate.hidden = false;
    els.thisHead.hidden = true;
    els.thisList.hidden = true;
    els.thisEmpty.hidden = true;
    els.thisAdd.disabled = true;
    els.thisHidden.disabled = true;
    return;
  }

  els.thisGate.hidden = true;
  els.thisHead.hidden = false;
  els.thisAdd.disabled = false;

  const state = await ask<PageState>(activeTabId, { type: 'SN_GET_STATE' });
  // The content script may not be injected yet (tab open since before install
  // or update) — fall back to whatever is already in storage for this page.
  const record = state ? null : await readPage(activeUrl);
  const notes = state?.notes ?? record?.notes ?? [];
  const isHidden = state?.hidden ?? record?.hidden ?? false;

  els.thisTitle.textContent = tab.title || activeUrl;
  els.thisMeta.textContent = activeUrl;
  els.thisHidden.disabled = false;
  els.thisHidden.checked = isHidden;

  els.thisList.replaceChildren();
  if (!notes.length) {
    els.thisList.hidden = true;
    els.thisEmpty.hidden = false;
  } else {
    els.thisEmpty.hidden = true;
    els.thisList.hidden = false;
    for (const note of [...notes].sort((a, b) => a.createdAt - b.createdAt)) {
      els.thisList.appendChild(buildNoteItem(note, activeUrl, true));
    }
  }
}

/* ── Note list items (shared by "This page" and "All notes") ───────────── */

function buildNoteItem(note: Note, url: string, isCurrentPage: boolean, pageLabel?: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'item__jump';
  jump.title = isCurrentPage ? 'Scroll to this note' : 'Open this page and scroll to the note';
  jump.setAttribute('aria-label', jump.title);
  jump.addEventListener('click', () => void jumpToNote(url, note.id, isCurrentPage));

  const dot = document.createElement('span');
  dot.className = 'item__dot';
  dot.style.background = COLOR_VALUES[note.color];
  jump.appendChild(dot);

  const body = document.createElement('span');
  body.className = 'item__body';

  if (pageLabel) {
    const label = document.createElement('span');
    label.className = 'item__page';
    label.textContent = pageLabel;
    body.appendChild(label);
  }

  const text = document.createElement('span');
  text.className = 'item__text';
  text.textContent = note.text.trim() || '(empty note)';
  body.appendChild(text);
  jump.appendChild(body);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'item__delete';
  del.title = 'Delete note';
  del.setAttribute('aria-label', 'Delete note');
  del.textContent = '×';
  del.addEventListener('click', event => {
    event.stopPropagation();
    void deleteNote(url, note.id);
  });

  li.append(jump, del);
  return li;
}

async function deleteNote(url: string, id: string): Promise<void> {
  await mutateExistingPage(url, record => {
    record.notes = record.notes.filter(note => note.id !== id);
  });
  void track('note_deleted');
  await refresh();
}

async function jumpToNote(url: string, id: string, isCurrentPage: boolean): Promise<void> {
  void track('page_jumped_to');

  if (isCurrentPage && activeTabId !== null) {
    const result = await ask<{ ok: boolean }>(activeTabId, { type: 'SN_SCROLL_TO', id });
    if (!result?.ok) setStatus('That note could not be found on the page right now — try reloading.');
    return;
  }

  const tabs = await chrome.tabs.query({});
  const match = tabs.find(t => t.url && isSupportedUrl(t.url) && normalizeUrl(t.url) === url);

  if (match?.id !== undefined) {
    await chrome.tabs.update(match.id, { active: true });
    if (match.windowId !== undefined) await chrome.windows.update(match.windowId, { focused: true });
    const matchedId = match.id;
    // Give the tab a moment to regain focus/paint before asking it to scroll.
    window.setTimeout(() => void ask(matchedId, { type: 'SN_SCROLL_TO', id }), 150);
  } else {
    await chrome.tabs.create({ url });
  }
}

/* ── All notes (searchable, grouped by page) ────────────────────────────── */

function renderAllNotes(): void {
  const q = query.trim().toLowerCase();
  const totalNotes = pages.reduce((sum, page) => sum + page.notes.length, 0);

  if (!totalNotes) {
    els.allList.replaceChildren();
    els.allList.hidden = true;
    showEmptyState();
    return;
  }

  const filtered = pages
    .map(page => ({
      page,
      notes: page.notes.filter(
        note =>
          !q ||
          note.text.toLowerCase().includes(q) ||
          page.meta.title.toLowerCase().includes(q) ||
          page.meta.url.toLowerCase().includes(q)
      ),
    }))
    .filter(entry => entry.notes.length);

  els.state.hidden = true;
  els.allList.hidden = false;
  els.allList.replaceChildren();

  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'muted small';
    empty.textContent = `No notes match "${query}".`;
    els.allList.appendChild(empty);
    return;
  }

  for (const { page, notes } of filtered) {
    const section = document.createElement('section');
    section.className = 'group';

    const heading = document.createElement('p');
    heading.className = 'group__heading';
    heading.title = page.meta.url;
    heading.textContent = `${page.meta.title || page.meta.url} · ${notes.length}`;
    section.appendChild(heading);

    const ul = document.createElement('ul');
    ul.className = 'list';
    for (const note of [...notes].sort((a, b) => a.createdAt - b.createdAt)) {
      ul.appendChild(buildNoteItem(note, page.meta.url, page.meta.url === activeUrl));
    }
    section.appendChild(ul);
    els.allList.appendChild(section);
  }
}

/**
 * The panel's empty state — no notes anywhere yet. Same shape as the gate
 * used across this portfolio's other extensions: mark, one line of weight,
 * a plain sentence, nothing more.
 */
function showEmptyState(): void {
  els.state.hidden = false;
  els.state.replaceChildren();

  const icon = document.createElement('img');
  icon.className = 'gate__icon';
  icon.src = chrome.runtime.getURL('icons/icon-128.png');
  icon.alt = '';

  const heading = document.createElement('strong');
  heading.className = 'gate__title';
  heading.textContent = 'No sticky notes yet';

  const body = document.createElement('p');
  body.className = 'gate__body';
  body.textContent = 'Click the toolbar icon, or press the keyboard shortcut, on any page to drop your first note.';

  els.state.append(icon, heading, body);
}

/* ── Exporting ───────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Revoke late: Chrome reads the blob asynchronously after download() resolves.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportMarkdown(): Promise<void> {
  const all = await readAllPages();
  try {
    await download(new Blob([toMarkdown(all)], { type: 'text/markdown;charset=utf-8' }), buildMarkdownFilename());
    setStatus('Saved .md');
    void track('export_markdown');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the Markdown file.');
  }
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some pages.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  try {
    await download(blob, buildBackupFilename());
    setStatus(`Exported ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.notes} note${result.notes === 1 ? '' : 's'} across ${result.pages} page${result.pages === 1 ? '' : 's'}`);
    void track('data_imported');
    await refresh();
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

els.thisAdd.addEventListener('click', () => {
  if (activeTabId === null) return;
  void ask(activeTabId, { type: 'SN_CREATE_NOTE' }).then(() => void refresh());
});

els.thisHidden.addEventListener('change', () => {
  if (!activeUrl) return;
  void mutateExistingPage(activeUrl, record => {
    record.hidden = els.thisHidden.checked;
  }).then(() => {
    void track('hide_toggled');
    void refresh();
  });
});

els.search.addEventListener('input', () => {
  query = els.search.value;
  renderAllNotes();
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(() => void track('panel_search_used'), 600);
});

els.exportMd.addEventListener('click', () => void exportMarkdown());

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
  if (!confirm('Delete every sticky note on every page? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void track('data_cleared');
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

// The content script tells us when a page's notes change.
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'SN_STATE_CHANGED') void refresh();
});

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === activeTabId && changeInfo.status === 'complete') void refresh();
});

// Notes edited directly from this panel (delete, hide toggle, import, clear)
// change storage without a content script in the loop — catch those too.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (!Object.keys(changes).some(key => key.startsWith(PAGE_PREFIX))) return;
  void refresh();
});

void (async () => {
  void track('panel_opened');
  await refresh();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from "Data".');
})();
