/**
 * Side panel: the comment list, search, sort, word-frequency digest and
 * export controls. The panel owns no comment state of its own — the content
 * script is the single source of truth for "what's loaded on the page right
 * now" (PRD §6), and the panel simply asks for it whenever something changes.
 */

import { buildFilename, toCsv, toMarkdown } from './export';
import { clearMetrics, track } from './metrics';
import { filterComments } from './search';
import { sortComments } from './sort';
import { clearOptions, DEFAULT_OPTIONS, PanelOptions, readOptions, writeOptions } from './storage';
import { Comment, ExportFormat, PanelState, SortMode } from './types';
import { isWatchPage } from './url';
import { computeWordFrequency } from './wordfreq';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  title: $('video-title'),
  meta: $('video-meta'),
  refresh: $<HTMLButtonElement>('refresh'),
  controls: $('controls'),
  search: $<HTMLInputElement>('search'),
  sort: $<HTMLSelectElement>('sort'),
  loadMore: $<HTMLButtonElement>('load-more'),
  wordfreqToggle: $<HTMLButtonElement>('wordfreq-toggle'),
  wordfreq: $('wordfreq'),
  wordfreqWords: $<HTMLUListElement>('wordfreq-words'),
  wordfreqPhrases: $<HTMLUListElement>('wordfreq-phrases'),
  copyMd: $<HTMLButtonElement>('copy-md'),
  dlMd: $<HTMLButtonElement>('dl-md'),
  dlCsv: $<HTMLButtonElement>('dl-csv'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
  status: $('status'),
  settings: $<HTMLDialogElement>('settings'),
  settingsToggle: $<HTMLButtonElement>('settings-toggle'),
  settingsClear: $<HTMLButtonElement>('settings-clear'),
  settingsClose: $<HTMLButtonElement>('settings-close'),
};

let panelState: PanelState | null = null;
let tabId: number | null = null;
let options: PanelOptions = { ...DEFAULT_OPTIONS };
let busy = false;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(message: string): void {
  els.state.hidden = false;
  els.state.className = 'state';
  els.state.replaceChildren();
  const text = document.createElement('p');
  text.className = 'state__text';
  text.textContent = message;
  els.state.append(text);
  els.list.hidden = true;
}

/** The gate shown when the panel is open somewhere it cannot work — same shape across the portfolio. */
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

/* ── Talking to the page ─────────────────────────────────────────────── */

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

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;

  if (!tab || !isWatchPage(tab.url)) {
    panelState = null;
    els.controls.hidden = true;
    els.title.textContent = 'YouTube Comment Digest';
    els.meta.textContent = '';
    showGate(
      'Open a YouTube video',
      'This panel reads the comments already loaded on a YouTube watch page. Open any video to get started.',
    );
    return;
  }

  const next = await ask<PanelState>({ type: 'YCD_GET_STATE' });
  if (!next) {
    panelState = null;
    els.controls.hidden = true;
    showGate(
      'Reload this page first',
      'This tab was open before the extension was installed or updated, so it has no reader in it yet. One reload and it is ready.',
      'Reload the page',
      () => {
        if (tabId !== null) void chrome.tabs.reload(tabId);
      },
    );
    return;
  }

  panelState = next;
  els.title.textContent = next.meta.title || tab.title || 'Untitled video';
  els.meta.textContent = [next.meta.channel, next.declaredTotalText].filter(Boolean).join(' · ');
  els.controls.hidden = false;
  render();
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function visibleComments(): Comment[] {
  if (!panelState) return [];
  const sorted = sortComments(panelState.comments, options.sortMode);
  return filterComments(sorted, els.search.value);
}

function render(): void {
  if (!panelState) return;

  if (panelState.commentsDisabled) {
    showState('Comments are turned off for this video.');
    setStatus('');
    renderWordFreq([]);
    return;
  }

  if (!panelState.comments.length) {
    els.list.hidden = true;
    els.state.hidden = false;
    els.state.className = 'state';
    els.state.replaceChildren();
    const text = document.createElement('p');
    text.className = 'state__text';
    text.textContent = 'No comments loaded yet. Scroll down to the comments on the page, or try loading them here.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary';
    button.textContent = 'Load comments';
    button.addEventListener('click', () => void loadMore());
    els.state.append(text, button);
    setStatus('');
    renderWordFreq([]);
    return;
  }

  const visible = visibleComments();
  const query = els.search.value.trim();

  if (!visible.length) {
    showState(`No comments match "${query}".`);
    setStatus(`0 of ${panelState.comments.length} comments`);
    renderWordFreq(panelState.comments);
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;
  els.list.replaceChildren();

  for (const comment of visible) {
    els.list.appendChild(renderComment(comment));
  }

  setStatus(
    query
      ? `${visible.length} of ${panelState.comments.length} comments match "${query}"`
      : `${panelState.comments.length} comment${panelState.comments.length === 1 ? '' : 's'} loaded`,
  );
  renderWordFreq(panelState.comments);
}

function renderComment(comment: Comment): HTMLLIElement {
  const item = document.createElement('li');
  item.className = `item${comment.pinned ? ' item--pinned' : ''}${comment.hearted ? ' item--hearted' : ''}`;

  const head = document.createElement('div');
  head.className = 'item__head';

  const author = document.createElement('span');
  author.className = 'item__author';
  author.textContent = comment.author || 'Unknown';
  head.appendChild(author);

  if (comment.pinned) {
    const badge = document.createElement('span');
    badge.className = 'item__badge item__badge--pinned';
    badge.textContent = '📌 Pinned';
    head.appendChild(badge);
  }
  if (comment.hearted) {
    const badge = document.createElement('span');
    badge.className = 'item__badge item__badge--hearted';
    badge.textContent = '❤️ Creator heart';
    head.appendChild(badge);
  }

  item.appendChild(head);

  const text = document.createElement('p');
  text.className = 'item__text';
  text.textContent = comment.text || '(empty comment)';
  text.tabIndex = 0;
  text.setAttribute('role', 'button');
  text.setAttribute('aria-expanded', 'false');
  text.title = 'Click, or press Enter, to expand';
  const toggleExpand = () => {
    const expanded = text.classList.toggle('item__text--full');
    text.setAttribute('aria-expanded', String(expanded));
  };
  text.addEventListener('click', toggleExpand);
  text.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      toggleExpand();
    }
  });
  item.appendChild(text);

  const stats = document.createElement('p');
  stats.className = 'item__stats';
  const parts: string[] = [];
  parts.push(comment.likeCount === null ? 'likes: n/a' : `${comment.likeCount} likes`);
  parts.push(comment.replyCount === null ? 'replies: n/a' : `${comment.replyCount} repl${comment.replyCount === 1 ? 'y' : 'ies'}`);
  if (comment.publishedText) parts.push(comment.publishedText);
  stats.textContent = parts.join(' · ');
  item.appendChild(stats);

  return item;
}

function renderWordFreq(comments: Comment[]): void {
  if (els.wordfreq.hidden) return;

  const result = computeWordFrequency(comments);
  const fillList = (list: HTMLUListElement, entries: typeof result.words) => {
    list.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.className = 'muted small';
      empty.textContent = 'Not enough loaded comments yet.';
      list.appendChild(empty);
      return;
    }
    for (const entry of entries) {
      const chip = document.createElement('li');
      chip.className = 'chip';
      const term = document.createElement('span');
      term.textContent = entry.term;
      const count = document.createElement('span');
      count.className = 'chip__count';
      count.textContent = String(entry.count);
      chip.append(term, count);
      list.appendChild(chip);
    }
  };

  fillList(els.wordfreqWords, result.words);
  fillList(els.wordfreqPhrases, result.phrases);
}

/* ── Actions ─────────────────────────────────────────────────────────── */

function setBusy(next: boolean): void {
  busy = next;
  els.loadMore.disabled = busy;
  els.refresh.disabled = busy;
}

async function loadMore(): Promise<void> {
  if (busy || tabId === null) return;
  setBusy(true);
  setStatus('Loading more comments…');
  void track('load_more_used');
  const next = await ask<PanelState>({ type: 'YCD_LOAD_MORE' });
  setBusy(false);
  if (next) {
    panelState = next;
    render();
  } else {
    setStatus('Could not load more comments — try scrolling the page itself.');
  }
}

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function currentExportInput() {
  if (!panelState) return null;
  return { meta: panelState.meta, comments: visibleComments(), query: els.search.value.trim() || undefined };
}

async function copyMarkdown(): Promise<void> {
  const input = currentExportInput();
  if (!input) return;
  try {
    await navigator.clipboard.writeText(toMarkdown(input));
    setStatus('Copied as Markdown');
  } catch {
    setStatus('Clipboard access was blocked.');
  }
}

async function exportAs(format: ExportFormat): Promise<void> {
  const input = currentExportInput();
  if (!input) return;

  const content = format === 'md' ? toMarkdown(input) : toCsv(input);
  const type = format === 'md' ? 'text/markdown' : 'text/csv';

  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename(input.meta, format));
    setStatus(`Saved .${format}`);
    void track(format === 'md' ? 'export_md' : 'export_csv');
    options = { ...options, lastExportFormat: format };
    void writeOptions(options);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : null;
    setStatus(message || `Could not save the .${format} file.`);
  }
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void refresh());

let searchDebounce: number | undefined;
els.search.addEventListener('input', () => {
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(() => {
    render();
    if (els.search.value.trim()) void track('search_used');
  }, 120);
});

els.sort.addEventListener('change', () => {
  const mode = els.sort.value as SortMode;
  options = { ...options, sortMode: mode };
  void writeOptions(options);
  void track('sort_changed');
  render();
});

els.loadMore.addEventListener('click', () => void loadMore());

els.wordfreqToggle.addEventListener('click', () => {
  const open = els.wordfreq.hidden;
  els.wordfreq.hidden = !open;
  els.wordfreqToggle.setAttribute('aria-expanded', String(open));
  options = { ...options, wordFreqOpen: open };
  void writeOptions(options);
  if (open) {
    void track('wordfreq_opened');
    renderWordFreq(panelState?.comments ?? []);
  }
});

els.copyMd.addEventListener('click', () => void copyMarkdown());
els.dlMd.addEventListener('click', () => void exportAs('md'));
els.dlCsv.addEventListener('click', () => void exportAs('csv'));

els.settingsToggle.addEventListener('click', () => els.settings.showModal());
els.settingsClose.addEventListener('click', () => els.settings.close());
els.settingsClear.addEventListener('click', () => {
  if (!confirm('Clear your sort/export preferences and local usage counters? Nothing else is stored.')) return;
  void Promise.all([clearOptions(), clearMetrics()]).then(() => {
    options = { ...DEFAULT_OPTIONS };
    els.settings.close();
    setStatus('Local preferences cleared.');
  });
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'YCD_STATE_CHANGED') void refresh();
});

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && changeInfo.status === 'complete') void refresh();
});

void (async () => {
  options = await readOptions();
  els.sort.value = options.sortMode;
  if (options.wordFreqOpen) {
    els.wordfreq.hidden = false;
    els.wordfreqToggle.setAttribute('aria-expanded', 'true');
  }
  void track('panel_opened');
  await refresh();
})();
