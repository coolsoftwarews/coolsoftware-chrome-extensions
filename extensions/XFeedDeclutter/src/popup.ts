/**
 * The action popup: the five toggles, a live "N of 5 active" count, and the
 * data-ownership surface this product actually owes the user (PRD §6: no
 * `downloads` permission, so "your data" here is reset-to-defaults and
 * reset-counters — not an export file, since five booleans and two counters
 * aren't meaningfully exportable content). Reads and writes
 * chrome.storage.local directly; content.ts picks up any change via
 * chrome.storage.onChanged, so there is no messaging in this file at all.
 */

import { activeToggleCount, changedToggles } from './rules';
import { clearMetrics, clearToggles, readMetrics, readToggles, trackPopupOpened, trackToggleFlip, writeToggles } from './storage';
import { Metrics, TOGGLE_COPY, TOGGLE_ORDER, ToggleKey, ToggleState } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  toggleList: $<HTMLUListElement>('toggle-list'),
  activeCount: $('active-count'),
  resetDefaults: $<HTMLButtonElement>('reset-defaults'),
  dataStatus: $('data-status'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
};

let current: ToggleState | null = null;

function renderToggleCount(toggles: ToggleState): void {
  const count = activeToggleCount(toggles);
  els.activeCount.textContent = `${count} of ${TOGGLE_ORDER.length} active`;
}

function buildRow(key: ToggleKey, toggles: ToggleState): HTMLLIElement {
  const copy = TOGGLE_COPY[key];
  const li = document.createElement('li');
  li.className = 'toggle-row';

  const label = document.createElement('label');
  const labelText = document.createElement('span');
  labelText.className = 'toggle-label';
  labelText.textContent = copy.label;
  const helpText = document.createElement('span');
  helpText.className = 'toggle-help';
  helpText.textContent = copy.help;
  label.append(labelText, helpText);

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.className = 'switch';
  input.checked = toggles[key];
  input.setAttribute('aria-label', copy.label);
  input.addEventListener('change', () => void onToggle(key, input.checked));

  li.append(input, label);
  return li;
}

async function onToggle(key: ToggleKey, enabled: boolean): Promise<void> {
  if (!current) return;
  const before = current;
  const after: ToggleState = { ...before, [key]: enabled };
  current = after;
  await writeToggles(after);
  renderToggleCount(after);

  for (const change of changedToggles(before, after)) {
    void trackToggleFlip(change.key, change.enabled);
  }
}

function setDataStatus(message: string): void {
  els.dataStatus.textContent = message;
  window.setTimeout(() => {
    if (els.dataStatus.textContent === message) els.dataStatus.textContent = '';
  }, 4000);
}

async function renderMetrics(): Promise<void> {
  const metrics: Metrics = await readMetrics();
  const lines: string[] = [];
  lines.push(`sessions: ${metrics.sessionCount}`);
  lines.push(`popup opened: ${metrics.popupOpenCount}`);
  lines.push('');
  lines.push('toggle on/off, ever:');
  for (const key of TOGGLE_ORDER) {
    lines.push(`  ${key}: ${metrics.toggleOnCount[key] ?? 0} on / ${metrics.toggleOffCount[key] ?? 0} off`);
  }
  els.statsBody.textContent = lines.join('\n');
}

async function init(): Promise<void> {
  current = await readToggles();
  els.toggleList.replaceChildren(...TOGGLE_ORDER.map(key => buildRow(key, current as ToggleState)));
  renderToggleCount(current);
  await renderMetrics();
}

els.resetDefaults.addEventListener('click', async () => {
  await clearToggles();
  current = await readToggles(); // falls back to DEFAULT_TOGGLES now that the key is gone
  els.toggleList.replaceChildren(...TOGGLE_ORDER.map(key => buildRow(key, current as ToggleState)));
  renderToggleCount(current);
  setDataStatus('Reset to defaults.');
});

els.statsClear.addEventListener('click', async () => {
  await clearMetrics();
  await renderMetrics();
});

void trackPopupOpened();
void init();
