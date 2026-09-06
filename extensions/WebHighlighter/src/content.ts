/**
 * Runs on every page. Four jobs:
 *   1. restore stored highlights, and keep re-trying as the page changes
 *   2. offer the colour toolbar on selection, and the editor on click
 *   3. persist every change to chrome.storage.local
 *   4. answer the panel's questions about this page
 *
 * All of the extension's UI lives inside one shadow root marked `data-wh-ui`,
 * so the host page's CSS cannot reach it and our text never leaks into the
 * user's quotes. Nothing here makes a network request — see PRIVACY.md.
 */

import {
  COLOR_VALUES,
  UI_ATTR,
  MARK_ATTR,
  anchorSelector,
  buildIndex,
  describeRange,
  findMarks,
  flashMarks,
  paintRange,
  recolorMarks,
  unpaint,
  unpaintAll,
} from './anchor';
import { extractArticle, readPageMeta } from './extract';
import { track, trackAnchoring } from './metrics';
import { emptyRecord, mutatePage, readPage } from './storage';
import { Highlight, HighlightColor, COLORS, PageMeta, PageState, ResolvedHighlight } from './types';
import { isSupportedUrl, normalizeUrl } from './url';

/* ── Page-level state ────────────────────────────────────────────────── */

let meta: PageMeta = readPageMeta();
let highlights: Highlight[] = [];
let pageNote = '';
/** id → whether the quote could be re-found this visit. */
const anchored = new Map<string, boolean>();
let currentUrl = normalizeUrl(location.href);

const supported = isSupportedUrl(location.href);

function newId(): string {
  return `h_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'WH_STATE_CHANGED', url: currentUrl }).catch(() => undefined);
}

function documentOrder(): Map<string, number> {
  const order = new Map<string, number>();
  const marks = document.querySelectorAll<HTMLElement>(`mark[${MARK_ATTR}]`);
  let next = 0;
  marks.forEach(mark => {
    const id = mark.getAttribute(MARK_ATTR);
    if (id && !order.has(id)) order.set(id, next++);
  });
  return order;
}

function buildState(): PageState {
  const order = documentOrder();
  const resolved: ResolvedHighlight[] = highlights.map(highlight => ({
    ...highlight,
    anchored: anchored.get(highlight.id) ?? false,
    order: order.get(highlight.id) ?? -1,
  }));
  return {
    meta,
    highlights: resolved,
    pageNote,
    unsupported: supported ? null : 'This page type cannot be highlighted. Try a normal http(s) page.',
  };
}

async function persist(mutate: (record: { highlights: Highlight[]; pageNote: string }) => void): Promise<void> {
  await mutatePage(currentUrl, meta, record => {
    mutate(record);
    highlights = record.highlights;
    pageNote = record.pageNote;
  });
  notifyPanel();
}

/* ── Restoring ───────────────────────────────────────────────────────── */

/**
 * Re-anchors any highlight not currently painted. Called on load, on DOM
 * mutation and after SPA navigation, so late-arriving content still gets its
 * marks. Failures are recorded, never dropped — losing someone's note is the
 * one unrecoverable failure in this product (PRD §7).
 */
function restore(): void {
  if (!supported || !highlights.length) return;

  const outcomes: Array<'exact' | 'whitespace' | 'fuzzy' | 'failed'> = [];
  let changed = false;

  for (const highlight of highlights) {
    if (findMarks(highlight.id).length) continue;

    // Rebuilt per highlight: painting splits text nodes, which invalidates
    // every offset in the index we just used.
    const index = buildIndex();
    const outcome = anchorSelector(index, highlight);

    if (outcome.range) {
      const marks = paintRange(outcome.range, highlight.id, highlight.color);
      if (marks.length) {
        if (anchored.get(highlight.id) !== true) changed = true;
        anchored.set(highlight.id, true);
        outcomes.push(outcome.pass === 'failed' ? 'exact' : outcome.pass);
        continue;
      }
    }

    if (anchored.get(highlight.id) !== false) changed = true;
    anchored.set(highlight.id, false);
    outcomes.push('failed');
  }

  if (outcomes.length) void trackAnchoring(outcomes);
  if (changed) notifyPanel();
}

let restoreTimer: number | undefined;

function scheduleRestore(delay = 250): void {
  window.clearTimeout(restoreTimer);
  restoreTimer = window.setTimeout(restore, delay);
}

async function loadPage(): Promise<void> {
  if (!supported) return;
  currentUrl = normalizeUrl(location.href);
  meta = readPageMeta();
  const record = (await readPage(currentUrl)) ?? emptyRecord(meta);
  highlights = record.highlights;
  pageNote = record.pageNote;
  anchored.clear();
  restore();
  notifyPanel();
}

/* ── UI shell (shadow DOM) ───────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;

  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  // Fixed, zero-size and out of flow: the host page's layout never moves.
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Injected into the shadow root, so a strict page CSP on style-src cannot
  // block it the way an inline <style> in the page would.
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

const SHADOW_CSS = `
  .pop {
    position: fixed;
    display: none;
    box-sizing: border-box;
    background: #ffffff;
    color: #0f0f0f;
    border: 1px solid rgba(0,0,0,.14);
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,.22);
    padding: 6px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .pop--open { display: block; }
  .row { display: flex; align-items: center; gap: 6px; }
  .swatch {
    width: 22px; height: 22px; border-radius: 50%;
    border: 1px solid rgba(0,0,0,.2); cursor: pointer; padding: 0;
  }
  .swatch[aria-pressed="true"] { outline: 2px solid #0f0f0f; outline-offset: 1px; }
  .divider { width: 1px; align-self: stretch; background: rgba(0,0,0,.12); margin: 2px 2px; }
  .action {
    border: none; background: none; cursor: pointer; border-radius: 6px;
    padding: 4px 8px; font: inherit; color: #0f0f0f; white-space: nowrap;
  }
  .action:hover { background: rgba(0,0,0,.07); }
  .action--danger { color: #b3261e; }
  .note { display: none; margin-top: 6px; }
  .note--open { display: block; }
  .note textarea {
    width: 260px; height: 74px; resize: vertical; box-sizing: border-box;
    border: 1px solid rgba(0,0,0,.18); border-radius: 6px; padding: 6px;
    font: inherit; color: #0f0f0f; background: #fff;
  }
  .note .row { justify-content: flex-end; margin-top: 4px; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #0f0f0f; color: #fff; padding: 8px 14px; border-radius: 999px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    opacity: 0; transition: opacity .18s ease; pointer-events: none;
  }
  .toast--on { opacity: .94; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

function makePopover(): HTMLDivElement {
  const pop = document.createElement('div');
  pop.className = 'pop';
  ui().appendChild(pop);
  return pop;
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

function toast(message: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    ui().appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('toast--on'), 1600);
}

/** Keeps a popover on screen next to the thing it belongs to. */
function positionAt(pop: HTMLElement, rect: DOMRect): void {
  pop.classList.add('pop--open');
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
  const above = rect.top - height - 8;
  const top = above > 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - height - 8);
  pop.style.left = `${Math.round(left)}px`;
  pop.style.top = `${Math.round(top)}px`;
}

function swatch(color: HighlightColor, onPick: (color: HighlightColor) => void, active?: HighlightColor) {
  const button = document.createElement('button');
  button.className = 'swatch';
  button.type = 'button';
  button.title = color;
  button.setAttribute('aria-label', `Highlight ${color}`);
  button.setAttribute('aria-pressed', String(active === color));
  button.style.background = COLOR_VALUES[color];
  button.addEventListener('mousedown', event => event.preventDefault()); // keep the selection alive
  button.addEventListener('click', () => onPick(color));
  return button;
}

/* ── Selection toolbar ───────────────────────────────────────────────── */

let selectionPop: HTMLDivElement | null = null;
let pendingRange: Range | null = null;

function hideSelectionToolbar(): void {
  selectionPop?.classList.remove('pop--open');
  pendingRange = null;
}

function showSelectionToolbar(range: Range): void {
  if (!selectionPop) {
    selectionPop = makePopover();
    const row = document.createElement('div');
    row.className = 'row';
    for (const color of COLORS) row.appendChild(swatch(color, c => createHighlight(c)));
    selectionPop.appendChild(row);
  }
  pendingRange = range;
  positionAt(selectionPop, range.getBoundingClientRect());
}

async function createHighlight(color: HighlightColor): Promise<void> {
  const range = pendingRange;
  hideSelectionToolbar();
  if (!range) return;

  const index = buildIndex();
  const described = describeRange(index, range);
  if (!described) {
    toast('That selection could not be captured.');
    return;
  }

  const highlight: Highlight = {
    id: newId(),
    color,
    exact: described.exact,
    prefix: described.prefix,
    suffix: described.suffix,
    hint: described.hint,
    note: '',
    createdAt: Date.now(),
  };

  // Paint from the described offsets rather than the live selection: the
  // stored quote is whitespace-trimmed, and the mark must match it exactly.
  const outcome = anchorSelector(index, highlight);
  const painted = outcome.range ? paintRange(outcome.range, highlight.id, color) : [];
  anchored.set(highlight.id, painted.length > 0);

  window.getSelection()?.removeAllRanges();
  await persist(record => {
    record.highlights.push(highlight);
  });
  void track('highlight_created');
}

document.addEventListener('selectionchange', () => {
  if (!supported) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideSelectionToolbar();
    return;
  }
  const range = selection.getRangeAt(0);
  if (!range.toString().trim()) {
    hideSelectionToolbar();
    return;
  }
  // Ignore selections inside inputs and editable regions — the user is writing.
  const target = range.commonAncestorContainer as HTMLElement;
  const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  if (element?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) {
    hideSelectionToolbar();
    return;
  }
  if (element?.closest(`[${UI_ATTR}]`)) return;
  showSelectionToolbar(range);
});

/* ── Highlight editor ────────────────────────────────────────────────── */

let editorPop: HTMLDivElement | null = null;
let editingId: string | null = null;
let noteBox: HTMLTextAreaElement | null = null;
let noteWrap: HTMLDivElement | null = null;
let swatchRow: HTMLDivElement | null = null;

function buildEditor(): HTMLDivElement {
  const pop = makePopover();

  const row = document.createElement('div');
  row.className = 'row';
  swatchRow = row;

  const divider = document.createElement('div');
  divider.className = 'divider';

  const noteButton = document.createElement('button');
  noteButton.className = 'action';
  noteButton.type = 'button';
  noteButton.textContent = 'Note';
  noteButton.addEventListener('click', () => {
    noteWrap?.classList.toggle('note--open');
    noteBox?.focus();
  });

  const removeButton = document.createElement('button');
  removeButton.className = 'action action--danger';
  removeButton.type = 'button';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => void removeHighlight());

  row.appendChild(divider);
  row.appendChild(noteButton);
  row.appendChild(removeButton);

  noteWrap = document.createElement('div');
  noteWrap.className = 'note';
  noteBox = document.createElement('textarea');
  noteBox.placeholder = 'Note on this highlight…';
  const noteRow = document.createElement('div');
  noteRow.className = 'row';
  const saveButton = document.createElement('button');
  saveButton.className = 'action';
  saveButton.type = 'button';
  saveButton.textContent = 'Save note';
  saveButton.addEventListener('click', () => void saveNote());
  noteRow.appendChild(saveButton);
  noteWrap.appendChild(noteBox);
  noteWrap.appendChild(noteRow);

  pop.appendChild(row);
  pop.appendChild(noteWrap);
  return pop;
}

function openEditor(id: string, rect: DOMRect): void {
  const highlight = highlights.find(h => h.id === id);
  if (!highlight) return;

  if (!editorPop) editorPop = buildEditor();
  editingId = id;

  // Rebuild the swatches so the active colour is right for this highlight.
  if (swatchRow) {
    for (const old of Array.from(swatchRow.querySelectorAll('.swatch'))) old.remove();
    COLORS.slice()
      .reverse()
      .forEach(color =>
        swatchRow!.insertBefore(swatch(color, c => void changeColor(c), highlight.color), swatchRow!.firstChild)
      );
  }

  if (noteBox) noteBox.value = highlight.note;
  noteWrap?.classList.toggle('note--open', Boolean(highlight.note));
  positionAt(editorPop, rect);
}

function closeEditor(): void {
  editorPop?.classList.remove('pop--open');
  editingId = null;
}

async function changeColor(color: HighlightColor): Promise<void> {
  const id = editingId;
  if (!id) return;
  recolorMarks(id, color);
  await persist(record => {
    const highlight = record.highlights.find(h => h.id === id);
    if (highlight) highlight.color = color;
  });
  void track('color_changed');
  closeEditor();
}

async function saveNote(): Promise<void> {
  const id = editingId;
  if (!id || !noteBox) return;
  const note = noteBox.value;
  await persist(record => {
    const highlight = record.highlights.find(h => h.id === id);
    if (highlight) highlight.note = note;
  });
  if (note.trim()) void track('note_attached');
  toast('Note saved');
  closeEditor();
}

async function removeHighlight(id = editingId): Promise<void> {
  if (!id) return;
  unpaint(id);
  anchored.delete(id);
  closeEditor();
  await persist(record => {
    record.highlights = record.highlights.filter(h => h.id !== id);
  });
  void track('highlight_deleted');
}

document.addEventListener(
  'click',
  event => {
    if (!supported) return;
    const path = event.composedPath();
    if (path.some(node => node instanceof HTMLElement && node.hasAttribute(UI_ATTR))) return;

    const target = event.target as HTMLElement | null;
    const mark = target?.closest?.(`mark[${MARK_ATTR}]`) as HTMLElement | null;
    if (!mark) {
      closeEditor();
      return;
    }

    const id = mark.getAttribute(MARK_ATTR);
    if (!id) return;
    // Don't swallow the click if the highlight sits inside a link — the user
    // clicked a link that happens to be highlighted.
    if (mark.closest('a') && !event.altKey) {
      openEditor(id, mark.getBoundingClientRect());
      return;
    }
    event.preventDefault();
    openEditor(id, mark.getBoundingClientRect());
  },
  true
);

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeEditor();
    hideSelectionToolbar();
  }
});

window.addEventListener('scroll', () => {
  hideSelectionToolbar();
  closeEditor();
}, { passive: true });

/* ── Page churn: SPA navigation and late content ─────────────────────── */

const observer = new MutationObserver(mutations => {
  // Ignore our own marks, or restoring would loop forever.
  const relevant = mutations.some(mutation =>
    Array.from(mutation.addedNodes).some(node => {
      if (node.nodeType === Node.TEXT_NODE) return true;
      const el = node as HTMLElement;
      return el.nodeType === Node.ELEMENT_NODE && el.tagName !== 'MARK' && !el.hasAttribute?.(UI_ATTR);
    })
  );
  if (relevant) scheduleRestore(400);
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    const next = normalizeUrl(location.href);
    if (next === currentUrl) return; // same page, different fragment or tracking params
    unpaintAll();
    void loadPage();
  }, 700);
}

/* ── Panel messaging ─────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'WH_GET_STATE':
      sendResponse(buildState());
      return false;

    case 'WH_SCROLL_TO': {
      const marks = findMarks(message.id);
      if (marks.length) {
        marks[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
        const highlight = highlights.find(h => h.id === message.id);
        if (highlight) flashMarks(message.id, highlight.color);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    case 'WH_DELETE':
      void removeHighlight(message.id).then(() => sendResponse({ ok: true }));
      return true;

    case 'WH_SET_COLOR':
      recolorMarks(message.id, message.color);
      void persist(record => {
        const highlight = record.highlights.find(h => h.id === message.id);
        if (highlight) highlight.color = message.color;
      }).then(() => sendResponse({ ok: true }));
      return true;

    case 'WH_SET_NOTE':
      void persist(record => {
        const highlight = record.highlights.find(h => h.id === message.id);
        if (highlight) highlight.note = message.note;
      }).then(() => sendResponse({ ok: true }));
      return true;

    case 'WH_SET_PAGE_NOTE':
      void persist(record => {
        record.pageNote = message.note;
      }).then(() => sendResponse({ ok: true }));
      return true;

    case 'WH_CLEAR_PAGE':
      unpaintAll();
      anchored.clear();
      void persist(record => {
        record.highlights = [];
        record.pageNote = '';
      }).then(() => sendResponse({ ok: true }));
      return true;

    case 'WH_EXTRACT':
      try {
        sendResponse(extractArticle());
      } catch {
        sendResponse({ html: '', text: '', fallback: true });
      }
      return false;

    default:
      return false;
  }
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (supported && window.top === window) {
  void loadPage();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchUrl();
  // Content settles well after DOMContentLoaded on most sites; retry twice
  // rather than accept a miss on the first paint (PRD §6: < 500 ms).
  scheduleRestore(150);
  window.setTimeout(restore, 1200);
  window.addEventListener('load', () => scheduleRestore(300));
}
