/**
 * Runs on every page. Four jobs:
 *   1. restore stored notes at their saved (percentage) position
 *   2. let the user drag, resize, recolor, edit and delete notes
 *   3. persist every change to chrome.storage.local
 *   4. answer the panel's questions about this page, and stay in sync when
 *      the panel changes something itself
 *
 * All of the extension's UI lives inside one shadow root marked `data-sn-ui`,
 * so the host page's CSS cannot reach it and it never modifies the page's own
 * DOM — this is an overlay, not an edit (portfolio README: read-only on the
 * platform). Nothing here makes a network request — see PRIVACY.md.
 */

import { track } from './metrics';
import { cascadeOffset, clampSize, clampToDocument, DocSize, percentToPx, pxToPercent } from './position';
import { emptyRecord, mutatePage, pageKey, readPage } from './storage';
import { COLOR_VALUES, COLORS, Note, NoteColor, PageMeta, PageState } from './types';
import { isSupportedUrl, normalizeUrl, siteName } from './url';

const UI_ATTR = 'data-sn-ui';

/* ── Page-level state ────────────────────────────────────────────────── */

let meta: PageMeta = readPageMeta();
let notes: Note[] = [];
let hidden = false;
let currentUrl = normalizeUrl(location.href);

const supported = isSupportedUrl(location.href);

function readPageMeta(): PageMeta {
  return {
    url: normalizeUrl(location.href),
    title: document.title || location.hostname,
    site: siteName(location.href),
    captured: new Date().toISOString().slice(0, 10),
  };
}

function newId(): string {
  return `n_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'SN_STATE_CHANGED', url: currentUrl }).catch(() => undefined);
}

function buildState(): PageState {
  return {
    meta,
    notes,
    hidden,
    unsupported: supported ? null : 'This page type can’t hold sticky notes. Try a normal http(s) page.',
  };
}

async function persist(mutate: (record: { notes: Note[]; hidden: boolean }) => void): Promise<void> {
  await mutatePage(currentUrl, meta, record => {
    mutate(record);
    notes = record.notes;
    hidden = record.hidden;
  });
  notifyPanel();
}

function docSize(): DocSize {
  const el = document.documentElement;
  return {
    width: Math.max(el.scrollWidth, window.innerWidth),
    height: Math.max(el.scrollHeight, window.innerHeight),
  };
}

async function loadPage(): Promise<void> {
  if (!supported) return;
  currentUrl = normalizeUrl(location.href);
  meta = readPageMeta();
  const record = (await readPage(currentUrl)) ?? emptyRecord(meta);
  notes = record.notes;
  hidden = record.hidden;
  render();
  notifyPanel();
}

/* ── UI shell (shadow DOM) ───────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;
let overlayEl: HTMLDivElement | null = null;

/**
 * Positioned `absolute` at the document's own origin (not `fixed`, unlike
 * WebHighlighter's toolbar host) so that everything inside it — the notes —
 * lays out relative to the *page*, not the viewport, and scrolls with the
 * content the way a real sticky note would.
 */
function ui(): ShadowRoot {
  if (shadow) return shadow;

  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:absolute;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483647';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

function overlay(): HTMLDivElement {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.className = 'overlay';
  ui().appendChild(overlayEl);
  return overlayEl;
}

const SHADOW_CSS = `
  .overlay { position: static; }
  .note {
    position: absolute;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    min-width: 120px;
    min-height: 80px;
    background: var(--note-color, #ffe680);
    border-radius: 4px 4px 6px 6px;
    box-shadow: 0 3px 10px rgba(0,0,0,.22), 0 1px 2px rgba(0,0,0,.16);
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #2a2a1f;
    overflow: hidden;
  }
  .note__header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 4px 4px 8px;
    cursor: grab;
    background: rgba(0,0,0,.06);
    user-select: none;
  }
  .note__header:focus-visible { outline: 2px solid #1a73e8; outline-offset: -2px; }
  .note__grip { flex: 1; letter-spacing: 2px; opacity: .55; font-size: 12px; pointer-events: none; }
  .note__color, .note__delete {
    width: 20px; height: 20px; border-radius: 50%; border: 1px solid rgba(0,0,0,.18);
    cursor: pointer; padding: 0; flex: 0 0 auto; font: inherit; line-height: 1;
  }
  .note__color { background: #fff; }
  .note__delete { background: rgba(255,255,255,.55); color: #6b3a3a; font-size: 13px; }
  .note__delete:hover { background: rgba(255,255,255,.85); }
  .note__text {
    flex: 1; width: 100%; resize: none; border: none; background: transparent;
    color: inherit; font: inherit; padding: 8px; box-sizing: border-box; outline: none;
  }
  .note__text::placeholder { color: rgba(0,0,0,.4); }
  .note__resize {
    position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: nwse-resize;
    background:
      linear-gradient(135deg, transparent 0 50%, rgba(0,0,0,.28) 50% 60%, transparent 60% 70%, rgba(0,0,0,.28) 70% 80%, transparent 80% 100%);
  }
  .note--flash { animation: sn-flash 900ms ease; }
  @keyframes sn-flash {
    0%, 100% { box-shadow: 0 3px 10px rgba(0,0,0,.22), 0 1px 2px rgba(0,0,0,.16); }
    30% { box-shadow: 0 0 0 4px rgba(26,115,232,.55); }
  }
  @media (prefers-reduced-motion: reduce) { .note--flash { animation: none; } }

  .color-pop {
    position: fixed; display: none; gap: 6px; padding: 6px; background: #fff;
    border: 1px solid rgba(0,0,0,.14); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.22);
    z-index: 2147483647;
  }
  .color-pop--open { display: flex; }
  .color-pop__dot { width: 22px; height: 22px; border-radius: 50%; border: 1px solid rgba(0,0,0,.2); cursor: pointer; padding: 0; }
`;

/* ── Rendering ───────────────────────────────────────────────────────── */

const noteEls = new Map<string, HTMLDivElement>();

function render(): void {
  if (!supported) return;
  const root = overlay();
  root.style.display = hidden ? 'none' : 'block';

  const seen = new Set<string>();
  const doc = docSize();

  for (const note of notes) {
    seen.add(note.id);
    let el = noteEls.get(note.id);
    if (!el) {
      el = buildNoteElement(note.id);
      noteEls.set(note.id, el);
      root.appendChild(el);
    }
    positionNoteElement(el, note, doc);
    updateNoteChrome(el, note);
  }

  for (const [id, el] of [...noteEls]) {
    if (!seen.has(id)) {
      el.remove();
      noteEls.delete(id);
    }
  }
}

function positionNoteElement(el: HTMLDivElement, note: Note, doc: DocSize): void {
  const left = percentToPx(note.xPct, doc.width);
  const top = percentToPx(note.yPct, doc.height);
  const clamped = clampToDocument(left, top, doc.width, doc.height);
  el.style.left = `${Math.round(clamped.left)}px`;
  el.style.top = `${Math.round(clamped.top)}px`;
  el.style.width = `${note.widthPx}px`;
  el.style.height = `${note.heightPx}px`;
}

function updateNoteChrome(el: HTMLDivElement, note: Note): void {
  el.style.setProperty('--note-color', COLOR_VALUES[note.color]);
  const textarea = el.querySelector<HTMLTextAreaElement>('.note__text');
  // Never clobber text the user is actively editing.
  if (textarea && document.activeElement !== textarea && textarea.value !== note.text) {
    textarea.value = note.text;
  }
  const colorBtn = el.querySelector<HTMLButtonElement>('.note__color');
  if (colorBtn) colorBtn.style.background = COLOR_VALUES[note.color];
}

function buildNoteElement(id: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'note';
  el.dataset.noteId = id;

  const header = document.createElement('div');
  header.className = 'note__header';
  header.tabIndex = 0;
  header.setAttribute('role', 'button');
  header.setAttribute('aria-label', 'Drag to move this note. Arrow keys nudge it, Delete removes it.');

  const grip = document.createElement('span');
  grip.className = 'note__grip';
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⠿⠿';

  const colorBtn = document.createElement('button');
  colorBtn.type = 'button';
  colorBtn.className = 'note__color';
  colorBtn.title = 'Change color';
  colorBtn.setAttribute('aria-label', 'Change note color');
  colorBtn.addEventListener('pointerdown', event => event.stopPropagation());
  colorBtn.addEventListener('click', event => {
    event.stopPropagation();
    openColorPopover(id, colorBtn);
  });

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'note__delete';
  deleteBtn.title = 'Delete note';
  deleteBtn.setAttribute('aria-label', 'Delete note');
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('pointerdown', event => event.stopPropagation());
  deleteBtn.addEventListener('click', event => {
    event.stopPropagation();
    void removeNote(id);
  });

  header.append(grip, colorBtn, deleteBtn);
  header.addEventListener('pointerdown', event => {
    if (event.target !== header && event.target !== grip) return;
    startDrag(id, el, event);
  });
  header.addEventListener('keydown', event => nudgeOrDelete(event, id, el));

  const textarea = document.createElement('textarea');
  textarea.className = 'note__text';
  textarea.placeholder = 'Type a reminder…';
  textarea.setAttribute('aria-label', 'Note text');
  let saveTimer: number | undefined;
  textarea.addEventListener('input', () => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveText(id, textarea.value), 500);
  });
  textarea.addEventListener('blur', () => {
    window.clearTimeout(saveTimer);
    void saveText(id, textarea.value);
  });

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'note__resize';
  resizeHandle.setAttribute('aria-hidden', 'true');
  resizeHandle.addEventListener('pointerdown', event => startResize(id, el, event));

  el.append(header, textarea, resizeHandle);
  return el;
}

function flashNote(el: HTMLDivElement): void {
  el.classList.add('note--flash');
  window.setTimeout(() => el.classList.remove('note--flash'), 900);
}

/* ── Drag / resize / keyboard nudge ─────────────────────────────────── */

function startDrag(id: string, el: HTMLDivElement, event: PointerEvent): void {
  if (event.button !== undefined && event.button !== 0) return;
  event.preventDefault();
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = parseFloat(el.style.left) || 0;
  const startTop = parseFloat(el.style.top) || 0;
  const scrollX0 = window.scrollX;
  const scrollY0 = window.scrollY;

  function onMove(e: PointerEvent): void {
    const doc = docSize();
    const dx = e.clientX - startX + (window.scrollX - scrollX0);
    const dy = e.clientY - startY + (window.scrollY - scrollY0);
    const { left, top } = clampToDocument(startLeft + dx, startTop + dy, doc.width, doc.height);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  function onUp(): void {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    void commitPosition(id, el);
    void track('note_dragged');
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
}

function startResize(id: string, el: HTMLDivElement, event: PointerEvent): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const startY = event.clientY;
  const startWidth = el.offsetWidth;
  const startHeight = el.offsetHeight;

  function onMove(e: PointerEvent): void {
    const { width, height } = clampSize(startWidth + (e.clientX - startX), startHeight + (e.clientY - startY));
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
  }

  function onUp(): void {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    void persist(record => {
      const note = record.notes.find(n => n.id === id);
      if (note) {
        note.widthPx = width;
        note.heightPx = height;
        note.updatedAt = Date.now();
      }
    });
    void track('note_resized');
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp, { once: true });
}

function nudgeOrDelete(event: KeyboardEvent, id: string, el: HTMLDivElement): void {
  if (event.key === 'Delete' || event.key === 'Backspace') {
    event.preventDefault();
    void removeNote(id);
    return;
  }

  const step = event.shiftKey ? 40 : 10;
  let left = parseFloat(el.style.left) || 0;
  let top = parseFloat(el.style.top) || 0;
  let moved = true;

  switch (event.key) {
    case 'ArrowLeft':
      left -= step;
      break;
    case 'ArrowRight':
      left += step;
      break;
    case 'ArrowUp':
      top -= step;
      break;
    case 'ArrowDown':
      top += step;
      break;
    default:
      moved = false;
  }
  if (!moved) return;

  event.preventDefault();
  const doc = docSize();
  const clamped = clampToDocument(left, top, doc.width, doc.height);
  el.style.left = `${Math.round(clamped.left)}px`;
  el.style.top = `${Math.round(clamped.top)}px`;
  void commitPosition(id, el);
}

async function commitPosition(id: string, el: HTMLDivElement): Promise<void> {
  const doc = docSize();
  const left = parseFloat(el.style.left) || 0;
  const top = parseFloat(el.style.top) || 0;
  const xPct = pxToPercent(left, doc.width);
  const yPct = pxToPercent(top, doc.height);
  await persist(record => {
    const note = record.notes.find(n => n.id === id);
    if (note) {
      note.xPct = xPct;
      note.yPct = yPct;
      note.updatedAt = Date.now();
    }
  });
}

async function saveText(id: string, text: string): Promise<void> {
  const existing = notes.find(n => n.id === id);
  if (existing && existing.text === text) return;
  await persist(record => {
    const note = record.notes.find(n => n.id === id);
    if (note) {
      note.text = text;
      note.updatedAt = Date.now();
    }
  });
  void track('note_text_saved');
}

async function removeNote(id: string): Promise<void> {
  noteEls.get(id)?.remove();
  noteEls.delete(id);
  await persist(record => {
    record.notes = record.notes.filter(n => n.id !== id);
  });
  void track('note_deleted');
}

/* ── Color popover ──────────────────────────────────────────────────── */

let colorPop: HTMLDivElement | null = null;
let colorPopFor: string | null = null;

function openColorPopover(id: string, anchor: HTMLElement): void {
  if (!colorPop) {
    colorPop = document.createElement('div');
    colorPop.className = 'color-pop';
    for (const color of COLORS) {
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = 'color-pop__dot';
      dot.style.background = COLOR_VALUES[color];
      dot.title = color;
      dot.setAttribute('aria-label', `Set color to ${color}`);
      dot.addEventListener('mousedown', event => event.preventDefault());
      dot.addEventListener('click', () => {
        if (colorPopFor) void setColor(colorPopFor, color);
      });
      colorPop.appendChild(dot);
    }
    ui().appendChild(colorPop);
  }
  colorPopFor = id;
  const rect = anchor.getBoundingClientRect();
  colorPop.style.left = `${Math.round(rect.left)}px`;
  colorPop.style.top = `${Math.round(rect.bottom + 4)}px`;
  colorPop.classList.add('color-pop--open');
}

function closeColorPopover(): void {
  colorPop?.classList.remove('color-pop--open');
  colorPopFor = null;
}

async function setColor(id: string, color: NoteColor): Promise<void> {
  closeColorPopover();
  await persist(record => {
    const note = record.notes.find(n => n.id === id);
    if (note) {
      note.color = color;
      note.updatedAt = Date.now();
    }
  });
  void track('note_recolored');
}

document.addEventListener('click', event => {
  if (!colorPop) return;
  const path = event.composedPath();
  if (path.includes(colorPop)) return;
  closeColorPopover();
});

/* ── Creating a note ─────────────────────────────────────────────────── */

let dropCount = 0;
const DEFAULT_WIDTH = 220;
const DEFAULT_HEIGHT = 160;

async function createNote(): Promise<void> {
  if (!supported) return;
  const doc = docSize();
  const offset = cascadeOffset(dropCount++);
  const left = window.scrollX + window.innerWidth / 2 - DEFAULT_WIDTH / 2 + offset;
  const top = window.scrollY + window.innerHeight / 2 - DEFAULT_HEIGHT / 2 + offset;
  const clamped = clampToDocument(left, top, doc.width, doc.height);

  const note: Note = {
    id: newId(),
    color: 'yellow',
    text: '',
    xPct: pxToPercent(clamped.left, doc.width),
    yPct: pxToPercent(clamped.top, doc.height),
    widthPx: DEFAULT_WIDTH,
    heightPx: DEFAULT_HEIGHT,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await persist(record => {
    record.notes.push(note);
    // Dropping a note is a deliberate act — it must be visible immediately,
    // even if this page's notes are currently hidden (NFR: <100ms to visible).
    record.hidden = false;
  });
  render();

  const el = noteEls.get(note.id);
  el?.querySelector<HTMLTextAreaElement>('.note__text')?.focus();

  void track('note_created');
}

/* ── Page churn: SPA navigation ──────────────────────────────────────── */

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    const next = normalizeUrl(location.href);
    if (next === currentUrl) return; // same page, different fragment or tracking params
    void loadPage();
  }, 700);
}

let repositionTimer: number | undefined;
function scheduleReposition(delay = 200): void {
  window.clearTimeout(repositionTimer);
  repositionTimer = window.setTimeout(render, delay);
}

/* ── Panel messaging ─────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'SN_GET_STATE':
      sendResponse(buildState());
      return false;

    case 'SN_CREATE_NOTE':
      void createNote().then(() => sendResponse({ ok: true }));
      return true;

    case 'SN_SCROLL_TO': {
      const el = noteEls.get(message.id);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        flashNote(el);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false });
      }
      return false;
    }

    default:
      return false;
  }
});

// The panel (or another context) may mutate this page's notes directly in
// storage without going through this content script. Stay in sync either way.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !supported) return;
  const key = pageKey(currentUrl);
  if (!(key in changes)) return;
  const updated = changes[key].newValue as { notes?: Note[]; hidden?: boolean } | undefined;
  notes = updated?.notes ?? [];
  hidden = updated?.hidden ?? false;
  render();
  notifyPanel();
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (supported && window.top === window) {
  void loadPage();
  watchUrl();
  window.addEventListener('resize', () => scheduleReposition());
  window.addEventListener('load', () => scheduleReposition(300));
  // Deliberately not a ResizeObserver on documentElement: our own notes are
  // absolutely positioned and can nudge the document's own scroll size,
  // which would make an observer on that element re-fire on itself. A slow
  // poll gets the same "track late layout drift" benefit without the loop.
  window.setInterval(() => scheduleReposition(50), 3000);
}
