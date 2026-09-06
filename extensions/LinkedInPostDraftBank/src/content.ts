/**
 * Runs on linkedin.com. Three jobs:
 *   1. while a post composer is open, show a floating overlay with a live
 *      character count and the "see more" cutoff marker (PRD §4)
 *   2. silently keep one extension-owned autosave draft per composer session,
 *      clearly separate from LinkedIn's own autosave (PRD §7)
 *   3. on the user's own activity feed, archive their own published posts
 *      (PRD §4 — never any other user's posts, see isOwnActivityPage)
 *
 * All UI lives inside one shadow root marked `data-pdb-ui`, so the host
 * page's CSS cannot reach it. The only DOM write against LinkedIn's own page
 * anywhere in this file is inserting the user's own saved text into an
 * editor they opened (insertTemplateText) — never a click, never a submit.
 * Nothing here makes a network request.
 */

import {
  composerHasMedia,
  extractPost,
  findComposerEditor,
  findPosts,
  insertTemplateText,
  isOwnActivityPage,
  readComposerText,
} from './linkedin-dom';
import { track } from './metrics';
import { deleteItem, findPublishedByUrn, newId, readItem, writeItem } from './storage';
import { analyzeTruncation, truncationSummary } from './truncation';
import { ComposerState, Device, LibraryItem, PanelToContent } from './types';
import { parseTags } from './search';

function isLinkedIn(): boolean {
  return /(^|\.)linkedin\.com$/i.test(location.hostname);
}

function currentDevice(): Device {
  return location.hostname.startsWith('m.') ? 'mobile' : 'desktop';
}

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'PDB_LIBRARY_CHANGED' }).catch(() => undefined);
}

/* ── Overlay (shadow DOM) ────────────────────────────────────────────── */

const UI_ATTR = 'data-pdb-ui';
let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = OVERLAY_CSS;
  shadow.appendChild(style);
  return shadow;
}

const OVERLAY_CSS = `
  .card {
    position: fixed;
    display: none;
    box-sizing: border-box;
    width: 260px;
    background: #ffffff;
    color: #0f0f0f;
    border: 1px solid rgba(0,0,0,.14);
    border-radius: 10px;
    box-shadow: 0 6px 24px rgba(0,0,0,.22);
    padding: 10px 12px;
    font: 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .card--open { display: block; }
  .count { font-weight: 600; margin: 0 0 4px; }
  .bar { height: 6px; border-radius: 3px; background: #e8e8e8; overflow: hidden; margin-bottom: 4px; }
  .bar__fill { height: 100%; background: #0a66c2; }
  .bar__fill--over { background: #c0392b; }
  .note { margin: 0 0 8px; color: #5f6368; }
  .note--warn { color: #a05a00; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn {
    border: 1px solid #0a66c2; background: #ffffff; color: #0a66c2; border-radius: 12px;
    padding: 4px 10px; font: inherit; font-weight: 600; cursor: pointer;
  }
  .btn:hover { background: #eaf3fc; }
  .tagrow { display: none; gap: 6px; margin-top: 6px; }
  .tagrow--open { display: flex; }
  .taginput {
    flex: 1; border: 1px solid rgba(0,0,0,.18); border-radius: 6px; padding: 4px 6px; font: inherit;
  }
  .status { margin-top: 6px; color: #1a7f37; }
`;

let card: HTMLDivElement | null = null;
let countEl: HTMLParagraphElement | null = null;
let barFillEl: HTMLDivElement | null = null;
let noteEl: HTMLParagraphElement | null = null;
let tagRowEl: HTMLDivElement | null = null;
let tagInputEl: HTMLInputElement | null = null;
let statusEl: HTMLParagraphElement | null = null;

function buildOverlay(): HTMLDivElement {
  const root = ui();
  const el = document.createElement('div');
  el.className = 'card';

  countEl = document.createElement('p');
  countEl.className = 'count';

  const bar = document.createElement('div');
  bar.className = 'bar';
  barFillEl = document.createElement('div');
  barFillEl.className = 'bar__fill';
  bar.appendChild(barFillEl);

  noteEl = document.createElement('p');
  noteEl.className = 'note';

  const row = document.createElement('div');
  row.className = 'row';

  const saveDraftBtn = document.createElement('button');
  saveDraftBtn.type = 'button';
  saveDraftBtn.className = 'btn';
  saveDraftBtn.textContent = 'Save draft';
  saveDraftBtn.addEventListener('click', () => void confirmDraft());

  const saveTemplateBtn = document.createElement('button');
  saveTemplateBtn.type = 'button';
  saveTemplateBtn.className = 'btn';
  saveTemplateBtn.textContent = 'Save as template';
  saveTemplateBtn.addEventListener('click', () => {
    tagRowEl?.classList.toggle('tagrow--open');
    tagInputEl?.focus();
  });

  row.append(saveDraftBtn, saveTemplateBtn);

  tagRowEl = document.createElement('div');
  tagRowEl.className = 'tagrow';
  tagInputEl = document.createElement('input');
  tagInputEl.className = 'taginput';
  tagInputEl.type = 'text';
  tagInputEl.placeholder = 'Tags (comma separated)';
  const confirmTemplateBtn = document.createElement('button');
  confirmTemplateBtn.type = 'button';
  confirmTemplateBtn.className = 'btn';
  confirmTemplateBtn.textContent = 'Save';
  confirmTemplateBtn.addEventListener('click', () => void saveAsTemplate());
  tagRowEl.append(tagInputEl, confirmTemplateBtn);

  statusEl = document.createElement('p');
  statusEl.className = 'status';

  el.append(countEl, bar, noteEl, row, tagRowEl, statusEl);
  root.appendChild(el);
  return el;
}

function showStatus(message: string): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  window.setTimeout(() => {
    if (statusEl) statusEl.textContent = '';
  }, 2200);
}

function positionOverlay(rect: DOMRect): void {
  if (!card) return;
  card.classList.add('card--open');
  const width = card.offsetWidth || 260;
  const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
  const top = Math.min(rect.top, window.innerHeight - (card.offsetHeight || 140) - 8);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(Math.max(8, top))}px`;
}

function hideOverlay(): void {
  card?.classList.remove('card--open');
}

/* ── Composer session state ─────────────────────────────────────────── */

let activeEditor: HTMLElement | null = null;
const sessionDraftIds = new WeakMap<HTMLElement, string>();
const wiredEditors = new WeakSet<HTMLElement>();
let autosaveTimer: number | undefined;

function currentText(): string {
  return activeEditor ? readComposerText(activeEditor) : '';
}

async function scheduleAutosave(editor: HTMLElement, text: string): Promise<void> {
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => void persistAutosave(editor, text), 1200);
}

async function persistAutosave(editor: HTMLElement, text: string): Promise<void> {
  const existingId = sessionDraftIds.get(editor);

  if (!text.trim()) {
    if (existingId) {
      await deleteItem(existingId);
      sessionDraftIds.delete(editor);
      notifyPanel();
    }
    return;
  }

  const now = Date.now();
  const id = existingId ?? newId();
  const existing = existingId ? await readItem(existingId) : null;
  const item: LibraryItem = existing
    ? { ...existing, text, updatedAt: now }
    : { id, kind: 'draft', text, tags: [], createdAt: now, updatedAt: now, autosaved: true };

  sessionDraftIds.set(editor, id);
  await writeItem(item);
  void track('draft_autosaved');
  notifyPanel();
}

async function confirmDraft(): Promise<void> {
  if (!activeEditor) return;
  const text = currentText();
  if (!text.trim()) {
    showStatus('Nothing to save yet.');
    return;
  }
  await persistAutosave(activeEditor, text);
  const id = sessionDraftIds.get(activeEditor);
  if (id) {
    const existing = await readItem(id);
    if (existing) await writeItem({ ...existing, autosaved: false });
  }
  void track('draft_saved');
  notifyPanel();
  showStatus('Draft saved.');
}

async function saveAsTemplate(): Promise<void> {
  if (!activeEditor) return;
  const text = currentText();
  if (!text.trim()) {
    showStatus('Nothing to save yet.');
    return;
  }
  const tags = parseTags(tagInputEl?.value ?? '');
  const now = Date.now();
  await writeItem({ id: newId(), kind: 'template', text, tags, createdAt: now, updatedAt: now });
  void track('template_saved');
  notifyPanel();
  if (tagInputEl) tagInputEl.value = '';
  tagRowEl?.classList.remove('tagrow--open');
  showStatus('Template saved.');
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function renderOverlay(editor: HTMLElement): void {
  if (!card) card = buildOverlay();

  const text = readComposerText(editor);
  const hasMedia = composerHasMedia(editor);
  const result = analyzeTruncation(text, currentDevice());

  if (countEl) countEl.textContent = `${result.charCount} characters`;
  if (barFillEl) {
    const pct = Math.min(100, Math.round((result.charCount / result.charBudget) * 100));
    barFillEl.style.width = `${pct}%`;
    barFillEl.className = `bar__fill${result.truncated ? ' bar__fill--over' : ''}`;
  }
  if (noteEl) {
    const lines = [truncationSummary(result)];
    if (hasMedia) lines.push('An attached image/document/poll changes this estimate — treat it as less reliable.');
    noteEl.textContent = lines.join(' ');
    noteEl.className = `note${hasMedia ? ' note--warn' : ''}`;
  }

  positionOverlay(editor.getBoundingClientRect());
  void scheduleAutosave(editor, text);
}

function wireEditor(editor: HTMLElement): void {
  if (wiredEditors.has(editor)) return;
  wiredEditors.add(editor);
  editor.addEventListener('input', () => {
    if (activeEditor === editor) renderOverlay(editor);
  });
}

/* ── Scan loop ───────────────────────────────────────────────────────── */

async function archiveOwnPosts(): Promise<void> {
  for (const post of findPosts(document)) {
    const extracted = extractPost(post);
    if (!extracted || !extracted.text.trim()) continue;

    const existing = await findPublishedByUrn(extracted.postUrn);
    const now = Date.now();

    if (!existing) {
      await writeItem({
        id: newId(),
        kind: 'published',
        text: extracted.text,
        tags: [],
        createdAt: now,
        updatedAt: now,
        postUrn: extracted.postUrn,
        postUrl: extracted.postUrl,
        publishedAtLabel: extracted.publishedAtLabel,
      });
      void track('published_archived');
      notifyPanel();
    } else if (existing.text !== extracted.text) {
      // The user edited a post that's already live — update the archive in
      // place rather than adding a near-duplicate (PRD §7).
      await writeItem({ ...existing, text: extracted.text, updatedAt: now });
      void track('published_updated');
      notifyPanel();
    }
  }
}

function scan(): void {
  const editor = findComposerEditor();

  if (editor) {
    wireEditor(editor);
    if (editor !== activeEditor) void track('overlay_shown');
    activeEditor = editor;
    renderOverlay(editor);
  } else if (activeEditor) {
    // Composer just closed — flush whatever was there one last time.
    void persistAutosave(activeEditor, readComposerText(activeEditor));
    activeEditor = null;
    hideOverlay();
  }

  if (isOwnActivityPage()) void archiveOwnPosts();
}

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, delay);
}

/* ── Panel messaging ─────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PanelToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'PDB_GET_COMPOSER_STATE': {
      const state: ComposerState = {
        open: Boolean(activeEditor),
        text: currentText(),
        hasMedia: activeEditor ? composerHasMedia(activeEditor) : false,
      };
      sendResponse(state);
      return false;
    }
    case 'PDB_INSERT_TEMPLATE': {
      if (!activeEditor) {
        sendResponse({ ok: false, error: 'No post composer is open on this page right now.' });
        return false;
      }
      insertTemplateText(activeEditor, message.text);
      void track('template_inserted');
      renderOverlay(activeEditor);
      sendResponse({ ok: true });
      return false;
    }
    default:
      return false;
  }
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (isLinkedIn() && window.top === window) {
  scheduleScan(300);
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('scroll', () => activeEditor && positionOverlay(activeEditor.getBoundingClientRect()), {
    passive: true,
  });
  window.addEventListener('resize', () => activeEditor && positionOverlay(activeEditor.getBoundingClientRect()));
  window.addEventListener('load', () => scheduleScan(500));
}
