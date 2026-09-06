/**
 * Runs on linkedin.com. Two jobs, and nothing else:
 *
 *   1. On any personal profile page, show a "+ Note" control near the name
 *      that opens a small local note editor, and show a "last noted: 3 days
 *      ago" indicator when a note already exists (PRD §4).
 *   2. Never write anything back to LinkedIn. There is no code path here that
 *      posts, likes, follows, connects or messages — see PRIVACY.md.
 *
 * Unlike this product's two LinkedIn siblings, nothing here reads a post,
 * a comment, or an engagement count — only the profile's own displayed name,
 * headline and URL, exactly as rendered (PRD §5). LinkedIn's DOM changes
 * often and is not documented, so every extraction step degrades to "show
 * the control without a label" rather than throwing (PRD §7).
 */

import { track } from './metrics';
import { findFuzzyMatch, getNote, mergeNoteInto, upsertNote } from './storage';
import { ProfileNote } from './types';
import { formatRelativeTime, normalizeProfileUrl, truncateText } from './text';
import { STARTER_TAGS } from './types';

const DONE_ATTR = 'data-lpn-profile-done';

function isProfilePage(): boolean {
  return /^\/in\/[^/]+\/?$/.test(location.pathname);
}

function firstMatch(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector<HTMLElement>(selector);
      if (el) return el;
    } catch {
      /* an invalid selector on an old LinkedIn build should not break the rest */
    }
  }
  return null;
}

/* ── The control ─────────────────────────────────────────────────────── */

const PANEL_CSS = `
  :host { all: initial; }
  .wrap {
    display: block;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    margin: 8px 0;
  }
  button {
    font: 500 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    border: 1px solid rgba(214,110,51,.55);
    background: #fff;
    color: #b3541f;
    border-radius: 12px;
    padding: 3px 11px;
    cursor: pointer;
  }
  button:hover { background: rgba(214,110,51,.08); }
  button.on { background: #b3541f; color: #fff; }
  button.on:hover { background: #9a4718; }
  .panel {
    margin-top: 8px;
    padding: 10px;
    border: 1px solid #e2d9cf;
    border-radius: 8px;
    background: #fffaf3;
    max-width: 420px;
  }
  .panel[hidden] { display: none; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    min-height: 54px;
    border: 1px solid #d8cabb;
    border-radius: 6px;
    padding: 6px 8px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #2b2318;
    background: #fff;
  }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
  input[type="text"] {
    flex: 1;
    min-width: 120px;
    border: 1px solid #d8cabb;
    border-radius: 6px;
    padding: 5px 8px;
    font: 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    background: #fff;
    color: #2b2318;
  }
  .status {
    font-size: 11px;
    color: #8a7860;
  }
  .fuzzy {
    margin-top: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    background: #fdeee0;
    color: #6b4423;
    font-size: 12px;
  }
  .fuzzy button {
    margin-top: 6px;
    border-color: rgba(107,68,35,.4);
    color: #6b4423;
  }
`;

interface ControlState {
  id: string;
  note: ProfileNote | null;
}

/**
 * One global storage listener dispatches to whichever control is currently on
 * the page, instead of each visited profile's control registering its own
 * listener — LinkedIn is a client-side-routed SPA, so this content script
 * instance persists across many profile visits in one session, and a
 * per-control listener would otherwise accumulate for as long as the tab is
 * open.
 */
const activeRefreshers = new Map<string, () => void>();
chrome.storage.onChanged.addListener(changes => {
  for (const key of Object.keys(changes)) {
    if (!key.startsWith('lpn:note:')) continue;
    const id = key.slice('lpn:note:'.length);
    activeRefreshers.get(id)?.();
  }
});

function buildLabel(note: ProfileNote | null): string {
  if (!note || !note.text.trim()) return '+ Note';
  return `Edit note · last noted: ${formatRelativeTime(note.lastNotedAt)}`;
}

async function createControl(id: string, name: string, headline: string, avatarUrl: string): Promise<HTMLElement> {
  const host = document.createElement('div');
  host.setAttribute('data-lpn-control', id);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = PANEL_CSS;

  const wrap = document.createElement('div');
  wrap.className = 'wrap';

  const button = document.createElement('button');
  button.type = 'button';

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;

  const textarea = document.createElement('textarea');
  textarea.placeholder = 'Why does this person matter to you? e.g. met at conf, discussing a senior PM role…';

  const tagInput = document.createElement('input');
  tagInput.type = 'text';
  tagInput.placeholder = 'tag, e.g. follow up';
  tagInput.setAttribute('list', 'lpn-tags');
  const tagList = document.createElement('datalist');
  tagList.id = 'lpn-tags';
  for (const tag of STARTER_TAGS) {
    const option = document.createElement('option');
    option.value = tag;
    tagList.append(option);
  }

  const status = document.createElement('span');
  status.className = 'status';

  const row = document.createElement('div');
  row.className = 'row';
  row.append(tagInput, status);

  const fuzzyBox = document.createElement('div');
  fuzzyBox.className = 'fuzzy';
  fuzzyBox.hidden = true;

  panel.append(textarea, row, fuzzyBox, tagList);
  wrap.append(button, panel);
  shadow.append(style, wrap);

  const state: ControlState = { id, note: null };

  async function refreshFromStorage(): Promise<void> {
    state.note = await getNote(id);
    button.textContent = buildLabel(state.note);
    button.classList.toggle('on', Boolean(state.note && state.note.text.trim()));
    if (document.activeElement !== textarea) textarea.value = state.note?.text ?? '';
    if (document.activeElement !== tagInput) tagInput.value = state.note?.tag ?? '';
  }

  let saveTimer: number | undefined;
  async function save(): Promise<void> {
    window.clearTimeout(saveTimer);
    const text = textarea.value;
    const tag = tagInput.value.trim();
    if (!text.trim() && !tag) return; // nothing to save yet
    state.note = await upsertNote({ id, name, headline, avatarUrl, text, tag });
    button.textContent = buildLabel(state.note);
    button.classList.add('on');
    status.textContent = 'Saved';
    void track('note_saved');
    window.setTimeout(() => {
      if (status.textContent === 'Saved') status.textContent = '';
    }, 2000);
  }

  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void save(), 600);
  }

  textarea.addEventListener('input', scheduleSave);
  textarea.addEventListener('blur', () => void save());
  tagInput.addEventListener('input', scheduleSave);
  tagInput.addEventListener('blur', () => void save());

  async function maybeShowFuzzyMatch(): Promise<void> {
    if (state.note) {
      fuzzyBox.hidden = true;
      return;
    }
    const match = await findFuzzyMatch(id, name, headline);
    if (!match) {
      fuzzyBox.hidden = true;
      return;
    }
    void track('fuzzy_match_suggested');
    fuzzyBox.replaceChildren();
    const text = document.createElement('div');
    text.textContent = `This looks like ${match.name || 'someone'} you already noted under a different URL. Bring that note here?`;
    const mergeButton = document.createElement('button');
    mergeButton.type = 'button';
    mergeButton.textContent = 'Merge that note here';
    mergeButton.addEventListener('click', async () => {
      await mergeNoteInto(match.id, id);
      void track('fuzzy_match_accepted');
      fuzzyBox.hidden = true;
      await refreshFromStorage();
    });
    fuzzyBox.append(text, mergeButton);
    fuzzyBox.hidden = false;
  }

  button.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      void maybeShowFuzzyMatch();
      textarea.focus();
    }
  });

  activeRefreshers.set(id, () => void refreshFromStorage());

  await refreshFromStorage();
  return host;
}

async function injectProfileControl(): Promise<void> {
  if (!isProfilePage()) return;
  const heading = document.querySelector('h1');
  if (!heading || heading.hasAttribute(DONE_ATTR)) return;

  const id = normalizeProfileUrl(location.href);
  const name = truncateText(heading.textContent || '', 120);
  if (!name) return;

  heading.setAttribute(DONE_ATTR, '1');
  const headlineEl = firstMatch(document.body, ['.text-body-medium.break-words', '[class*="top-card"] .text-body-medium']);
  const avatarEl = document.querySelector<HTMLImageElement>('img[class*="profile-photo"], img[class*="EntityPhoto"]');
  const headline = truncateText(headlineEl?.textContent || '', 160);

  try {
    const host = await createControl(id, name, headline, avatarEl?.src ?? '');
    heading.insertAdjacentElement('afterend', host);
  } catch {
    // Extraction/render must never throw and take the rest of the page with it (PRD §7).
  }
}

/* ── Boot + SPA navigation ──────────────────────────────────────────── */

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void injectProfileControl(), delay);
}

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    document.querySelectorAll(`[${DONE_ATTR}]`).forEach(el => el.removeAttribute(DONE_ATTR));
    scheduleScan(300);
  }, 700);
}

if (window.top === window && /\.linkedin\.com$/.test(location.hostname)) {
  scheduleScan(300);
  const observer = new MutationObserver(mutations => {
    if (isProfilePage() && !document.querySelector(`h1[${DONE_ATTR}]`) && mutations.length) {
      scheduleScan();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  watchNavigation();
}
