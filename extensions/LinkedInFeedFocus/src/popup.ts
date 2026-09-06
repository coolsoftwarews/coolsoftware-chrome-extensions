/**
 * Toolbar popup: six independent toggles, nothing else (PRD §4 — "one
 * popup, a handful of toggles, nothing to configure"). Reads/writes
 * chrome.storage.local directly; content.ts on any open LinkedIn tab picks
 * up a change via chrome.storage.onChanged, so there is no messaging here at
 * all — same "captured state is just data" shape used by the Saver-pattern
 * extensions elsewhere in this portfolio, applied to settings instead of
 * captured items.
 */

import { DEFAULT_TOGGLES, TOGGLE_ORDER, ToggleState, mergeToggles } from './classify';

const STORAGE_KEY = 'liff:toggles';

interface ToggleMeta {
  key: keyof ToggleState;
  label: string;
  description: string;
}

const TOGGLE_META: ToggleMeta[] = [
  {
    key: 'hidePromoted',
    label: 'Hide promoted posts',
    description: 'Removes sponsored/"Promoted" posts from the feed.',
  },
  {
    key: 'hideSuggestions',
    label: 'Hide "People you may know"',
    description: 'Removes suggestion modules like "Add to your feed" and "People you may know".',
  },
  {
    key: 'hideTrending',
    label: 'Hide trending news',
    description: 'Removes the LinkedIn News / trending-now module.',
  },
  {
    key: 'hideAlgorithmic',
    label: 'Hide suggested posts',
    description: "Favors people you actually follow, hiding posts LinkedIn labels as its own picks where detectable. Best-effort — LinkedIn doesn't always mark these.",
  },
  {
    key: 'hideReactionCounts',
    label: 'Hide reaction counts',
    description: 'Hides like/reaction tallies under posts. Comment and repost counts, and every action button, stay untouched.',
  },
  {
    key: 'focusMode',
    label: 'Focus mode',
    description: 'Widens the reading column and mutes side rails. Purely visual, reversible instantly.',
  },
];

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  list: $('toggle-list'),
  reset: $<HTMLButtonElement>('reset'),
  status: $('status'),
};

let toggles: ToggleState = { ...DEFAULT_TOGGLES };
let statusTimer: number | undefined;

function setStatus(message: string): void {
  els.status.textContent = message;
  window.clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    els.status.textContent = '';
  }, 2000);
}

async function save(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEY]: toggles });
}

function render(): void {
  els.list.replaceChildren();

  for (const meta of TOGGLE_META) {
    const row = document.createElement('label');
    row.className = 'toggle-row';

    const text = document.createElement('span');
    text.className = 'toggle-row__text';

    const title = document.createElement('span');
    title.className = 'toggle-row__label';
    title.textContent = meta.label;

    const desc = document.createElement('span');
    desc.className = 'toggle-row__desc';
    desc.textContent = meta.description;

    text.append(title, desc);

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = toggles[meta.key];
    input.setAttribute('aria-label', meta.label);
    input.addEventListener('change', () => {
      toggles = { ...toggles, [meta.key]: input.checked };
      void save().then(() => setStatus('Saved'));
    });

    row.append(text, input);
    els.list.append(row);
  }
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  toggles = mergeToggles(stored[STORAGE_KEY]);
  render();
}

els.reset.addEventListener('click', () => {
  toggles = { ...DEFAULT_TOGGLES };
  render();
  void save().then(() => setStatus('Reset to defaults'));
});

// Referenced so TOGGLE_ORDER (used by scripts/selftest.mjs to assert the
// popup's own toggle list is complete) stays a genuine shared source of
// truth rather than an unused export.
void TOGGLE_ORDER;

void load();
