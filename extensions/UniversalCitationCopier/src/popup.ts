/**
 * Popup — a live preview of all five formats before anything is copied.
 *
 * Loading / error / success are the three states this screen can be in
 * (there's no "empty" state distinct from success: even a page with no
 * metadata at all still produces a full set of citations, via the fallback
 * chains in citation.ts — that's the point of them).
 *
 * The popup has its own document, so it writes to the clipboard directly via
 * `navigator.clipboard` — no offscreen document needed here, that machinery
 * exists only for the keyboard-shortcut path in background.ts.
 */

import { collectRawMeta } from './extract';
import {
  deriveMetadata,
  formatCitation,
  isSupportedPageUrl,
  FORMAT_IDS,
  FORMAT_LABELS,
  type FormatId,
  type PageMetadata,
} from './citation';
import { getLastUsedFormat, setLastUsedFormat } from './storage';

const loadingState = document.getElementById('loading-state') as HTMLElement;
const errorState = document.getElementById('error-state') as HTMLElement;
const errorMessage = document.getElementById('error-message') as HTMLElement;
const formatList = document.getElementById('format-list') as HTMLUListElement;
const pageSummary = document.getElementById('page-summary') as HTMLElement;
const hint = document.getElementById('hint') as HTMLElement;
const liveRegion = document.getElementById('live-region') as HTMLElement;

function announce(text: string): void {
  liveRegion.textContent = text;
}

function showError(message: string): void {
  loadingState.hidden = true;
  errorMessage.textContent = message;
  errorState.hidden = false;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function buildRow(id: FormatId, meta: PageMetadata, isDefault: boolean): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'format-row' + (isDefault ? ' format-row--default' : '');
  li.dataset.formatId = id;

  const top = document.createElement('div');
  top.className = 'format-row__top';

  const label = document.createElement('span');
  label.className = 'format-row__label';
  label.textContent = FORMAT_LABELS[id];
  if (isDefault) {
    const chip = document.createElement('span');
    chip.className = 'format-row__default-chip';
    chip.textContent = 'Shortcut';
    label.appendChild(chip);
  }
  top.appendChild(label);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'format-row__copy';
  button.textContent = 'Copy';
  button.setAttribute('aria-label', `Copy as ${FORMAT_LABELS[id]}`);
  top.appendChild(button);

  li.appendChild(top);

  const preview = document.createElement('p');
  preview.className = 'format-row__preview';
  const text = formatCitation(id, meta);
  preview.textContent = text;
  preview.title = text; // full text on hover/focus, since the row truncates
  li.appendChild(preview);

  button.addEventListener('click', () => {
    void handleCopy(id, text, button);
  });

  return li;
}

async function handleCopy(id: FormatId, text: string, button: HTMLButtonElement): Promise<void> {
  try {
    await copyText(text);
    await setLastUsedFormat(id);
    button.dataset.copied = 'true';
    button.textContent = 'Copied';
    announce(`Copied as ${FORMAT_LABELS[id]}.`);
    markDefaultRow(id);
    setTimeout(() => {
      button.textContent = 'Copy';
      delete button.dataset.copied;
    }, 1200);
  } catch {
    announce('Could not copy to the clipboard. Try again.');
  }
}

function markDefaultRow(id: FormatId): void {
  for (const row of formatList.querySelectorAll<HTMLLIElement>('.format-row')) {
    const isDefault = row.dataset.formatId === id;
    row.classList.toggle('format-row--default', isDefault);
    const chip = row.querySelector('.format-row__default-chip');
    if (isDefault && !chip) {
      const label = row.querySelector('.format-row__label');
      const newChip = document.createElement('span');
      newChip.className = 'format-row__default-chip';
      newChip.textContent = 'Shortcut';
      label?.appendChild(newChip);
    } else if (!isDefault && chip) {
      chip.remove();
    }
  }
}

async function init(): Promise<void> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!isSupportedPageUrl(tab?.url)) {
    showError("Can't read this page. Open the popup on a regular web page (not a browser settings or extensions page) and try again.");
    return;
  }

  let meta: PageMetadata;
  try {
    const [{ result: raw } = { result: undefined }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id as number },
      func: collectRawMeta,
    });
    if (!raw) throw new Error('empty result');
    meta = deriveMetadata(raw);
  } catch {
    showError("Couldn't read this page's content. Reload the page and try again.");
    return;
  }

  pageSummary.textContent = `${meta.title} — ${meta.siteName}`;

  const lastUsed = await getLastUsedFormat();

  loadingState.hidden = true;
  formatList.hidden = false;
  hint.hidden = false;
  for (const id of FORMAT_IDS) {
    formatList.appendChild(buildRow(id, meta, id === lastUsed));
  }
}

void init();
