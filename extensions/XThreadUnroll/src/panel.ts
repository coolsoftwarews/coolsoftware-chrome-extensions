/**
 * Side panel — the reading view. Renders whatever the bound tab's content
 * script has collected so far (loading/streaming state), the finished
 * thread (success state), an explicit empty state before any Unroll click,
 * and a plain-language error state — the four states every AI-adjacent
 * feature in this portfolio's frontend standards call for, applied here to
 * an incremental DOM-read instead of a model response.
 *
 * No thread content is ever written to chrome.storage — see storage.ts.
 * The only persisted preference is the export format.
 */

import { buildFilename, toMarkdown, toPlainText } from './formatters';
import { clearMetrics, Metrics, readMetrics, track } from './metrics';
import { completenessNote, postsShownLabel, readingTimeLabel } from './reading';
import { readOptions, writeOptions } from './storage';
import { ContentToPanel, ExportFormat, PanelToContent, ThreadSession, UnrolledPost } from './types';

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const summaryEl = $<HTMLParagraphElement>('summary');
const stopBtn = $<HTMLButtonElement>('stop');
const stateEl = $<HTMLDivElement>('state');
const noteEl = $<HTMLDivElement>('note');
const listEl = $<HTMLOListElement>('list');
const formatSelect = $<HTMLSelectElement>('format');
const copyBtn = $<HTMLButtonElement>('copy');
const downloadBtn = $<HTMLButtonElement>('download');
const statusEl = $<HTMLSpanElement>('status');
const usageToggle = $<HTMLButtonElement>('usage-toggle');
const usageDialog = $<HTMLDialogElement>('usage');
const usageBody = $<HTMLPreElement>('usage-body');
const usageClear = $<HTMLButtonElement>('usage-clear');
const usageClose = $<HTMLButtonElement>('usage-close');

let boundTabId: number | null = null;
let session: ThreadSession | null = null;
let statusTimer: number | undefined;

function setStatus(message: string): void {
  statusEl.textContent = message;
  window.clearTimeout(statusTimer);
  if (message) statusTimer = window.setTimeout(() => (statusEl.textContent = ''), 3000);
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function dateLabel(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function renderPost(post: UnrolledPost): HTMLLIElement {
  const li = document.createElement('li');

  if (post.deleted) {
    li.className = 'post post--deleted';
    li.textContent = '— a post in this thread is no longer available —';
    return li;
  }

  li.className = 'post';

  const avatar = document.createElement('img');
  avatar.className = 'post__avatar';
  avatar.alt = '';
  avatar.loading = 'lazy';
  if (post.avatarUrl) avatar.src = post.avatarUrl;

  const body = document.createElement('div');
  body.className = 'post__body';

  const head = document.createElement('div');
  head.className = 'post__head';
  const author = document.createElement('span');
  author.className = 'post__author';
  author.textContent = post.author || 'Unknown';
  const handle = document.createElement('span');
  handle.className = 'post__handle';
  handle.textContent = post.handle ? `@${post.handle}` : '';
  head.append(author, handle);
  if (post.postDate) {
    const date = document.createElement('span');
    date.className = 'post__date';
    date.textContent = `· ${dateLabel(post.postDate)}`;
    head.appendChild(date);
  }

  const textEl = document.createElement('p');
  textEl.className = 'post__text';
  textEl.textContent = post.text || '(no text — media only)';

  body.append(head, textEl);

  if (post.media.count > 0) {
    const media = document.createElement('p');
    media.className = 'post__media';
    media.textContent = `[${post.media.label}]`;
    body.appendChild(media);
  }

  if (post.quoted) {
    const quoted = document.createElement('div');
    quoted.className = 'post__quoted';
    const who = document.createElement('div');
    who.textContent = `Quoting ${post.quoted.author || 'Unknown'} (@${post.quoted.handle || 'unknown'})`;
    const qtext = document.createElement('div');
    qtext.textContent = post.quoted.text;
    quoted.append(who, qtext);
    body.appendChild(quoted);
  }

  if (post.url) {
    const link = document.createElement('a');
    link.className = 'post__link';
    link.href = post.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open on X';
    body.appendChild(link);
  }

  li.append(avatar, body);
  return li;
}

function render(): void {
  if (!session) {
    stateEl.hidden = false;
    stateEl.className = 'state state--gate';
    stateEl.replaceChildren();
    const title = document.createElement('p');
    title.className = 'gate__title';
    title.textContent = 'No thread open yet';
    const body = document.createElement('p');
    body.className = 'gate__body';
    body.textContent = 'Go to a thread on X and click Unroll on its first post to read it here.';
    stateEl.append(title, body);

    listEl.hidden = true;
    listEl.replaceChildren();
    noteEl.hidden = true;
    stopBtn.hidden = true;
    summaryEl.textContent = '';
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    return;
  }

  if (session.status === 'error') {
    stateEl.hidden = false;
    stateEl.className = 'state state--error';
    stateEl.textContent = session.errorMessage || 'Could not read this thread. Try clicking Unroll again once it has loaded.';
    listEl.hidden = true;
    listEl.replaceChildren();
    noteEl.hidden = true;
    stopBtn.hidden = true;
    summaryEl.textContent = '';
    copyBtn.disabled = true;
    downloadBtn.disabled = true;
    return;
  }

  stateEl.hidden = true;
  const collecting = session.status === 'collecting';
  stopBtn.hidden = !collecting;
  listEl.hidden = false;
  listEl.setAttribute('aria-busy', String(collecting));
  listEl.replaceChildren(...session.posts.map(renderPost));

  const shown = postsShownLabel(session.posts);
  const reading = readingTimeLabel(session.posts);
  summaryEl.textContent = collecting
    ? `Reading… ${shown}`
    : `${shown}${reading ? ` · ${reading}` : ''}`;

  const note = completenessNote(session);
  if (note) {
    noteEl.hidden = false;
    noteEl.textContent = note;
  } else {
    noteEl.hidden = true;
  }

  const hasContent = session.posts.some(p => !p.deleted);
  copyBtn.disabled = collecting || !hasContent;
  downloadBtn.disabled = collecting || !hasContent;
}

/* ── Messaging ───────────────────────────────────────────────────────── */

async function bindToActiveTab(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    boundTabId = tab?.id ?? null;
  } catch {
    boundTabId = null;
  }
  if (boundTabId !== null) requestState();
}

function requestState(): void {
  if (boundTabId === null) return;
  const message: PanelToContent = { type: 'XTU_REQUEST_STATE' };
  chrome.tabs.sendMessage(boundTabId, message, (response: ThreadSession | null | undefined) => {
    if (chrome.runtime.lastError) return; // no content script yet on this tab — fine, empty state stands
    if (response) {
      session = response;
      render();
    }
  });
}

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as ContentToPanel | undefined;
  if (msg?.type !== 'XTU_THREAD_UPDATE') return;
  if (boundTabId === null || sender.tab?.id !== boundTabId) return; // ignore other X tabs
  session = msg.session;
  render();
});

chrome.tabs.onActivated.addListener(() => void bindToActiveTab());
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === boundTabId && changeInfo.status === 'loading') {
    session = null;
    render();
  }
});

stopBtn.addEventListener('click', () => {
  if (boundTabId === null) return;
  const message: PanelToContent = { type: 'XTU_STOP' };
  void chrome.tabs.sendMessage(boundTabId, message).catch(() => undefined);
});

/* ── Export ──────────────────────────────────────────────────────────── */

function exportText(format: ExportFormat): string {
  if (!session) return '';
  return format === 'md' ? toMarkdown(session) : toPlainText(session);
}

copyBtn.addEventListener('click', () => {
  if (!session) return;
  const format = formatSelect.value as ExportFormat;
  void navigator.clipboard
    .writeText(exportText(format))
    .then(() => {
      setStatus('Copied to clipboard.');
      void track('copy_used');
    })
    .catch(() => setStatus('Could not copy — try selecting the text manually.'));
});

downloadBtn.addEventListener('click', () => {
  if (!session) return;
  const format = formatSelect.value as ExportFormat;
  const content = exportText(format);
  const mime = format === 'md' ? 'text/markdown' : 'text/plain';
  const filename = buildFilename(session, format);

  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  chrome.downloads.download({ url, filename, saveAs: false }, () => {
    URL.revokeObjectURL(url);
    if (chrome.runtime.lastError) {
      setStatus('Download failed — try again.');
      return;
    }
    setStatus(`Saved ${filename}`);
    void track(format === 'md' ? 'export_md' : 'export_txt');
  });
});

formatSelect.addEventListener('change', () => {
  void writeOptions({ exportFormat: formatSelect.value as ExportFormat });
});

/* ── Usage sheet ─────────────────────────────────────────────────────── */

function renderMetrics(metrics: Metrics): void {
  const lines = Object.entries(metrics.counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}: ${value}`);
  lines.push(`active days (last 30): ${metrics.activeDays.length}`);
  usageBody.textContent = lines.length ? lines.join('\n') : 'No usage yet.';
}

usageToggle.addEventListener('click', async () => {
  renderMetrics(await readMetrics());
  usageDialog.showModal();
});
usageClose.addEventListener('click', () => usageDialog.close());
usageClear.addEventListener('click', async () => {
  await clearMetrics();
  renderMetrics(await readMetrics());
});

/* ── Boot ────────────────────────────────────────────────────────────── */

async function boot(): Promise<void> {
  const options = await readOptions();
  formatSelect.value = options.exportFormat;

  render();
  await bindToActiveTab();
  void track('panel_opened');
}

void boot();
