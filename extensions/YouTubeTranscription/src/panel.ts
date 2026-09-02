import {
  RenderedLine,
  buildFilename,
  renderLines,
  toMarkdown,
  toPdfDocument,
  toPlainText,
  toPrompt,
  momentUrl,
  notesToPdfDocument,
} from './formatters';
import { clearMetrics, readMetrics, track, trackFailure } from './metrics';
import { readNote, writeNote } from './notes';
import {
  HistoryAction,
  describeActions,
  forgetVideos,
  listHistory,
  recordTaken,
} from './history';
import {
  ASSISTANTS,
  Assistant,
  BUILT_IN,
  Prompt,
  PromptStore,
  deletePrompt,
  newPromptId,
  readPrompts,
  savePrompt,
  setDefaultPrompt,
} from './prompts';
import { CommandBar, Editor } from 'tiny-markdown-editor';
import { marked } from 'marked';
import { generatePdf } from './pdf';
import {
  clearExtractorCache,
  extractTranscript,
  extractVideoId,
  fetchTranscriptByLanguage,
  formatTimestamp,
  isYouTubeUrl,
} from './transcript-extractor';
import {
  DEFAULT_EXPORT_OPTIONS,
  ExportOptions,
  TranscriptError,
  TranscriptResult,
} from './types';

const OPTIONS_KEY = 'ytx_options';
/** Lines rendered per frame. Keeps a 3-hour podcast from blocking the panel. */
const RENDER_CHUNK = 250;

const el = {
  title: document.getElementById('video-title') as HTMLHeadingElement,
  meta: document.getElementById('video-meta') as HTMLParagraphElement,
  reload: document.getElementById('reload') as HTMLButtonElement,
  controls: document.getElementById('controls') as HTMLElement,
  search: document.getElementById('search') as HTMLInputElement,
  language: document.getElementById('language') as HTMLSelectElement,
  optTimestamps: document.getElementById('opt-timestamps') as HTMLInputElement,
  optHeader: document.getElementById('opt-header') as HTMLInputElement,
  optParagraphs: document.getElementById('opt-paragraphs') as HTMLInputElement,
  copy: document.getElementById('copy') as HTMLButtonElement,
  dlMd: document.getElementById('dl-md') as HTMLButtonElement,
  dlTxt: document.getElementById('dl-txt') as HTMLButtonElement,
  dlPdf: document.getElementById('dl-pdf') as HTMLButtonElement,
  searchStatus: document.getElementById('search-status') as HTMLParagraphElement,
  state: document.getElementById('state') as HTMLDivElement,
  transcriptBar: document.getElementById('transcript-bar') as HTMLElement,
  list: document.getElementById('transcript') as HTMLOListElement,
  status: document.getElementById('status') as HTMLSpanElement,
  statsToggle: document.getElementById('stats-toggle') as HTMLButtonElement,
  stats: document.getElementById('stats') as HTMLDialogElement,
  statsBody: document.getElementById('stats-body') as HTMLPreElement,
  statsClear: document.getElementById('stats-clear') as HTMLButtonElement,
  statsClose: document.getElementById('stats-close') as HTMLButtonElement,
  version: document.getElementById('version') as HTMLSpanElement,
  studio: document.getElementById('studio') as HTMLButtonElement,
  guide: document.getElementById('guide') as HTMLButtonElement,
  themes: document.getElementById('themes') as HTMLDivElement,
  rail: document.getElementById('rail') as HTMLElement,
  railTranscript: document.getElementById('rail-transcript') as HTMLButtonElement,
  railSettings: document.getElementById('rail-settings') as HTMLButtonElement,
  railMenu: document.getElementById('rail-menu') as HTMLButtonElement,
  menu: document.getElementById('menu') as HTMLDivElement,
  screenTranscript: document.getElementById('screen-transcript') as HTMLElement,
  screenSettings: document.getElementById('screen-settings') as HTMLElement,
  railNotes: document.getElementById('rail-notes') as HTMLButtonElement,
  screenNotes: document.getElementById('screen-notes') as HTMLElement,
  notesEditor: document.getElementById('notes-editor') as HTMLDivElement,
  notesBar: document.getElementById('notes-bar') as HTMLDivElement,
  notesMeta: document.getElementById('notes-meta') as HTMLParagraphElement,
  notesStatus: document.getElementById('notes-status') as HTMLSpanElement,
  notesCopy: document.getElementById('notes-copy') as HTMLButtonElement,
  notesDownload: document.getElementById('notes-download') as HTMLButtonElement,
  notesReset: document.getElementById('notes-reset') as HTMLButtonElement,
  copyPrompt: document.getElementById('copy-prompt') as HTMLButtonElement,
  optClean: document.getElementById('opt-clean') as HTMLInputElement,
  optLinks: document.getElementById('opt-links') as HTMLInputElement,
  optChapters: document.getElementById('opt-chapters') as HTMLInputElement,
  railLibrary: document.getElementById('rail-library') as HTMLButtonElement,
  screenLibrary: document.getElementById('screen-library') as HTMLElement,
  libraryList: document.getElementById('library-list') as HTMLUListElement,
  librarySearch: document.getElementById('library-search') as HTMLInputElement,
  libraryCount: document.getElementById('library-count') as HTMLParagraphElement,
  libraryEmpty: document.getElementById('library-empty') as HTMLDivElement,
  libraryControls: document.getElementById('library-controls') as HTMLElement,
  libraryAll: document.getElementById('library-all') as HTMLInputElement,
  libraryDelete: document.getElementById('library-delete') as HTMLButtonElement,
  notesPdf: document.getElementById('notes-pdf') as HTMLButtonElement,
  notesView: document.getElementById('notes-view') as HTMLButtonElement,
  notesPreview: document.getElementById('notes-preview') as HTMLElement,
  notesTitle: document.getElementById('notes-title') as HTMLHeadingElement,
  notesGate: document.getElementById('notes-gate') as HTMLElement,
  notesGateOpen: document.getElementById('notes-gate-open') as HTMLButtonElement,
  notesActions: document.getElementById('notes-actions') as HTMLElement,
  notesFoot: document.getElementById('notes-foot') as HTMLElement,
  notesViewLabel: document.getElementById('notes-view-label') as HTMLSpanElement,
  assistants: document.getElementById('assistants') as HTMLDivElement,
  promptPicker: document.getElementById('prompt-picker') as HTMLDialogElement,
  promptChoice: document.getElementById('prompt-choice') as HTMLSelectElement,
  promptPreview: document.getElementById('prompt-preview') as HTMLTextAreaElement,
  promptTargets: document.getElementById('prompt-targets') as HTMLDivElement,
  promptCopy: document.getElementById('prompt-copy') as HTMLButtonElement,
  promptClose: document.getElementById('prompt-close') as HTMLButtonElement,
  promptEditor: document.getElementById('prompt-editor') as HTMLDialogElement,
  promptEditorTitle: document.getElementById('prompt-editor-title') as HTMLHeadingElement,
  promptName: document.getElementById('prompt-name') as HTMLInputElement,
  promptBody: document.getElementById('prompt-body') as HTMLTextAreaElement,
  promptSave: document.getElementById('prompt-save') as HTMLButtonElement,
  promptCancel: document.getElementById('prompt-cancel') as HTMLButtonElement,
  promptList: document.getElementById('prompt-list') as HTMLUListElement,
  promptAdd: document.getElementById('prompt-add') as HTMLButtonElement,
};

const PRODUCT_URL = 'https://coolsoftware.io/extensions/youtube-transcript-export/';

/** UI preferences, kept apart from the export options the formatters read. */
const UI_KEY = 'ytx_ui';

/**
 * The presets, as [id, label, swatch].
 *
 * A preset is a palette and nothing more: the panel already draws every colour
 * from a token, so adding one is a CSS block plus a line here. The swatch is
 * only what the button paints.
 */
const THEMES: Array<[string, string, string]> = [
  ['system', 'System', '#cc0000'],
  ['ink', 'Ink', '#a99bff'],
  ['paper', 'Paper', '#b4622e'],
  ['forest', 'Forest', '#57d6a3'],
];

let theme = 'system';

/** The line the player is inside, so it is only repainted when it changes. */
let playingIndex = -1;

/** Following is on by default and switches itself off the moment you scroll. */
let follow = true;


let options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };
let current: TranscriptResult | null = null;
let currentTabId: number | null = null;
let currentVideoId: string | null = null;
let loading = false;
/** Bumped on every render so an in-flight chunked render abandons itself. */
let renderToken = 0;

/* ── Options persistence ─────────────────────────────────────────────── */

async function loadOptions(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(OPTIONS_KEY);
    options = { ...DEFAULT_EXPORT_OPTIONS, ...(stored?.[OPTIONS_KEY] ?? {}) };
  } catch {
    options = { ...DEFAULT_EXPORT_OPTIONS };
  }
  el.optTimestamps.checked = options.includeTimestamps;
  el.optHeader.checked = options.includeHeader;
  el.optParagraphs.checked = options.paragraphMode === 'paragraphs';
  el.optClean.checked = options.cleanCaptions;
  el.optLinks.checked = options.linkTimestamps;
  el.optChapters.checked = options.useChapters;
}

async function saveOptions(): Promise<void> {
  try {
    await chrome.storage.local.set({ [OPTIONS_KEY]: options });
  } catch {
    /* a lost preference is not worth an error state */
  }
}

/* ── UI state ────────────────────────────────────────────────────────── */

function showState(message: string, variant: 'info' | 'error' | 'loading', actionLabel?: string, action?: () => void) {
  // Anything that is not the gate is happening *to* a video, so the header that
  // names it and the rail that leaves it both come back.
  el.rail.hidden = false;
  el.transcriptBar.hidden = false;
  el.list.hidden = true;
  el.state.hidden = false;
  el.state.className = `state${variant === 'error' ? ' state--error' : ''}`;
  el.state.replaceChildren();

  if (variant === 'loading') {
    const spinner = document.createElement('div');
    spinner.className = 'spinner';
    el.state.appendChild(spinner);
  }

  const text = document.createElement('p');
  text.className = 'state__text';
  text.textContent = message;
  el.state.appendChild(text);

  if (actionLabel && action) {
    const button = document.createElement('button');
    button.className = 'btn';
    button.textContent = actionLabel;
    button.addEventListener('click', action);
    el.state.appendChild(button);
  }
}

/**
 * The panel's own empty state, for a panel opened where it cannot work.
 *
 * Not an error and not the user's mistake — there is simply nothing in front of
 * it yet. A sentence in grey says that as weakly as possible; the mark, a line
 * of real weight and the button that fixes it say it once and get out of the
 * way. Same shape in every extension in the set, so the answer to "why is this
 * empty?" always looks the same.
 */
function showGate(
  title: string,
  body: string,
  actionLabel?: string,
  action?: () => void,
): void {
  /*
   * Strip everything, not just the content.
   *
   * A search box with nothing to search, a language picker with no languages
   * and five export buttons with nothing to export are five promises the panel
   * cannot keep. The rail goes too: every screen behind it is about a video,
   * and offering a way to them here is offering more of the same emptiness.
   *
   * So the gate is the whole panel until there is a transcript — which is what
   * the sibling extension does, and it is the right shape.
   */
  showScreen('transcript');
  el.rail.hidden = true;
  el.transcriptBar.hidden = true;
  el.controls.hidden = true;
  el.list.hidden = true;
  el.state.hidden = false;
  el.state.className = 'state state--gate';
  el.state.replaceChildren();

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

  el.state.append(icon, heading, text);

  if (actionLabel && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary gate__action';
    button.textContent = actionLabel;
    button.addEventListener('click', action);
    el.state.append(button);
  }
}

function setStatus(message: string): void {
  el.status.textContent = message;
}

function setBusy(busy: boolean): void {
  loading = busy;
  for (const button of [el.copy, el.dlMd, el.dlTxt, el.dlPdf, el.reload, el.language]) {
    button.disabled = busy || !current;
  }
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function buildLineElement(line: RenderedLine, query: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'line';
  li.dataset.start = String(line.start);
  li.title = 'Jump the video to this point';

  if (options.includeTimestamps) {
    const time = document.createElement('span');
    time.className = 'line__time';
    time.textContent = line.timestamp;
    li.appendChild(time);
  }

  const text = document.createElement('span');
  text.className = 'line__text';
  appendHighlighted(text, line.text, query);
  li.appendChild(text);

  return li;
}



/** Highlights matches by building text nodes — never innerHTML, the text is untrusted. */
function appendHighlighted(target: HTMLElement, text: string, query: string): void {
  if (!query) {
    target.textContent = text;
    return;
  }

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  let index = 0;

  for (;;) {
    const hit = haystack.indexOf(needle, index);
    if (hit === -1) break;
    if (hit > index) target.appendChild(document.createTextNode(text.slice(index, hit)));
    const mark = document.createElement('mark');
    mark.textContent = text.slice(hit, hit + needle.length);
    target.appendChild(mark);
    index = hit + needle.length;
  }

  if (index < text.length) target.appendChild(document.createTextNode(text.slice(index)));
}

function renderTranscript(): void {
  if (!current) return;
  el.rail.hidden = false;
  el.transcriptBar.hidden = false;

  const query = el.search.value.trim();
  const all = renderLines(current, options);
  const visible = query
    ? all.filter(line => line.text.toLowerCase().includes(query.toLowerCase()))
    : all;

  el.searchStatus.hidden = !query;
  if (query) {
    el.searchStatus.textContent = visible.length
      ? `${visible.length} of ${all.length} lines match "${query}"`
      : `No lines match "${query}"`;
  }

  el.state.hidden = true;
  el.list.hidden = false;
  el.list.replaceChildren();

  const token = ++renderToken;
  let cursor = 0;

  const renderChunk = () => {
    if (token !== renderToken) return; // a newer render superseded this one
    const fragment = document.createDocumentFragment();
    const end = Math.min(cursor + RENDER_CHUNK, visible.length);
    for (; cursor < end; cursor++) fragment.appendChild(buildLineElement(visible[cursor], query));
    el.list.appendChild(fragment);
    if (cursor < visible.length) requestAnimationFrame(renderChunk);
  };

  renderChunk();
}

function renderHeader(): void {
  if (!current) return;
  el.title.textContent = current.meta.title;
  const duration = current.meta.durationSeconds
    ? formatTimestamp(current.meta.durationSeconds, true)
    : null;
  el.meta.textContent = [current.meta.channel, duration, current.languageName]
    .filter(Boolean)
    .join(' · ');
}

function renderLanguages(): void {
  if (!current) return;
  el.language.replaceChildren();
  for (const language of current.availableLanguages) {
    const option = document.createElement('option');
    option.value = language.key;
    option.textContent = language.name;
    option.selected = language.key === current.languageKey;
    el.language.appendChild(option);
  }
  el.language.hidden = current.availableLanguages.length < 2;
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

function describeError(error: unknown): { message: string; retryable: boolean } {
  if (error instanceof TranscriptError) {
    void trackFailure(error.reason);
    const retryable = error.reason === 'network' || error.reason === 'pot-failed' || error.reason === 'parse';
    return { message: error.message, retryable };
  }
  void trackFailure('unknown');
  return { message: (error as any)?.message || 'Something went wrong loading the transcript.', retryable: true };
}

async function load(force = false): Promise<void> {
  if (loading) return;

  const tab = await activeTab();
  if (!tab?.id || !tab.url || !isYouTubeUrl(tab.url)) {
    current = null;
    currentVideoId = null;
    el.controls.hidden = true;
    el.title.textContent = 'Transcript';
    el.meta.textContent = '';
    setBusy(false);
    showGate(
      'Open YouTube to get started',
      'This panel reads the transcript of the YouTube video in front of it. Open one and it fills in.',
      'Open YouTube',
      () => void chrome.tabs.create({ url: 'https://www.youtube.com/' }),
    );
    setStatus('');
    return;
  }

  const videoId = extractVideoId(tab.url);
  if (!videoId) {
    el.controls.hidden = true;
    showState('This YouTube page is not a video.', 'info');
    return;
  }
  if (!force && current && videoId === currentVideoId) return;

  currentTabId = tab.id;
  currentVideoId = videoId;
  current = null;
  // A new video starts on its own line, with following back on.
  playingIndex = -1;
  follow = true;
  el.controls.hidden = true;
  setBusy(true);
  showState('Reading captions…', 'loading');
  setStatus('');

  const startedAt = performance.now();

  try {
    clearExtractorCache();
    const result = await extractTranscript(tab.id, tab.url);
    // The user may have navigated away while we were fetching.
    if (currentVideoId !== videoId) return;

    current = result;
    el.controls.hidden = false;
    el.search.value = '';
    el.searchStatus.hidden = true;
    renderHeader();
    renderLanguages();
    renderTranscript();
    setBusy(false);
    setStatus(`${result.segments.length} caption lines · ${Math.round(performance.now() - startedAt)} ms`);
    // Re-arm the follow-along for whichever tab this is: the panel outlives a
    // tab switch now, so the page it was timing is not the page it is on.
    void setTracking(true);
    void track('transcript_loaded');
  } catch (error) {
    if (currentVideoId !== videoId) return;
    const { message, retryable } = describeError(error);
    setBusy(false);
    showState(message, 'error', retryable ? 'Try again' : undefined, retryable ? () => void load(true) : undefined);
    setStatus('');
  }
}

async function switchLanguage(key: string): Promise<void> {
  if (!current || loading) return;
  setBusy(true);
  setStatus('Switching language…');
  try {
    current = await fetchTranscriptByLanguage(key);
    renderHeader();
    renderTranscript();
    setStatus(`${current.segments.length} caption lines`);
    void track('language_switched');
  } catch (error) {
    const { message } = describeError(error);
    setStatus(message);
    renderLanguages(); // put the <select> back on the track we are actually showing
  } finally {
    setBusy(false);
  }
}

/* ── Exports ─────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Revoke late: Chrome reads the blob asynchronously after download() resolves.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportText(kind: 'md' | 'txt'): Promise<void> {
  if (!current) return;
  const content = kind === 'md' ? toMarkdown(current, options) : toPlainText(current, options);
  const type = kind === 'md' ? 'text/markdown' : 'text/plain';
  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename(current, kind));
    setStatus(`Saved .${kind}`);
    void remember(kind);
    void track(kind === 'md' ? 'export_md' : 'export_txt');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${kind} file.`);
  }
}

async function exportPdf(): Promise<void> {
  if (!current) return;
  setStatus('Building PDF…');
  try {
    const { blob, unsupportedCharacters } = generatePdf(toPdfDocument(current, options));
    await download(blob, buildFilename(current, 'pdf'));
    void remember('pdf');
    void track('export_pdf');
    setStatus(
      unsupportedCharacters.length
        ? 'Saved .pdf — some characters in this language cannot be drawn in a PDF; use .md or .txt for a faithful copy.'
        : 'Saved .pdf'
    );
  } catch (error: any) {
    setStatus(error?.message || 'Could not build the PDF.');
  }
}

async function copyToClipboard(): Promise<void> {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(toPlainText(current, options));
    setStatus('Copied to clipboard');
    void remember('copy');
    void track('copy_used');
  } catch {
    setStatus('Clipboard access was blocked.');
  }
}

/* ── Seeking ─────────────────────────────────────────────────────────── */

/**
 * Talk to the page, injecting the content script if it is not there yet.
 *
 * A tab that was already open when the extension was installed or updated has
 * no content script in it, and every message to it fails. Telling the reader to
 * reload the page is passing them our own chore: we hold `scripting`, so the
 * panel can put the script there and carry on. Only the first failure costs
 * anything.
 */
async function tell(tabId: number, message: unknown): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

async function seek(seconds: number, line: HTMLElement): Promise<void> {
  if (currentTabId === null) return;
  try {
    await tell(currentTabId, { type: 'YTX_SEEK', seconds });
    document.querySelectorAll('.line--active').forEach(node => node.classList.remove('line--active'));
    line.classList.add('line--active');
    // Jumping the video is a request to be with it again, so following resumes.
    follow = true;
    void track('seek_used');
  } catch {
    setStatus('Could not reach the video. Reload the YouTube tab.');
  }
}

/* ── Stats dialog ────────────────────────────────────────────────────── */

async function showStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines: string[] = [];

  const counts = Object.entries(metrics.counts).sort((a, b) => b[1] - a[1]);
  lines.push(counts.length ? counts.map(([k, v]) => `${k.padEnd(20)} ${v}`).join('\n') : 'No events yet.');

  const failures = Object.entries(metrics.failures).sort((a, b) => b[1] - a[1]);
  if (failures.length) {
    lines.push('');
    lines.push('Failures');
    lines.push(failures.map(([k, v]) => `${k.padEnd(20)} ${v}`).join('\n'));
  }

  lines.push('');
  lines.push(`Active days (last 30): ${metrics.activeDays.length}`);

  el.statsBody.textContent = lines.join('\n');
  el.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let timer: number | undefined;
  return ((...args: any[]) => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms) as unknown as number;
  }) as T;
}

let searchTracked = false;
const onSearch = debounce(() => {
  renderTranscript();
  if (!searchTracked && el.search.value.trim()) {
    searchTracked = true; // count the behaviour once per panel session, not per keystroke
    void track('search_used');
  }
}, 150);

el.search.addEventListener('input', onSearch);

el.language.addEventListener('change', () => void switchLanguage(el.language.value));

el.optTimestamps.addEventListener('change', () => {
  options.includeTimestamps = el.optTimestamps.checked;
  void saveOptions();
  renderTranscript();
  void track('timestamps_toggled');
});

// The three from Settings. Cleanup and chapters change what is on screen, so
// they redraw; links only ever affect what an export writes.
el.optClean.addEventListener('change', () => {
  options.cleanCaptions = el.optClean.checked;
  void saveOptions();
  renderTranscript();
});

el.optChapters.addEventListener('change', () => {
  options.useChapters = el.optChapters.checked;
  void saveOptions();
  renderTranscript();
});

el.optLinks.addEventListener('change', () => {
  options.linkTimestamps = el.optLinks.checked;
  void saveOptions();
});

el.copyPrompt.addEventListener('click', event => {
  event.stopPropagation();
  const open = el.assistants.hidden;
  el.assistants.hidden = !open;
  el.copyPrompt.setAttribute('aria-expanded', String(open));

  if (open) {
    // Anchored to the button rather than to the panel: the menu belongs to the
    // control that opened it, wherever the export row happens to sit.
    const rect = el.copyPrompt.getBoundingClientRect();
    el.assistants.style.top = `${rect.bottom + 6}px`;
    el.assistants.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - 190))}px`;
    el.assistants.style.right = 'auto';
    el.assistants.style.bottom = 'auto';
  }
});

document.addEventListener('click', () => closeAssistants());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAssistants();
});

el.promptChoice.addEventListener('change', () => {
  el.promptPreview.value = promptById(el.promptChoice.value)?.body ?? '';
});
el.promptCopy.addEventListener('click', () => {
  el.promptPicker.close();
  void sendTo(null, el.promptPreview.value);
});
el.promptClose.addEventListener('click', () => el.promptPicker.close());

el.promptAdd.addEventListener('click', () => openPromptEditor(null));
el.promptSave.addEventListener('click', () => void savePromptFromEditor());
el.promptCancel.addEventListener('click', () => el.promptEditor.close());


el.optHeader.addEventListener('change', () => {
  options.includeHeader = el.optHeader.checked;
  void saveOptions();
});

el.optParagraphs.addEventListener('change', () => {
  options.paragraphMode = el.optParagraphs.checked ? 'paragraphs' : 'lines';
  void saveOptions();
  renderTranscript();
});

el.copy.addEventListener('click', () => void copyToClipboard());
el.dlMd.addEventListener('click', () => void exportText('md'));
el.dlTxt.addEventListener('click', () => void exportText('txt'));
el.dlPdf.addEventListener('click', () => void exportPdf());
el.reload.addEventListener('click', () => void load(true));

el.list.addEventListener('click', event => {
  const line = (event.target as HTMLElement).closest('.line') as HTMLElement | null;
  if (!line?.dataset.start) return;

  void seek(Number.parseFloat(line.dataset.start), line);
});

/*
 * Following the player.
 *
 * On by default, and off the moment you scroll: someone who has scrolled away
 * is reading somewhere else, and yanking them back is the single most annoying
 * thing a transcript panel can do. Any later click on a line — a seek — is
 * taken as "put me back with the video" and turns it on again.
 */
el.list.addEventListener(
  'wheel',
  () => {
    follow = false;
  },
  { passive: true },
);

el.list.addEventListener('touchmove', () => (follow = false), { passive: true });

function markPlaying(seconds: number): void {
  const items = el.list.querySelectorAll<HTMLElement>('.line');
  if (!items.length) return;

  // The last line that has started. Linear from the current position rather
  // than a fresh scan: playback moves forward, so the answer is nearly always
  // the line we are on or the next one.
  let index = playingIndex >= 0 && playingIndex < items.length ? playingIndex : 0;
  while (index + 1 < items.length && Number(items[index + 1].dataset.start) <= seconds) index++;
  while (index > 0 && Number(items[index].dataset.start) > seconds) index--;

  if (index === playingIndex) return;

  items[playingIndex]?.classList.remove('line--playing');
  playingIndex = index;
  const line = items[index];
  line.classList.add('line--playing');

  if (follow) line.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/* ── Rail, screens, appearance ───────────────────────────────────────── */

function showScreen(id: 'transcript' | 'notes' | 'library' | 'settings'): void {
  el.screenTranscript.hidden = id !== 'transcript';
  el.screenNotes.hidden = id !== 'notes';
  el.screenLibrary.hidden = id !== 'library';
  el.screenSettings.hidden = id !== 'settings';
  el.railTranscript.setAttribute('aria-current', String(id === 'transcript'));
  el.railNotes.setAttribute('aria-current', String(id === 'notes'));
  el.railLibrary.setAttribute('aria-current', String(id === 'library'));
  el.railSettings.setAttribute('aria-current', String(id === 'settings'));
}

/** `system` means "state nothing and let prefers-color-scheme decide". */
function applyTheme(): void {
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;

  for (const button of el.themes.querySelectorAll<HTMLButtonElement>('.theme')) {
    button.setAttribute('aria-pressed', String(button.dataset.theme === theme));
  }
}

async function setTheme(next: string): Promise<void> {
  theme = next;
  applyTheme();
  try {
    await chrome.storage.local.set({ [UI_KEY]: { theme } });
  } catch {
    /* a preference that fails to save is not worth interrupting anyone for */
  }
}

function buildThemePicker(): void {
  for (const [id, label, swatch] of THEMES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'theme';
    button.dataset.theme = id;

    const dot = document.createElement('span');
    dot.className = 'theme__dot';
    dot.style.background = swatch;

    const text = document.createElement('span');
    text.textContent = label;

    button.append(dot, text);
    button.addEventListener('click', () => void setTheme(id));
    el.themes.appendChild(button);
  }
}

async function loadUi(): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(UI_KEY);
    const saved = stored?.[UI_KEY]?.theme;
    if (typeof saved === 'string' && THEMES.some(([id]) => id === saved)) theme = saved;
  } catch {
    /* fall back to system */
  }
  applyTheme();
}

/* ── Notes ───────────────────────────────────────────────────────────── */

/**
 * A Markdown editor, seeded with the transcript.
 *
 * TinyMDE rather than a heavier editor, and the reason is worth writing down:
 * Crepe — the editor the web app uses — pulls in ProseMirror, CodeMirror, KaTeX
 * and a Vue runtime, and a full CodeMirror 6 markdown setup measured 479 KB
 * minified on its own. This whole extension budgets 500 KB. TinyMDE is 53 KB,
 * has no dependencies, highlights Markdown in place as you type, and is MIT.
 *
 * Bundled rather than split out: the whole panel is 83 KB, so a chunk boundary
 * here would buy a few tens of milliseconds at the cost of a second file to
 * load and reason about. The editor is still only *constructed* on first visit
 * to this screen, which is where the real cost is.
 */
let editor: import('tiny-markdown-editor').Editor | null = null;
let notesVideoId: string | null = null;
let notesSaveTimer: number | null = null;

/** The document a fresh video starts from: the transcript, plus a place to write. */
function seedMarkdown(): string {
  if (!current) return '';
  return `${toMarkdown(current, { ...options, includeHeader: true })}`;
}

function noteStatus(message: string): void {
  el.notesStatus.textContent = message;
}

/** Debounced: typing should not write to storage on every keystroke. */
function scheduleNoteSave(): void {
  if (notesSaveTimer !== null) self.clearTimeout(notesSaveTimer);
  notesSaveTimer = self.setTimeout(() => {
    notesSaveTimer = null;
    void saveNotes();
  }, 700);
}

async function saveNotes(): Promise<void> {
  if (!editor || !notesVideoId) return;

  /*
   * An untouched seed is not a document.
   *
   * Saving on open meant every video you glanced at left a "note" behind that
   * was really just a copy of its transcript. Storage filled with documents
   * nobody had written a word in. A document now exists once its content
   * differs from what was poured into it.
   */
  const content = editor.getContent();
  if (content.trim() === seedMarkdown().trim()) {
    noteStatus('');
    return;
  }

  await writeNote(notesVideoId, content, current?.meta.title ?? 'notes');
  noteStatus('Saved');
}

/** Stand the whole screen down, or bring it back. */
function setNotesGated(gated: boolean): void {
  el.notesGate.hidden = !gated;
  el.notesBar.hidden = gated;
  el.notesActions.hidden = gated;
  el.notesFoot.hidden = gated;
  el.notesEditor.hidden = gated;
  el.notesPreview.hidden = true; // the caller decides which of the two returns
}

async function openNotes(): Promise<void> {
  showScreen('notes');

  if (!current || !currentVideoId) {
    // An editor over no document, a Read button with nothing to read and four
    // export buttons with nothing to export are four promises the panel cannot
    // keep. Show the one thing that is true.
    setNotesGated(true);
    el.notesTitle.textContent = 'Notes';
    el.notesMeta.textContent = '';
    noteStatus('');
    return;
  }

  setNotesGated(false);

  if (!editor) {
    editor = new Editor({ element: el.notesEditor, content: '' });
    // The command bar is TinyMDE's own, so its buttons stay in step with what
    // the editor can actually do.
    new CommandBar({ element: el.notesBar, editor });
    editor.addEventListener('change', () => scheduleNoteSave());
  }

  // Only reload when the video changed: re-entering the screen must never
  // discard what someone has been writing.
  if (notesVideoId !== currentVideoId) {
    notesVideoId = currentVideoId;
    const saved = await readNote(currentVideoId);
    editor.setContent(saved?.markdown ?? seedMarkdown());
    noteStatus(saved ? 'Your notes' : 'Started from the transcript');
  }

  // The same header the transcript screen shows, for the same reason: what you
  // are looking at, stated once, in the same place on both screens.
  el.notesTitle.textContent = current.meta.title;
  const duration = current.meta.durationSeconds
    ? formatTimestamp(current.meta.durationSeconds, true)
    : null;
  el.notesMeta.textContent = [current.meta.channel, duration, current.languageName]
    .filter(Boolean)
    .join(' · ');

  /*
   * Arrive in the readable view.
   *
   * Reading is the common case by a wide margin — you come back to a note far
   * more often than you write one — and the source view is a poor way to read:
   * a seeded transcript opens as a wall of `**[00:00](https://…)**`. Editing is
   * one click away and says so on the button.
   *
   * Last, because rendering needs the content, and the content is only loaded
   * by the time we get here.
   */
  setPreviewing(true);

  void track('notes_opened');
}

/** Replace the document with the transcript again, on purpose and only on purpose. */
async function resetNotes(): Promise<void> {
  if (!editor || !current) return;
  const written = editor.getContent().trim();
  const seeded = seedMarkdown().trim();
  if (written && written !== seeded && !confirm('Replace your notes with the transcript again?')) {
    return;
  }
  editor.setContent(seedMarkdown());
  await saveNotes();
  // The reader may be looking at the rendered copy, which does not know the
  // document underneath it just changed.
  if (previewing) renderPreview(editor.getContent());
  noteStatus('Reloaded from the transcript');
}

/* ── Prompts and assistants ──────────────────────────────────────────── */

let promptStore: PromptStore = { prompts: BUILT_IN, defaultId: BUILT_IN[0].id };

/** The prompt being edited, or null when the editor is adding a new one. */
let editingPromptId: string | null = null;

function promptById(id: string): Prompt | undefined {
  return promptStore.prompts.find(p => p.id === id);
}

function defaultPrompt(): Prompt {
  return promptById(promptStore.defaultId) ?? promptStore.prompts[0];
}

/**
 * Copy the prompt, then open the assistant.
 *
 * Not a URL parameter: every one of these accepts one, and every one of them
 * would cut a transcript off long before it ended. The clipboard has no such
 * limit, so the reader pastes once and has all of it.
 */
async function sendTo(assistant: Assistant | null, instruction: string): Promise<void> {
  if (!current) return;

  try {
    await navigator.clipboard.writeText(toPrompt(current, options, instruction));
  } catch {
    setStatus('Could not copy to the clipboard.');
    return;
  }

  if (!assistant) {
    setStatus('Copied — paste it wherever you like');
    void remember('prompt');
  void track('copy_prompt');
    return;
  }

  void chrome.tabs.create({ url: assistant.url });
  setStatus(`Copied — paste it into ${assistant.name}`);
  void remember('prompt');
  void track('copy_prompt');
}

function closeAssistants(): void {
  el.assistants.hidden = true;
  el.copyPrompt.setAttribute('aria-expanded', 'false');
}

/**
 * The menu under the Prompt button.
 *
 * The three assistants use the default prompt without asking — the whole point
 * of choosing a default is not being asked. "Other…" is the door to everything
 * else, and it is last because it is the rarer intent.
 */
function buildAssistantMenu(): void {
  el.assistants.replaceChildren();

  const heading = document.createElement('p');
  heading.className = 'menu__heading';
  heading.textContent = defaultPrompt().name;
  el.assistants.append(heading);

  for (const assistant of ASSISTANTS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu__item';
    item.textContent = assistant.name;
    item.addEventListener('click', () => {
      closeAssistants();
      void sendTo(assistant, defaultPrompt().body);
    });
    el.assistants.append(item);
  }

  const other = document.createElement('button');
  other.type = 'button';
  other.className = 'menu__item menu__item--sep';
  other.textContent = 'Other…';
  other.addEventListener('click', () => {
    closeAssistants();
    openPromptPicker();
  });
  el.assistants.append(other);
}

/** Pick a prompt, adjust it for this one send, then choose where it goes. */
function openPromptPicker(): void {
  el.promptChoice.replaceChildren();
  for (const prompt of promptStore.prompts) {
    const option = document.createElement('option');
    option.value = prompt.id;
    option.textContent = prompt.name;
    el.promptChoice.append(option);
  }
  el.promptChoice.value = promptStore.defaultId;
  el.promptPreview.value = defaultPrompt().body;

  el.promptTargets.replaceChildren();
  for (const assistant of ASSISTANTS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.textContent = assistant.name;
    button.addEventListener('click', () => {
      el.promptPicker.close();
      void sendTo(assistant, el.promptPreview.value);
    });
    el.promptTargets.append(button);
  }

  el.promptPicker.showModal();
}

/* ── Managing prompts, in Settings ───────────────────────────────────── */

function renderPromptList(): void {
  el.promptList.replaceChildren();

  for (const prompt of promptStore.prompts) {
    const item = document.createElement('li');
    item.className = 'prompts__item';

    const pick = document.createElement('label');
    pick.className = 'prompts__pick';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'default-prompt';
    radio.checked = prompt.id === promptStore.defaultId;
    radio.title = 'Use this one by default';
    radio.addEventListener('change', async () => {
      promptStore = await setDefaultPrompt(prompt.id);
      buildAssistantMenu();
      renderPromptList();
    });
    const name = document.createElement('span');
    name.textContent = prompt.name;
    pick.append(radio, name);

    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'prompts__act';
    edit.textContent = 'Edit';
    edit.addEventListener('click', () => openPromptEditor(prompt));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'prompts__act';
    remove.textContent = 'Delete';
    // The last prompt cannot go: an empty library makes the Prompt button
    // useless, and "restore the built-ins" would be a second idea to explain.
    remove.disabled = promptStore.prompts.length <= 1;
    remove.addEventListener('click', async () => {
      if (!confirm(`Delete the "${prompt.name}" prompt?`)) return;
      promptStore = await deletePrompt(prompt.id);
      buildAssistantMenu();
      renderPromptList();
    });

    item.append(pick, edit, remove);
    el.promptList.append(item);
  }
}

function openPromptEditor(prompt: Prompt | null): void {
  editingPromptId = prompt?.id ?? null;
  el.promptEditorTitle.textContent = prompt ? 'Edit prompt' : 'New prompt';
  el.promptName.value = prompt?.name ?? '';
  el.promptBody.value = prompt?.body ?? '';
  el.promptEditor.showModal();
  el.promptName.focus();
}

async function savePromptFromEditor(): Promise<void> {
  const name = el.promptName.value.trim();
  const body = el.promptBody.value.trim();
  if (!name || !body) {
    setStatus('A prompt needs a name and an instruction.');
    return;
  }

  promptStore = await savePrompt({ id: editingPromptId ?? newPromptId(), name, body });
  el.promptEditor.close();
  buildAssistantMenu();
  renderPromptList();
}

/* ── Transcript history ──────────────────────────────────────────────── */

/** Which rows are ticked. Cleared whenever the list is rebuilt. */
const selected = new Set<string>();

function syncBulkControls(shownIds: string[]): void {
  el.libraryDelete.disabled = selected.size === 0;
  el.libraryDelete.textContent = selected.size
    ? `Delete ${selected.size} selected`
    : 'Delete selected';
  el.libraryAll.checked = shownIds.length > 0 && shownIds.every(id => selected.has(id));
}

/**
 * Everything you have taken a transcript of.
 *
 * A record of exports rather than of visits: a list that grew every time a
 * video was opened would be a browsing history with extra steps, and would bury
 * the handful of videos you actually did something with. Searching is by video
 * name, because that is what you remember.
 */
async function renderLibrary(): Promise<void> {
  const all = await listHistory();
  const query = el.librarySearch.value.trim().toLowerCase();
  const shown = query
    ? all.filter(
        entry =>
          entry.title.toLowerCase().includes(query) ||
          entry.channel.toLowerCase().includes(query),
      )
    : all;

  el.libraryList.replaceChildren();
  el.libraryEmpty.hidden = all.length > 0;

  // Nothing to search and nothing to select, so neither control is offered.
  // An empty screen should say what it is waiting for, and nothing else.
  el.libraryControls.hidden = all.length === 0;
  el.libraryCount.textContent = all.length
    ? query
      ? `${shown.length} of ${all.length}`
      : `${all.length} ${all.length === 1 ? 'video' : 'videos'}`
    : '';

  // A selection that outlived its row would delete something the reader can no
  // longer see, so it is dropped whenever the list is rebuilt.
  const shownIds = shown.map(entry => entry.videoId);
  for (const id of [...selected]) if (!shownIds.includes(id)) selected.delete(id);

  for (const entry of shown) {
    const item = document.createElement('li');
    item.className = 'library__item';

    const tick = document.createElement('input');
    tick.type = 'checkbox';
    tick.className = 'library__tick';
    tick.checked = selected.has(entry.videoId);
    tick.title = 'Select for deletion';
    tick.setAttribute('aria-label', `Select ${entry.title}`);
    tick.addEventListener('change', () => {
      if (tick.checked) selected.add(entry.videoId);
      else selected.delete(entry.videoId);
      syncBulkControls(shownIds);
    });
    item.append(tick);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'library__open';

    const title = document.createElement('strong');
    title.textContent = entry.title || entry.videoId;

    const preview = document.createElement('span');
    preview.className = 'library__preview';
    preview.textContent = entry.channel;

    const when = document.createElement('span');
    when.className = 'library__when';
    // What you took, and when — the two things that identify a row you are
    // trying to find again.
    when.textContent = `${describeActions(entry.actions)} · ${new Date(
      entry.updatedAt,
    ).toLocaleDateString()}`;

    open.append(title, preview, when);
    open.addEventListener('click', () => {
      void chrome.tabs.create({ url: entry.url });
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'library__delete';
    remove.title = 'Remove from history';
    remove.setAttribute('aria-label', `Remove ${entry.title} from history`);
    remove.textContent = '×';
    remove.addEventListener('click', async () => {
      await forgetVideos([entry.videoId]);
      await renderLibrary();
    });

    item.append(open, remove);
    el.libraryList.append(item);
  }

  syncBulkControls(shownIds);
}

/* ── Reading, rather than editing ────────────────────────────────────── */

let previewing = false;

/**
 * Render the notes as prose.
 *
 * TinyMDE is a source editor: it colours the Markdown in place, which is right
 * while you are writing and wrong when you want to read what you wrote. This is
 * the other half — headings that look like headings, lists that look like
 * lists — and it is a view, not a mode: nothing is edited here.
 *
 * The Markdown is escaped before it is parsed. A transcript is text from
 * YouTube, and text from anywhere else is not markup until we say it is. The
 * page's CSP would stop a script tag from running, but "the CSP will catch it"
 * is not a reason to hand it HTML in the first place.
 */
function renderPreview(markdown: string): void {
  const escaped = markdown.replace(/[<>]/g, ch => (ch === '<' ? '&lt;' : '&gt;'));
  el.notesPreview.innerHTML = marked.parse(escaped, { async: false }) as string;

  // Links open a tab rather than navigating the panel to a page with no way back.
  for (const link of el.notesPreview.querySelectorAll('a')) {
    const href = link.getAttribute('href') ?? '';
    link.removeAttribute('href');
    if (!/^https?:/i.test(href)) continue;
    link.setAttribute('role', 'link');
    link.setAttribute('tabindex', '0');
    link.addEventListener('click', () => void chrome.tabs.create({ url: href }));
  }
}

function setPreviewing(on: boolean): void {
  previewing = on;
  el.notesEditor.hidden = on;
  el.notesBar.hidden = on;
  el.notesPreview.hidden = !on;
  el.notesView.setAttribute('aria-pressed', String(on));
  el.notesView.title = on ? 'Back to editing' : 'Read it as prose';
  el.notesView.setAttribute('aria-label', on ? 'Back to editing' : 'Switch to the readable view');
  el.notesViewLabel.textContent = on ? 'Edit' : 'Read';

  if (on && editor) renderPreview(editor.getContent());
}

/** Called by every path that takes a transcript out of the panel. */
async function remember(action: HistoryAction): Promise<void> {
  if (!current || !currentVideoId) return;
  await recordTaken(
    {
      videoId: currentVideoId,
      title: current.meta.title,
      channel: current.meta.channel,
      url: current.meta.url,
    },
    action,
  );
}

/* ── The overflow menu, at the foot of the rail ──────────────────────── */

const SITE = 'https://coolsoftware.io';
const PRODUCT_SLUG = 'youtube-transcript-export';

/** A page rather than a mailto: a blank draft asks the reporter to guess what is needed. */
function bugReportUrl(): string {
  const q = new URLSearchParams({
    product: PRODUCT_SLUG,
    version: chrome.runtime.getManifest().version,
  });
  return `${SITE}/support/?${q.toString()}`;
}

/**
 * Destinations, not settings.
 *
 * Everything here is one click and one tab, with no state to manage — which is
 * exactly why it is a menu and not a screen. Settings stays in the rail because
 * it is a place you work, not a place you leave for.
 */
const MENU: Array<[string, () => void]> = [
  ['Guide & quick start', () => void chrome.runtime.openOptionsPage()],
  [
    'Walkthrough videos',
    () => void chrome.tabs.create({ url: `${SITE}/extensions/${PRODUCT_SLUG}/#walkthroughs` }),
  ],
  ['Report a bug', () => void chrome.tabs.create({ url: bugReportUrl() })],
  [
    /*
     * Next to Report a bug on purpose: both are "I have something to say about
     * this", and someone who came looking for one is often really after the
     * other — a missing feature reads as a fault until you are shown where to
     * ask for it.
     */
    'Vote for the next feature',
    () => void chrome.tabs.create({ url: `${SITE}/extensions/${PRODUCT_SLUG}/#roadmap` }),
  ],
  [
    'Rate this extension',
    () =>
      void chrome.tabs.create({
        url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`,
      }),
  ],
  [
    'Privacy & terms',
    () => void chrome.tabs.create({ url: `${SITE}/legal/privacy/#${PRODUCT_SLUG}` }),
  ],
];

function closeMenu(): void {
  el.menu.hidden = true;
  el.railMenu.setAttribute('aria-expanded', 'false');
}

function buildMenu(): void {
  for (const [label, run] of MENU) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu__item';
    item.textContent = label;
    item.addEventListener('click', () => {
      closeMenu();
      run();
    });
    el.menu.appendChild(item);
  }
}

buildThemePicker();
buildMenu();
showScreen('transcript');

el.railTranscript.addEventListener('click', () => showScreen('transcript'));
el.railNotes.addEventListener('click', () => void openNotes());
el.railLibrary.addEventListener('click', () => {
  showScreen('library');
  void renderLibrary();
});
el.librarySearch.addEventListener('input', () => void renderLibrary());

// Select-all covers what is on screen, not what is in storage: with a search
// active, "all" meaning "including the ones you filtered out" would delete
// documents the reader never saw.
el.libraryAll.addEventListener('change', () => {
  for (const tick of el.libraryList.querySelectorAll<HTMLInputElement>('.library__tick')) {
    tick.checked = el.libraryAll.checked;
    tick.dispatchEvent(new Event('change'));
  }
});

el.libraryDelete.addEventListener('click', async () => {
  const ids = [...selected];
  if (ids.length === 0) return;
  if (!confirm(`Remove ${ids.length} ${ids.length === 1 ? 'video' : 'videos'} from your history?`)) {
    return;
  }

  await forgetVideos(ids);
  selected.clear();
  el.libraryAll.checked = false;
  await renderLibrary();
});

el.notesPdf.addEventListener('click', () => {
  if (!editor || !current) return;

  const { blob, unsupportedCharacters } = generatePdf(
    notesToPdfDocument(current.meta.title, editor.getContent()),
  );
  const url = URL.createObjectURL(blob);
  void chrome.downloads
    .download({ url, filename: buildFilename(current, 'pdf').replace(' - transcript', ' - notes') })
    .finally(() => URL.revokeObjectURL(url));

  // The PDF fonts are the standard ones, so anything outside WinAnsi is dropped
  // rather than drawn — better to say so than to hand over a document with
  // holes in it.
  noteStatus(
    unsupportedCharacters.length
      ? `Saved — ${unsupportedCharacters.length} character(s) the PDF font cannot draw were skipped`
      : 'Saved to your downloads',
  );
});
el.railSettings.addEventListener('click', () => showScreen('settings'));

el.notesReset.addEventListener('click', () => void resetNotes());
el.notesView.addEventListener('click', () => setPreviewing(!previewing));
el.notesGateOpen.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'https://www.youtube.com/' });
});

el.notesCopy.addEventListener('click', async () => {
  if (!editor) return;
  try {
    await navigator.clipboard.writeText(editor.getContent());
    noteStatus('Copied');
  } catch {
    noteStatus('Could not copy.');
  }
});

el.notesDownload.addEventListener('click', () => {
  if (!editor || !current) return;
  const blob = new Blob([editor.getContent()], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  void chrome.downloads
    .download({ url, filename: buildFilename(current, 'md').replace(' - transcript', ' - notes') })
    .finally(() => URL.revokeObjectURL(url));
  noteStatus('Saved to your downloads');
});

// Typing must not reach the panel's own shortcuts — Escape in the editor is an
// editor concern, and the overflow menu has no business closing over it.
el.notesEditor.addEventListener('keydown', event => event.stopPropagation());

el.railMenu.addEventListener('click', event => {
  event.stopPropagation();
  const open = el.menu.hidden;
  el.menu.hidden = !open;
  el.railMenu.setAttribute('aria-expanded', String(open));
});

// Dismissed by the next click anywhere, or Escape. It is a list of links, not
// a dialog: nothing here is worth trapping focus for.
document.addEventListener('click', () => closeMenu());
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeMenu();
});

el.guide.addEventListener('click', () => void chrome.runtime.openOptionsPage());

void loadUi();

el.version.textContent = `v${chrome.runtime.getManifest().version}`;
el.studio.addEventListener('click', () => void chrome.tabs.create({ url: PRODUCT_URL }));

el.statsToggle.addEventListener('click', () => void showStats());
el.statsClose.addEventListener('click', () => el.stats.close());
el.statsClear.addEventListener('click', async () => {
  await clearMetrics();
  await showStats();
});

// YouTube swaps videos without a page load; the content script tells us.
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'YTX_NAVIGATED') void load();
  if (message?.type === 'YTX_TIME' && typeof message.seconds === 'number') {
    markPlaying(message.seconds);
  }
  return false;
});

chrome.tabs.onActivated.addListener(() => void load());

/** Ask the page to report its play position — and to stop when we go away. */
async function setTracking(on: boolean): Promise<void> {
  if (currentTabId === null) return;
  try {
    await tell(currentTabId, { type: 'YTX_TRACK', on });
  } catch {
    /* the page is gone or not ours; following is a nicety, not a promise */
  }
}

// A closed panel is not listening, and a page timing for nobody is waste.
window.addEventListener('pagehide', () => void setTracking(false));

void (async () => {
  await loadOptions();
  promptStore = await readPrompts();
  buildAssistantMenu();
  renderPromptList();
  void track('panel_opened');
  await load();
  await setTracking(true);
})();
