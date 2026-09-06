/** Screen Capture — popup. Three buttons, a progress bar, one error line. */

import { Msg, type CaptureMode } from '../shared/messages';
import { blockedReason } from '../shared/constants';

const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.mode'));
const progress = document.getElementById('progress') as HTMLDivElement;
const progressFill = document.getElementById('progress-fill') as HTMLDivElement;
const progressLabel = document.getElementById('progress-label') as HTMLParagraphElement;
const errorLine = document.getElementById('error') as HTMLParagraphElement;

const MODES: Record<string, CaptureMode> = {
  'full-page': 'fullPage',
  'visible-area': 'visibleArea',
  'selected-region': 'selectedRegion',
};

for (const button of buttons) {
  button.addEventListener('click', () => start(MODES[button.id]));
}

/**
 * Say "not here" before the click, not after it.
 *
 * `blockedReason` already knew which pages can never be captured, but only the
 * failure path consulted it — so a browser page offered three live-looking
 * buttons and answered all of them with a red line. Asking on open turns a
 * failure into a fact.
 */
async function checkPage(): Promise<void> {
  const gate = document.getElementById('gate') as HTMLDivElement;
  const gateBody = document.getElementById('gate-body') as HTMLParagraphElement;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const reason = blockedReason(tab?.url);
  if (!reason) return;

  gateBody.textContent = reason;
  gate.hidden = false;
  for (const button of buttons) button.hidden = true;
}

void checkPage();

function start(mode: CaptureMode): void {
  errorLine.hidden = true;
  setBusy(true);

  // Region select needs the popup out of the way to leave the page focusable.
  if (mode === 'selectedRegion') {
    chrome.runtime.sendMessage({ action: Msg.START_CAPTURE, mode }).catch(() => undefined);
    window.close();
    return;
  }

  progressLabel.textContent = mode === 'fullPage' ? 'Measuring page…' : 'Capturing…';
  chrome.runtime
    .sendMessage({ action: Msg.START_CAPTURE, mode })
    .then((response: { ok: boolean; error?: string } | undefined) => {
      if (response && !response.ok) fail(response.error ?? 'Capture failed.');
      else window.close();
    })
    .catch((error: Error) => fail(error.message));
}

chrome.runtime.onMessage.addListener((message: { action: string; current?: number; total?: number; error?: string }) => {
  if (message.action === Msg.CAPTURE_PROGRESS && message.total) {
    const percent = Math.round((message.current! / message.total) * 100);
    progressFill.style.width = `${percent}%`;
    progressLabel.textContent = `Capturing… ${message.current}/${message.total}`;
  }
  if (message.action === Msg.CAPTURE_FAILED) fail(message.error ?? 'Capture failed.');
});

function setBusy(busy: boolean): void {
  for (const button of buttons) button.disabled = busy;
  progress.hidden = !busy;
  if (busy) progressFill.style.width = '0%';
}

function fail(message: string): void {
  setBusy(false);
  errorLine.textContent = message;
  errorLine.hidden = false;
}
