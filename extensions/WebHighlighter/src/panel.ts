/**
 * The side panel: this page's highlights, the export controls, and the data
 * ownership surface (export / import / clear).
 *
 * The panel owns no state of its own — the content script is the single writer
 * for a page's record, and the panel asks it for the current picture whenever
 * something changes. That keeps two writers from racing over one storage key.
 */

import { buildFilename, toHtml, toMarkdown, toPdfDocument, toPlainText } from './formatters';
import { htmlToMarkdown } from './markdown';
import { anchorSuccessRate, clearMetrics, readMetrics, track } from './metrics';
import { generatePdf } from './pdf';
import { clearAllData, exportBackup, importBackup, quotaStatus, readOptions, writeOptions } from './storage';
import {
  COLORS,
  DEFAULT_EXPORT_OPTIONS,
  ExportOptions,
  ExportScope,
  ExtractedArticle,
  HighlightColor,
  PageState,
} from './types';
import { isSupportedUrl } from './url';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  title: $('page-title'),
  meta: $('page-meta'),
  refresh: $<HTMLButtonElement>('refresh'),
  controls: $('controls'),
  pageNote: $<HTMLTextAreaElement>('page-note'),
  scopeHighlights: $<HTMLButtonElement>('scope-highlights'),
  scopePage: $<HTMLButtonElement>('scope-page'),
  optMeta: $<HTMLInputElement>('opt-meta'),
  optNotes: $<HTMLInputElement>('opt-notes'),
  optUrl: $<HTMLInputElement>('opt-url'),
  copy: $<HTMLButtonElement>('copy'),
  dlMd: $<HTMLButtonElement>('dl-md'),
  dlHtml: $<HTMLButtonElement>('dl-html'),
  dlPdf: $<HTMLButtonElement>('dl-pdf'),
  dlTxt: $<HTMLButtonElement>('dl-txt'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  pageClear: $<HTMLButtonElement>('page-clear'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let state: PageState | null = null;
let tabId: number | null = null;
let scope: ExportScope = 'highlights';
let options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };

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

/**
 * The panel's empty state, for a panel open where it cannot work.
 *
 * Not an error and not the user's mistake — there is simply nothing here to
 * show. A sentence in grey says that as weakly as possible; the mark, a line of
 * real weight and the button that fixes it say it once and get out of the way.
 * Same shape in every extension in the set, so "why is this empty?" always
 * looks the same.
 */
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
    // No content script: a restricted page, or the tab hasn't finished loading.
    return null;
  }
}

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;

  if (!tab || !isSupportedUrl(tab.url)) {
    state = null;
    els.controls.hidden = true;
    els.title.textContent = 'Web Highlighter';
    els.meta.textContent = '';
    showGate(
      'Open a web page to get started',
      'Browser pages, the extensions gallery and PDFs are off limits to every extension, so there is nothing here to highlight. Any ordinary page will do.',
    );
    return;
  }

  const next = await ask<PageState>({ type: 'WH_GET_STATE' });
  if (!next) {
    state = null;
    els.controls.hidden = true;
    // The one gate with a fix the panel can perform itself: extensions are not
    // injected into tabs that were already open when they were installed.
    showGate(
      'Reload this page first',
      'This tab was open before the extension was installed or updated, so it has no highlighter in it yet. One reload and it is ready.',
      'Reload the page',
      () => {
        if (tabId !== null) void chrome.tabs.reload(tabId);
      },
    );
    return;
  }

  state = next;
  els.title.textContent = next.meta.title || tab.title || 'Untitled page';
  els.meta.textContent = [next.meta.site, next.meta.author, next.meta.captured].filter(Boolean).join(' · ');
  els.controls.hidden = false;
  if (document.activeElement !== els.pageNote) els.pageNote.value = next.pageNote;
  renderList();
}

/* ── List ────────────────────────────────────────────────────────────── */

function renderList(): void {
  if (!state) return;

  const highlights = [...state.highlights].sort((a, b) => {
    if (a.anchored !== b.anchored) return a.anchored ? -1 : 1;
    return a.anchored ? a.order - b.order : a.createdAt - b.createdAt;
  });

  els.list.replaceChildren();

  if (!highlights.length) {
    showState('Select text on the page, then pick a colour. Your highlights show up here.');
    setStatus('');
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;

  for (const highlight of highlights) {
    const item = document.createElement('li');
    item.className = `item item--${highlight.color}${highlight.anchored ? '' : ' item--orphan'}`;

    const quote = document.createElement('p');
    quote.className = 'item__quote';
    quote.textContent = highlight.exact;
    quote.title = highlight.anchored ? 'Click to scroll the page to this highlight' : 'Click to show the full text';
    quote.addEventListener('click', () => {
      if (highlight.anchored) void scrollTo(highlight.id);
      else quote.classList.toggle('item__quote--full');
    });
    item.appendChild(quote);

    if (!highlight.anchored) {
      const warn = document.createElement('p');
      warn.className = 'item__warn';
      // The text and note are intact in storage — say that plainly, because
      // this message is the moment a user decides whether to trust the tool.
      warn.textContent = 'Couldn’t locate this on the page — the text and note are still saved.';
      item.appendChild(warn);
    }

    if (highlight.note.trim()) {
      const note = document.createElement('p');
      note.className = 'item__note';
      note.textContent = highlight.note;
      item.appendChild(note);
    }

    const editor = document.createElement('textarea');
    editor.className = 'item__note-edit';
    editor.rows = 2;
    editor.value = highlight.note;
    editor.placeholder = 'Note on this highlight…';
    editor.addEventListener('blur', () => {
      if (editor.value === highlight.note) return;
      void ask({ type: 'WH_SET_NOTE', id: highlight.id, note: editor.value }).then(() => {
        if (editor.value.trim()) void track('note_attached');
        void refresh();
      });
    });

    const actions = document.createElement('div');
    actions.className = 'item__actions';

    for (const color of COLORS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `dot${color === highlight.color ? ' dot--on' : ''}`;
      dot.style.background = `var(--${color})`;
      dot.title = `Change to ${color}`;
      dot.setAttribute('aria-label', `Change to ${color}`);
      dot.addEventListener('click', () => void setColor(highlight.id, color));
      actions.appendChild(dot);
    }

    const noteButton = document.createElement('button');
    noteButton.type = 'button';
    noteButton.className = 'link-btn';
    noteButton.textContent = highlight.note.trim() ? 'Edit note' : 'Add note';
    noteButton.style.marginLeft = '6px';
    noteButton.addEventListener('click', () => {
      editor.classList.toggle('item__note-edit--open');
      editor.focus();
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'link-btn';
    deleteButton.textContent = 'Delete';
    deleteButton.style.marginLeft = 'auto';
    deleteButton.addEventListener('click', () => void remove(highlight.id));

    actions.appendChild(noteButton);
    actions.appendChild(deleteButton);
    item.appendChild(actions);
    item.appendChild(editor);
    els.list.appendChild(item);
  }

  const orphans = highlights.filter(h => !h.anchored).length;
  setStatus(
    `${highlights.length} highlight${highlights.length === 1 ? '' : 's'}` +
      (orphans ? ` · ${orphans} not found on this page` : '')
  );
}

async function scrollTo(id: string): Promise<void> {
  const result = await ask<{ ok: boolean }>({ type: 'WH_SCROLL_TO', id });
  if (result?.ok) void track('scroll_to_used');
  else setStatus('That highlight is not on the page right now.');
}

async function setColor(id: string, color: HighlightColor): Promise<void> {
  await ask({ type: 'WH_SET_COLOR', id, color });
  void track('color_changed');
  await refresh();
}

async function remove(id: string): Promise<void> {
  await ask({ type: 'WH_DELETE', id });
  await refresh();
}

/* ── Exporting ───────────────────────────────────────────────────────── */

async function buildInput() {
  if (!state) return null;

  let article: { markdown: string; html: string; text: string; fallback: boolean } | undefined;
  if (scope === 'page') {
    const extracted = await ask<ExtractedArticle>({ type: 'WH_EXTRACT' });
    if (!extracted || (!extracted.html && !extracted.text)) {
      setStatus('Nothing could be extracted from this page.');
      return null;
    }
    article = {
      markdown: htmlToMarkdown(extracted.html),
      html: extracted.html,
      text: extracted.text,
      fallback: extracted.fallback,
    };
    if (extracted.fallback) {
      setStatus('Reader view failed here — exported the cleaned page instead.');
    }
  }

  void track(scope === 'page' ? 'scope_page' : 'scope_highlights');
  return { state, options, scope, article };
}

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    // Revoke late: Chrome reads the blob asynchronously after download() resolves.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportAs(format: 'md' | 'html' | 'txt'): Promise<void> {
  const input = await buildInput();
  if (!input) return;

  const content =
    format === 'md' ? toMarkdown(input) : format === 'html' ? toHtml(input) : toPlainText(input);
  const type = format === 'md' ? 'text/markdown' : format === 'html' ? 'text/html' : 'text/plain';

  try {
    await download(new Blob([content], { type: `${type};charset=utf-8` }), buildFilename(input.state.meta, format));
    setStatus(`Saved .${format}`);
    void track(format === 'md' ? 'export_md' : format === 'html' ? 'export_html' : 'export_txt');
  } catch (error: any) {
    setStatus(error?.message || `Could not save the .${format} file.`);
  }
}

async function exportPdf(): Promise<void> {
  const input = await buildInput();
  if (!input) return;

  setStatus('Building PDF…');
  try {
    const { blob, unsupportedCharacters } = generatePdf(toPdfDocument(input));
    await download(blob, buildFilename(input.state.meta, 'pdf'));
    void track('export_pdf');
    setStatus(
      unsupportedCharacters.length
        ? 'Saved .pdf — some characters cannot be drawn in a PDF; use .md or .html for a faithful copy.'
        : 'Saved .pdf'
    );
  } catch (error: any) {
    setStatus(error?.message || 'Could not build the PDF.');
  }
}

async function copyMarkdown(): Promise<void> {
  const input = await buildInput();
  if (!input) return;
  try {
    await navigator.clipboard.writeText(toMarkdown(input));
    setStatus('Copied as Markdown');
    void track('copy_markdown');
  } catch {
    setStatus('Clipboard access was blocked.');
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
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `web-highlighter-backup-${stamp}.json`);
    setStatus(`Exported ${backup.pages.length} page${backup.pages.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.highlights} highlight${result.highlights === 1 ? '' : 's'} across ${result.pages} pages`);
    void track('data_imported');
    await refresh();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const rate = anchorSuccessRate(metrics);
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    rate === null
      ? 'Highlights restored: no data yet'
      : `Highlights restored: ${rate}% of ${metrics.anchor.attempted} attempts`,
    `  exact ${metrics.anchor.exact} · whitespace ${metrics.anchor.whitespace} · fuzzy ${metrics.anchor.fuzzy} · failed ${metrics.anchor.failed}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

function setScope(next: ExportScope): void {
  scope = next;
  els.scopeHighlights.classList.toggle('seg--on', next === 'highlights');
  els.scopePage.classList.toggle('seg--on', next === 'page');
}

function bindOption(input: HTMLInputElement, key: keyof ExportOptions): void {
  input.checked = options[key];
  input.addEventListener('change', () => {
    options = { ...options, [key]: input.checked };
    void writeOptions(options);
  });
}

els.refresh.addEventListener('click', () => void refresh());
els.scopeHighlights.addEventListener('click', () => setScope('highlights'));
els.scopePage.addEventListener('click', () => setScope('page'));
els.copy.addEventListener('click', () => void copyMarkdown());
els.dlMd.addEventListener('click', () => void exportAs('md'));
els.dlHtml.addEventListener('click', () => void exportAs('html'));
els.dlTxt.addEventListener('click', () => void exportAs('txt'));
els.dlPdf.addEventListener('click', () => void exportPdf());

els.pageNote.addEventListener('blur', () => {
  if (!state || els.pageNote.value === state.pageNote) return;
  void ask({ type: 'WH_SET_PAGE_NOTE', note: els.pageNote.value }).then(() => {
    void track('page_note_saved');
    void refresh();
  });
});

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());
els.dataExport.addEventListener('click', () => void exportAllData());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});

els.pageClear.addEventListener('click', () => {
  if (!confirm('Remove every highlight and the note on this page?')) return;
  void ask({ type: 'WH_CLEAR_PAGE' }).then(() => {
    els.data.close();
    void refresh();
  });
});

els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every highlight on every page? Export first if you want a copy.')) return;
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

// The content script tells us when a page's highlights change.
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'WH_STATE_CHANGED') void refresh();
});

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && changeInfo.status === 'complete') void refresh();
});

void (async () => {
  options = await readOptions(DEFAULT_EXPORT_OPTIONS);
  bindOption(els.optMeta, 'includeMeta');
  bindOption(els.optNotes, 'includeNotes');
  bindOption(els.optUrl, 'includeSourceUrl');
  setScope('highlights');
  void track('panel_opened');
  await refresh();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from “Data”.');
})();
