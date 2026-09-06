import { clearMetrics, readMetrics } from '../lib/storage';

/** Human labels for the §8 counters. Keys absent from here are not surfaced. */
const LABELS: Record<string, string> = {
  'search.filtered': 'Filtered searches',
  'filter.date': 'Date filter used',
  'filter.views': 'Views filter used',
  'filter.vpd': 'Views/day filter used',
  'filter.subs': 'Subscriber filter used',
  'filter.duration': 'Duration filter used',
  'filter.kind': 'Shorts/live filter used',
  'sort.changed': 'Sort changed',
  'preset.used': 'Preset used',
  'filters.cleared': 'Filters cleared',
  'search.emptyResult': 'Empty results',
  'enrich.ok': 'Channels resolved',
  'enrich.fail': 'Channel lookups failed',
  'selectors.miss': 'Layout parse errors',
};

async function render(): Promise<void> {
  const list = document.getElementById('metrics');
  if (!list) return;

  const counters = await readMetrics();
  list.replaceChildren();

  const entries = Object.entries(LABELS).filter(([key]) => counters[key]);
  if (entries.length === 0) {
    const empty = document.createElement('dt');
    empty.textContent = 'Nothing recorded yet.';
    list.append(empty);
    return;
  }

  for (const [key, label] of entries) {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    value.textContent = String(counters[key]);
    list.append(term, value);
  }
}

document.getElementById('reset')?.addEventListener('click', () => {
  void clearMetrics().then(render);
});

/**
 * Say where this works, when it cannot work here.
 *
 * `tab.url` is only populated for hosts we hold permission over, so anything
 * else reads as "not YouTube" without needing the `tabs` permission — the same
 * property the other extensions in the set rely on.
 */
async function checkPage(): Promise<void> {
  const gate = document.getElementById('gate');
  const intro = document.getElementById('intro');
  if (!gate || !intro) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (/^https?:\/\/([^/]+\.)?youtube\.com\//.test(tab?.url ?? '')) return;

  gate.hidden = false;
  intro.hidden = true;
}

document.getElementById('open-youtube')?.addEventListener('click', () => {
  void chrome.tabs.create({ url: 'https://www.youtube.com/' });
});

void checkPage();
void render();
