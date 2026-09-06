/**
 * Runs on reddit.com and old.reddit.com. Job:
 *   1. show a "+ Save quote" control when the user selects text inside a
 *      single comment or post (PRD §4)
 *   2. capture the quote, its context and citation metadata, and save it
 *   3. confirm the save and offer one-click theme assignment (PRD §4)
 *
 * Unlike a persistent highlighter, nothing here is re-anchored on reload —
 * this product captures once and gets out of the way. All UI lives in a
 * shadow root so Reddit's own CSS can never reach it and this extension's
 * text never ends up inside a saved quote. Nothing here makes a network
 * request — see PRIVACY.md.
 */

import { extractCapture, findCaptureRoot } from './reddit-extract';
import { track } from './metrics';
import { readOptions, saveQuote, setQuoteTheme } from './storage';
import { DEFAULT_THEMES } from './types';
import { isSupportedUrl } from './url';

const UI_ATTR = 'data-rvoc-ui';
const supported = isSupportedUrl(location.href);

/* ── UI shell (shadow DOM) ───────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  // Fixed, zero-size and out of flow: the host page's layout never moves
  // (PRD §6: no layout shift).
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

const SHADOW_CSS = `
  .pop {
    position: fixed; display: none; box-sizing: border-box;
    background: #0a4a43; color: #fff; border-radius: 999px;
    box-shadow: 0 6px 20px rgba(0,0,0,.28); padding: 4px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .pop--open { display: block; }
  .save-btn {
    border: none; background: none; color: #fff; cursor: pointer;
    padding: 6px 12px; border-radius: 999px; font: inherit; font-weight: 600;
    white-space: nowrap;
  }
  .save-btn:hover { background: rgba(255,255,255,.16); }
  .save-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    background: #14161a; color: #fff; padding: 10px 14px; border-radius: 12px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    opacity: 0; pointer-events: none; transition: opacity .18s ease;
    max-width: min(320px, 80vw); text-align: center;
  }
  .toast--on { opacity: .96; pointer-events: auto; }
  .toast__msg { margin: 0; }
  .toast__themes { display: flex; flex-wrap: wrap; gap: 4px; justify-content: center; }
  .chip {
    border: 1px solid rgba(255,255,255,.35); background: none; color: #fff;
    border-radius: 999px; padding: 3px 9px; font: inherit; font-size: 12px; cursor: pointer;
  }
  .chip:hover { background: rgba(255,255,255,.14); }
  .chip:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

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

/* ── Selection → "+ Save quote" control ─────────────────────────────── */

let savePop: HTMLDivElement | null = null;
let pendingRange: Range | null = null;

function hideSaveControl(): void {
  savePop?.classList.remove('pop--open');
  pendingRange = null;
}

function showSaveControl(range: Range): void {
  if (!savePop) {
    savePop = document.createElement('div');
    savePop.className = 'pop';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'save-btn';
    button.textContent = '+ Save quote';
    button.setAttribute('aria-label', 'Save this quote to your Reddit research');
    // Keep the selection alive through the mousedown that precedes the click.
    button.addEventListener('mousedown', event => event.preventDefault());
    button.addEventListener('click', () => void handleSave());
    savePop.appendChild(button);
    ui().appendChild(savePop);
  }
  pendingRange = range;
  positionAt(savePop, range.getBoundingClientRect());
}

/* ── Confirmation toast + one-click theme assignment ──────────────────── */

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

function showToast(message: string, offerThemes: boolean): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    ui().appendChild(toastEl);
  }
  toastEl.replaceChildren();

  const text = document.createElement('p');
  text.className = 'toast__msg';
  text.textContent = message;
  toastEl.appendChild(text);

  if (offerThemes) {
    const row = document.createElement('div');
    row.className = 'toast__themes';
    for (const theme of DEFAULT_THEMES) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.textContent = theme.name;
      chip.addEventListener('click', () => void assignLastTheme(theme.id, theme.name));
      row.appendChild(chip);
    }
    toastEl.appendChild(row);
  }

  toastEl.classList.add('toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('toast--on'), offerThemes ? 4200 : 1800);
}

let lastSavedId: string | null = null;

async function assignLastTheme(themeId: string, themeName: string): Promise<void> {
  if (!lastSavedId) return;
  await setQuoteTheme(lastSavedId, themeId);
  void track('theme_assigned');
  showToast(`Saved to ${themeName}`, false);
}

/* ── Save flow ───────────────────────────────────────────────────────── */

async function handleSave(): Promise<void> {
  const range = pendingRange;
  hideSaveControl();
  if (!range) return;

  const text = range.toString().trim();
  if (!text) return;

  const root = findCaptureRoot(range);
  if (!root) {
    showToast('Select text within a single comment or post.', false);
    return;
  }

  const capture = extractCapture(root);
  if (!capture) {
    showToast('Couldn’t read this comment — try selecting again.', false);
    return;
  }

  const options = await readOptions();
  const outcome = await saveQuote({
    quote: text,
    context: capture.contextText,
    author: options.anonymizeByDefault ? '' : capture.author,
    anonymized: options.anonymizeByDefault,
    subreddit: capture.subreddit,
    threadTitle: capture.threadTitle,
    threadUrl: capture.threadUrl,
    permalink: capture.permalink,
    score: capture.score,
    postedAt: capture.postedAt,
  });

  window.getSelection()?.removeAllRanges();
  lastSavedId = outcome.quote.id;

  if (outcome.status === 'duplicate') {
    showToast('Already saved — kept the longer version.', false);
    void track('quote_duplicate');
    return;
  }

  void track(outcome.status === 'replaced' ? 'quote_replaced' : 'quote_saved');
  showToast(outcome.status === 'replaced' ? 'Updated the saved quote — add a theme?' : 'Quote saved — add a theme?', true);
}

/* ── Selection tracking ──────────────────────────────────────────────── */

document.addEventListener('selectionchange', () => {
  if (!supported) return;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) {
    hideSaveControl();
    return;
  }
  const range = selection.getRangeAt(0);
  if (!range.toString().trim()) {
    hideSaveControl();
    return;
  }
  const target = range.commonAncestorContainer as HTMLElement;
  const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  // Ignore selections inside inputs and editable regions — the user is writing.
  if (element?.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) {
    hideSaveControl();
    return;
  }
  if (element?.closest(`[${UI_ATTR}]`)) return;
  // No sensible single comment/post to attribute this to (PRD §7: a selection
  // spanning multiple comments must be refused clearly, not guessed at).
  if (!findCaptureRoot(range)) {
    hideSaveControl();
    return;
  }
  showSaveControl(range);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideSaveControl();
});

window.addEventListener('scroll', () => hideSaveControl(), { passive: true });
