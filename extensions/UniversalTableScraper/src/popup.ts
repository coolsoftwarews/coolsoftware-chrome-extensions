/**
 * The popup: check the active tab, then hand off to the content script.
 *
 * All the real UI — hover highlighting, the preview grid, export buttons —
 * lives in the content script's on-page overlay, not here. MV3 popups close
 * the instant the user clicks anywhere on the page, so a popup cannot itself
 * stay open through a "hover the page, then click something" flow; this popup
 * exists only to start that flow and then get out of the way.
 */

import { clearMetrics, readMetrics } from './metrics';
import { PopupToContent } from './types';
import { isSupportedUrl } from './url';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  state: $('state'),
  controls: $('controls'),
  pick: $<HTMLButtonElement>('pick'),
  status: $('status'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  stats: $<HTMLDialogElement>('stats'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

function showState(message: string): void {
  els.state.hidden = false;
  els.controls.hidden = true;
  els.state.replaceChildren();
  const text = document.createElement('p');
  text.className = 'state__text';
  text.textContent = message;
  els.state.append(text);
}

function showControls(): void {
  els.state.hidden = true;
  els.controls.hidden = false;
}

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function init(): Promise<void> {
  const tab = await activeTab();

  if (!tab?.id || !isSupportedUrl(tab.url)) {
    showState(
      'Open a normal web page to use this. Browser pages, the extensions gallery and PDFs are off limits to every extension.'
    );
    return;
  }

  const message: PopupToContent = { type: 'UTS_PING' };
  let alive = false;
  try {
    const response = (await chrome.tabs.sendMessage(tab.id, message)) as { ok: boolean } | undefined;
    alive = Boolean(response?.ok);
  } catch {
    alive = false;
  }

  if (!alive) {
    showState('This tab was open before the extension was installed or updated. Reload it and try again.');
    return;
  }

  showControls();
  els.pick.addEventListener('click', () => {
    void chrome.tabs
      .sendMessage(tab.id as number, { type: 'UTS_START_PICK' } as PopupToContent)
      .then(() => window.close())
      .catch(() => {
        els.status.textContent = 'Could not start picking mode on this page.';
      });
  });
}

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.length > 2 ? lines.join('\n') : 'No usage yet.';
  els.stats.showModal();
}

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

void init();
