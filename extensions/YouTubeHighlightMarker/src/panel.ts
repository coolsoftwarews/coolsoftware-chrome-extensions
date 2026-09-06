/**
 * Side panel: the shot list for whichever video is on the active tab.
 *
 * The panel never holds pending-mark state itself — that lives in
 * content.ts, per tab, so marking still works with the panel closed. This
 * file only reflects it: on load it pings the tab, and it listens for the
 * broadcasts content.ts sends whenever something changes.
 */
import { buildFilename, toCsv, toMarkdown } from './export';
import { clipDuration, sortClips } from './marks';
import { clearMetrics, readMetrics, track } from './metrics';
import {
  addClip,
  clearAllData,
  deleteClip,
  exportAllData,
  importAllData,
  readClips,
  updateClipNote,
} from './storage';
import { formatTimestamp } from './time';
import { ClipCandidate, MarkKind, VideoMeta } from './types';
import { extractVideoId, isYouTubeUrl } from './url';

const VERSION = '1.0.0';
const CLIPWIZARD_URL = 'https://coolsoftware.io/apps/clipwizard/?ref=highlight-marker';
const CLIPWIZARD_SHOWN_KEY = 'yhm:clipwizardShown';

const el = {
  videoTitle: document.getElementById('video-title') as HTMLElement,
  videoMeta: document.getElementById('video-meta') as HTMLElement,
  gate: document.getElementById('gate') as HTMLElement,
  gateOpen: document.getElementById('gate-open') as HTMLButtonElement,
  main: document.getElementById('main') as HTMLElement,
  pendingStatus: document.getElementById('pending-status') as HTMLElement,
  pendingText: document.getElementById('pending-text') as HTMLElement,
  pendingCancel: document.getElementById('pending-cancel') as HTMLButtonElement,
  markIn: document.getElementById('mark-in') as HTMLButtonElement,
  markOut: document.getElementById('mark-out') as HTMLButtonElement,
  clipCount: document.getElementById('clip-count') as HTMLElement,
  empty: document.getElementById('empty') as HTMLElement,
  clipList: document.getElementById('clip-list') as HTMLOListElement,
  exportRow: document.getElementById('export-row') as HTMLElement,
  exportMd: document.getElementById('export-md') as HTMLButtonElement,
  exportCsv: document.getElementById('export-csv') as HTMLButtonElement,
  clipwizardNote: document.getElementById('clipwizard-note') as HTMLElement,
  clipwizardLink: document.getElementById('clipwizard-link') as HTMLAnchorElement,
  dataOpen: document.getElementById('data-open') as HTMLButtonElement,
  dataSheet: document.getElementById('data-sheet') as HTMLDialogElement,
  dataExport: document.getElementById('data-export') as HTMLButtonElement,
  dataImport: document.getElementById('data-import') as HTMLButtonElement,
  dataImportFile: document.getElementById('data-import-file') as HTMLInputElement,
  dataClear: document.getElementById('data-clear') as HTMLButtonElement,
  dataStatus: document.getElementById('data-status') as HTMLElement,
  dataClose: document.getElementById('data-close') as HTMLButtonElement,
  statsBody: document.getElementById('stats-body') as HTMLElement,
  statsReset: document.getElementById('stats-reset') as HTMLButtonElement,
  version: document.getElementById('version') as HTMLElement,
};

let currentTabId: number | null = null;
let currentVideoId: string | null = null;
let currentMeta: VideoMeta | null = null;
let clips: ClipCandidate[] = [];
let pending: { kind: MarkKind; seconds: number } | null = null;

el.clipwizardLink.href = CLIPWIZARD_URL;
el.version.textContent = `v${VERSION}`;

/* ── Tab plumbing ────────────────────────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function pingContent(
  tabId: number,
): Promise<{ ok: boolean; videoId?: string | null; title?: string; channel?: string; pending?: typeof pending } | null> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: 'YHM_PING' });
  } catch {
    return null;
  }
}

async function sendToContent(message: unknown): Promise<any> {
  if (currentTabId === null) return null;
  try {
    return await chrome.tabs.sendMessage(currentTabId, message);
  } catch {
    return null;
  }
}

/* ── Load / render ───────────────────────────────────────────────────── */

async function load(): Promise<void> {
  const tab = await activeTab();
  const url = tab?.url ?? '';

  if (!tab?.id || !isYouTubeUrl(url)) {
    currentTabId = null;
    currentVideoId = null;
    currentMeta = null;
    showGate();
    return;
  }

  currentTabId = tab.id;
  const videoId = extractVideoId(url);
  const ping = await pingContent(tab.id);
  const resolvedVideoId = ping?.videoId ?? videoId;

  if (!resolvedVideoId) {
    showGate();
    return;
  }

  currentVideoId = resolvedVideoId;
  currentMeta = {
    videoId: resolvedVideoId,
    title: ping?.title || 'This video',
    channel: ping?.channel || '',
    url: `https://www.youtube.com/watch?v=${resolvedVideoId}`,
  };
  pending = ping?.pending ?? null;

  el.gate.hidden = true;
  el.main.hidden = false;
  el.videoTitle.textContent = currentMeta.title;
  el.videoMeta.textContent = currentMeta.channel;

  clips = await readClips(resolvedVideoId);
  renderPending();
  renderClips();
  void track('panel_opened');
}

function showGate(): void {
  el.gate.hidden = false;
  el.main.hidden = true;
}

function renderPending(): void {
  el.markIn.setAttribute('aria-pressed', String(pending?.kind === 'in'));
  el.markOut.setAttribute('aria-pressed', String(pending?.kind === 'out'));

  if (!pending) {
    el.pendingStatus.hidden = true;
    return;
  }
  el.pendingStatus.hidden = false;
  const label = pending.kind === 'in' ? 'In' : 'Out';
  const other = pending.kind === 'in' ? 'Mark out' : 'Mark in';
  el.pendingText.textContent = `${label} point set at ${formatTimestamp(pending.seconds)} — press "${other}" to finish, or Cancel.`;
}

function thumbnailNode(clip: ClipCandidate): HTMLElement {
  const src = clip.inThumbnail || clip.outThumbnail;
  if (src) {
    const img = document.createElement('img');
    img.className = 'clip__thumb';
    img.src = src;
    img.alt = '';
    return img;
  }
  const empty = document.createElement('div');
  empty.className = 'clip__thumb clip__thumb--empty';
  empty.textContent = 'no thumbnail';
  return empty;
}

function renderClips(): void {
  const sorted = sortClips(clips);
  el.clipCount.textContent = sorted.length ? `${sorted.length} mark${sorted.length === 1 ? '' : 's'}` : '';
  el.empty.hidden = sorted.length !== 0;
  el.clipList.hidden = sorted.length === 0;
  el.exportRow.hidden = sorted.length === 0;
  el.clipList.innerHTML = '';

  for (const clip of sorted) {
    el.clipList.appendChild(renderClipItem(clip));
  }
}

function renderClipItem(clip: ClipCandidate): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'clip';

  li.appendChild(thumbnailNode(clip));

  const body = document.createElement('div');
  body.className = 'clip__body';

  const timeBtn = document.createElement('button');
  timeBtn.type = 'button';
  timeBtn.className = 'clip__time';
  const hours = clip.outSeconds >= 3600;
  timeBtn.textContent = `${formatTimestamp(clip.inSeconds, hours)} – ${formatTimestamp(clip.outSeconds, hours)} (${formatTimestamp(clipDuration(clip))})`;
  timeBtn.title = 'Jump to this moment';
  timeBtn.addEventListener('click', () => void seekToClip(clip));
  body.appendChild(timeBtn);

  if (clip.isShort || clip.swapped) {
    const badges = document.createElement('div');
    badges.className = 'clip__badges';
    if (clip.isShort) badges.appendChild(badge('short clip'));
    if (clip.swapped) badges.appendChild(badge('order corrected'));
    body.appendChild(badges);
  }

  const note = document.createElement('textarea');
  note.className = 'clip__note';
  note.rows = 2;
  note.placeholder = 'What happens here, and why it matters…';
  note.value = clip.note;
  note.setAttribute('aria-label', 'Note for this highlight');
  let noteTimer: number | undefined;
  note.addEventListener('input', () => {
    window.clearTimeout(noteTimer);
    noteTimer = window.setTimeout(() => void saveNote(clip.id, note.value), 400);
  });
  body.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'clip__actions';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'icon-btn';
  del.textContent = 'Delete';
  del.setAttribute('aria-label', `Delete highlight at ${formatTimestamp(clip.inSeconds, hours)}`);
  del.addEventListener('click', () => void removeClipRow(clip.id));
  actions.appendChild(del);
  body.appendChild(actions);

  li.appendChild(body);
  return li;
}

function badge(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'badge';
  span.textContent = text;
  return span;
}

async function seekToClip(clip: ClipCandidate): Promise<void> {
  await sendToContent({ type: 'YHM_SEEK', seconds: clip.inSeconds });
}

async function saveNote(id: string, note: string): Promise<void> {
  if (!currentVideoId) return;
  clips = await updateClipNote(currentVideoId, id, note);
  void track('note_added');
}

async function removeClipRow(id: string): Promise<void> {
  if (!currentVideoId) return;
  clips = await deleteClip(currentVideoId, id);
  void track('clip_deleted');
  renderClips();
}

/* ── Mark controls (mirrors the on-page bar) ────────────────────────── */

el.markIn.addEventListener('click', () => void sendToContent({ type: 'YHM_MARK_IN' }).then(refreshAfterMark));
el.markOut.addEventListener('click', () => void sendToContent({ type: 'YHM_MARK_OUT' }).then(refreshAfterMark));
el.pendingCancel.addEventListener('click', () => void sendToContent({ type: 'YHM_CANCEL_PENDING' }).then(load));

async function refreshAfterMark(): Promise<void> {
  // The mark itself already landed in storage from content.ts; re-read
  // both the clip list and the fresh pending state rather than guessing.
  if (currentTabId !== null) {
    const ping = await pingContent(currentTabId);
    pending = ping?.pending ?? null;
  }
  if (currentVideoId) clips = await readClips(currentVideoId);
  renderPending();
  renderClips();
}

el.gateOpen.addEventListener('click', () => void chrome.tabs.create({ url: 'https://www.youtube.com/' }));

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function maybeShowClipWizardNote(): Promise<void> {
  const stored = await chrome.storage.local.get(CLIPWIZARD_SHOWN_KEY);
  if (!stored?.[CLIPWIZARD_SHOWN_KEY]) {
    await chrome.storage.local.set({ [CLIPWIZARD_SHOWN_KEY]: true });
  }
  el.clipwizardNote.hidden = false;
}

el.exportMd.addEventListener('click', () => {
  void (async () => {
    if (!currentMeta) return;
    const content = toMarkdown(currentMeta, clips);
    await download(new Blob([content], { type: 'text/markdown;charset=utf-8' }), buildFilename(currentMeta, 'md'));
    void track('export_md');
    void maybeShowClipWizardNote();
  })();
});

el.exportCsv.addEventListener('click', () => {
  void (async () => {
    if (!currentMeta) return;
    const content = toCsv(currentMeta, clips);
    await download(new Blob([content], { type: 'text/csv;charset=utf-8' }), buildFilename(currentMeta, 'csv'));
    void track('export_csv');
    void maybeShowClipWizardNote();
  })();
});

el.clipwizardLink.addEventListener('click', () => void track('clipwizard_clicked'));

/* ── Data sheet: export all / import / clear all ────────────────────── */

function setDataStatus(text: string): void {
  el.dataStatus.textContent = text;
}

async function renderStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = Object.entries(metrics.counts)
    .sort((a, b) => b[1] - a[1])
    .map(([event, count]) => `${event}: ${count}`);
  el.statsBody.textContent = lines.length ? lines.join('\n') : '(nothing recorded yet)';
}

el.dataOpen.addEventListener('click', () => {
  setDataStatus('');
  void renderStats();
  el.dataSheet.showModal();
});
el.dataClose.addEventListener('click', () => el.dataSheet.close());

el.dataExport.addEventListener('click', () => {
  void (async () => {
    const backup = await exportAllData();
    const filename = `youtube-highlight-marker-backup-${new Date().toISOString().slice(0, 10)}.json`;
    await download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }), filename);
    void track('export_all');
    setDataStatus('Backup saved to your downloads.');
  })();
});

el.dataImport.addEventListener('click', () => el.dataImportFile.click());
el.dataImportFile.addEventListener('change', () => {
  void (async () => {
    const file = el.dataImportFile.files?.[0];
    el.dataImportFile.value = '';
    if (!file) return;
    try {
      const raw = JSON.parse(await file.text());
      const result = await importAllData(raw);
      void track('import_all');
      setDataStatus(`Imported ${result.clipsImported} mark(s) across ${result.videosImported} video(s).`);
      if (currentVideoId) clips = await readClips(currentVideoId);
      renderClips();
    } catch (err: any) {
      setDataStatus(`Import failed: ${err?.message || 'not a recognized backup file.'}`);
    }
  })();
});

el.dataClear.addEventListener('click', () => {
  void (async () => {
    if (!confirm('Delete every mark for every video? This cannot be undone.')) return;
    await clearAllData();
    void track('clear_all');
    clips = [];
    renderClips();
    setDataStatus('All marks cleared.');
  })();
});

el.statsReset.addEventListener('click', () => void clearMetrics().then(renderStats));

/* ── Live updates ────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.tab?.id !== undefined && currentTabId !== null && sender.tab.id !== currentTabId) return;

  if (message?.type === 'YHM_NAVIGATED') {
    void load();
    return;
  }
  if (message?.type === 'YHM_PENDING_CHANGED') {
    pending = message.pending ?? null;
    renderPending();
    return;
  }
  if (message?.type === 'YHM_CLIP_ADDED' && currentVideoId) {
    void readClips(currentVideoId).then(next => {
      clips = next;
      renderClips();
    });
    return;
  }
  if (message?.type === 'YHM_PENDING_DISCARDED') {
    pending = null;
    renderPending();
    setDataStatus('');
  }
});

chrome.tabs.onActivated.addListener(() => void load());
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (tabId === currentTabId && info.url) void load();
});

void load();
