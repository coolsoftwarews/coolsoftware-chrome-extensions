/**
 * Runs on linkedin.com. Its only job is the on-page control from PRD §4:
 *
 *   Collect commenters (34 visible)
 *
 * One control per post with a visible comment thread. Clicking it reads the
 * comments currently rendered — nothing is scrolled, expanded or fetched on
 * the user's behalf (README: read-only, foreground-only). Results are merged
 * straight into chrome.storage.local and the panel is told to refresh.
 */

import {
  declaredCommentTotal,
  extractComment,
  findCommentItems,
  findCommentsContainer,
  findPosts,
  postLabel,
  postPermalink,
} from './linkedin-dom';
import { track } from './metrics';
import { MAX_CAPTURES_PER_COLLECTION, mergeCaptures } from './storage';
import { RawCapture } from './types';

const INJECTED_ATTR = 'data-llf-injected';
const BUTTON_STYLE =
  'display:inline-flex;align-items:center;gap:6px;margin:8px 0;padding:6px 12px;' +
  'border:1px solid #0a66c2;border-radius:16px;background:#ffffff;color:#0a66c2;' +
  'font:600 13px/1.3 -apple-system,"Segoe UI",Roboto,sans-serif;cursor:pointer;';
const WRAP_STYLE = 'display:block;margin:4px 0;';
const STATUS_STYLE = 'margin-left:8px;font:400 12px/1.3 -apple-system,"Segoe UI",Roboto,sans-serif;color:#5f6368;';

function countVisible(post: HTMLElement): number {
  const container = findCommentsContainer(post);
  return container ? findCommentItems(container).length : 0;
}

function buildControl(post: HTMLElement): void {
  const container = findCommentsContainer(post);
  if (!container || container.parentElement === null) return;

  const wrap = document.createElement('div');
  wrap.setAttribute(INJECTED_ATTR, '');
  wrap.style.cssText = WRAP_STYLE;

  const button = document.createElement('button');
  button.type = 'button';
  button.style.cssText = BUTTON_STYLE;

  const status = document.createElement('span');
  status.style.cssText = STATUS_STYLE;

  const setLabel = () => {
    const visible = countVisible(post);
    button.textContent = `Collect commenters (${visible} visible)`;
    button.disabled = visible === 0;
    button.style.opacity = visible === 0 ? '0.6' : '1';
  };

  button.addEventListener('click', () => void runCollection(post, button, status, setLabel));

  wrap.appendChild(button);
  wrap.appendChild(status);
  container.parentElement.insertBefore(wrap, container);
  setLabel();

  // Comments load in as the user scrolls or a reply thread expands; keep the
  // count honest without polling the network — this only watches the DOM.
  const observer = new MutationObserver(() => setLabel());
  observer.observe(container, { childList: true, subtree: true });
}

async function runCollection(
  post: HTMLElement,
  button: HTMLButtonElement,
  status: HTMLSpanElement,
  setLabel: () => void,
): Promise<void> {
  void track('collect_clicked');
  const container = findCommentsContainer(post);
  if (!container) return;

  button.disabled = true;
  status.textContent = 'Collecting…';

  try {
    const items = findCommentItems(container);
    const capped = items.length > MAX_CAPTURES_PER_COLLECTION;
    const toCollect = items.slice(0, MAX_CAPTURES_PER_COLLECTION);

    const url = postPermalink(post);
    const label = postLabel(post);
    const raws: RawCapture[] = toCollect.map(item => extractComment(item, url, label));

    const declared = declaredCommentTotal(post);
    const notYetLoaded = declared !== null && declared > items.length ? declared - items.length : 0;

    const result = await mergeCaptures(raws);
    void track('leads_collected', raws.length);

    const parts = [`Collected ${raws.length}`, `${result.newLeads} new`];
    if (result.updatedLeads) parts.push(`${result.updatedLeads} already saved`);
    if (capped) parts.push(`capped at ${MAX_CAPTURES_PER_COLLECTION}`);
    if (notYetLoaded) parts.push(`${notYetLoaded} not yet loaded — click "Load more comments" to see them`);
    status.textContent = parts.join(' · ');

    notifyPanel();
  } catch {
    status.textContent = 'Could not read this thread — LinkedIn may have changed its page layout.';
  } finally {
    button.disabled = false;
    setLabel();
  }
}

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'LLF_LEADS_CHANGED' }).catch(() => undefined);
}

function scan(): void {
  for (const post of findPosts(document)) {
    const container = findCommentsContainer(post);
    if (!container) continue;
    // Only inject once per post; re-scans happen constantly as the feed grows.
    if (container.parentElement?.querySelector(`[${INJECTED_ATTR}]`)) continue;
    try {
      buildControl(post);
    } catch {
      /* one broken post should never stop the rest of the feed from working */
    }
  }
}

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, delay);
}

function isLinkedIn(): boolean {
  return /(^|\.)linkedin\.com$/i.test(location.hostname);
}

if (isLinkedIn() && window.top === window) {
  scheduleScan(300);
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', () => scheduleScan(500));
}
