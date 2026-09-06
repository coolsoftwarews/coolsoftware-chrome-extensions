/**
 * Runs on linkedin.com. Three jobs, and nothing else:
 *
 *   1. Show a "+ Track this job" floating button whenever a single job
 *      posting's details are on screen — the permalink page or the detail
 *      pane inside search/collections results (PRD §4).
 *   2. On click, scrape whatever LinkedIn has rendered, capture it, and
 *      persist it — with an inline stage picker and note field in the
 *      confirmation card, so moving a freshly-tracked job past "Saved"
 *      doesn't require opening the panel.
 *   3. Passively notice when an *already-tracked* posting is no longer
 *      accepting applications and mark it stale (PRD §7) — this only reads
 *      the current tab's already-rendered DOM, never fetches anything.
 *
 * Nothing here ever mutates LinkedIn's own DOM — every button and card is a
 * floating overlay inside one shadow root (`data-ljt-ui`), positioned from
 * `getBoundingClientRect()`, never inserted into LinkedIn's own React tree.
 * There is no code path anywhere in this file (or this extension) that
 * clicks Apply, submits a form, posts, connects or messages — see
 * PRIVACY.md's "What this extension will never do".
 */

import { buildCapture, jobIdFromUrl } from './capture';
import { track } from './metrics';
import { isClosedPosting, isJobishUrl, jobDetailRoot, scrapeJob } from './scrape';
import { markStale, readJob, saveJob } from './storage';
import { STAGES, Stage, TrackedJob } from './types';

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute('data-ljt-ui', '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

const SHADOW_CSS = `
  .fab {
    position: fixed;
    right: 24px;
    bottom: 24px;
    display: none;
    align-items: center;
    gap: 6px;
    background: #0a66c2;
    color: #fff;
    border: none;
    border-radius: 999px;
    padding: 10px 16px;
    font: 600 13px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(0,0,0,.35);
    z-index: 2147483647;
  }
  .fab--show { display: flex; }
  .fab:hover { background: #084a91; }
  .fab.on { background: #057642; }
  .fab.on:hover { background: #045c34; }
  .fab.stale { background: #915907; }
  .fab.stale:hover { background: #744706; }
  .card {
    position: fixed;
    display: none;
    box-sizing: border-box;
    width: 270px;
    right: 24px;
    bottom: 74px;
    background: #ffffff;
    color: #0f0f0f;
    border: 1px solid rgba(0,0,0,.14);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.28);
    padding: 12px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .card--show { display: block; }
  .card__title { margin: 0 0 8px; font-weight: 700; }
  .card select, .card textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(0,0,0,.18);
    border-radius: 6px;
    padding: 6px 8px;
    font: inherit;
    margin-bottom: 8px;
    color: #0f0f0f;
    background: #fff;
  }
  .card textarea { resize: vertical; min-height: 46px; }
  .card__row { display: flex; gap: 6px; justify-content: flex-end; }
  .card__btn {
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 6px;
    padding: 5px 10px;
    font: 600 12px/1 inherit;
    color: #0a66c2;
  }
  .card__btn:hover { background: rgba(10,102,194,.1); }
  @media (prefers-reduced-motion: no-preference) {
    .fab, .card { transition: opacity .12s ease; }
  }
`;

/* ── Floating "+ Track this job" button ─────────────────────────────── */

let fab: HTMLButtonElement | null = null;

function ensureFab(): HTMLButtonElement {
  if (fab) return fab;
  fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.addEventListener('click', () => void handleFabClick());
  ui().appendChild(fab);
  return fab;
}

function paintFab(job: TrackedJob | null): void {
  const el = ensureFab();
  el.classList.add('fab--show');
  el.classList.toggle('on', !!job && !job.stale);
  el.classList.toggle('stale', !!job?.stale);
  if (!job) {
    el.textContent = '+ Track this job';
  } else if (job.stale) {
    el.textContent = '⚠ Closed · Update';
  } else {
    const label = STAGES.find(s => s.id === job.stage)?.label ?? job.stage;
    el.textContent = `Tracked ✓ · ${label}`;
  }
}

function hideFab(): void {
  fab?.classList.remove('fab--show');
}

/* ── Confirmation / edit card ────────────────────────────────────────── */

let card: HTMLDivElement | null = null;

function buildCard(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'card';
  ui().appendChild(el);
  return el;
}

function closeCard(): void {
  card?.classList.remove('card--show');
}

function showCard(job: TrackedJob): void {
  if (!card) card = buildCard();
  card.replaceChildren();

  const title = document.createElement('p');
  title.className = 'card__title';
  title.textContent = job.stale ? `${job.title || 'This job'} — no longer accepting applications` : `Tracking: ${job.title || 'this job'}`;
  card.appendChild(title);

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Move to stage');
  for (const stage of STAGES) {
    const option = document.createElement('option');
    option.value = stage.id;
    option.textContent = stage.label;
    option.selected = stage.id === job.stage;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    const stage = select.value as Stage;
    void saveJob(job.id, existing => ({ ...(existing ?? job), stage, lastActivityAt: Date.now() })).then(updated => {
      void track('stage_changed');
      paintFab(updated);
    });
  });
  card.appendChild(select);

  const note = document.createElement('textarea');
  note.placeholder = 'Note (optional) — interview date, contact name…';
  note.setAttribute('aria-label', 'Note on this job');
  note.value = job.note;
  note.addEventListener('blur', () => {
    if (note.value === job.note) return;
    void saveJob(job.id, existing => ({ ...(existing ?? job), note: note.value, lastActivityAt: Date.now() })).then(() => {
      void track('note_saved');
    });
  });
  card.appendChild(note);

  const row = document.createElement('div');
  row.className = 'card__row';

  const panelBtn = document.createElement('button');
  panelBtn.type = 'button';
  panelBtn.className = 'card__btn';
  panelBtn.textContent = 'Open tracker';
  panelBtn.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'LJT_OPEN_PANEL' }).catch(() => undefined);
    closeCard();
  });
  row.appendChild(panelBtn);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'card__btn';
  done.textContent = 'Done';
  done.addEventListener('click', closeCard);
  row.appendChild(done);

  card.appendChild(row);
  card.classList.add('card--show');
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeCard();
});

/* ── Tracking / passive stale detection ─────────────────────────────── */

let currentJobId: string | null = null;
let currentTrackedJob: TrackedJob | null = null;

async function refreshCurrentJobState(): Promise<void> {
  const id = jobIdFromUrl(location.href);
  currentJobId = id;
  if (!id) {
    hideFab();
    currentTrackedJob = null;
    return;
  }

  currentTrackedJob = await readJob(id);
  paintFab(currentTrackedJob);

  // Passive stale check (PRD §7): only for a job the user has already
  // tracked — never writes anything for a posting nobody asked to follow.
  if (currentTrackedJob) {
    const root = jobDetailRoot();
    const closed = isClosedPosting(root);
    if (closed !== currentTrackedJob.stale) {
      const updated = await markStale(id, closed);
      if (updated) {
        currentTrackedJob = updated;
        paintFab(updated);
        if (closed) void track('stale_detected');
      }
    }
  }
}

async function handleFabClick(): Promise<void> {
  void track('track_button_clicked');
  const id = currentJobId ?? jobIdFromUrl(location.href);
  if (!id) return;

  const root = jobDetailRoot();
  const raw = scrapeJob(root, location.href);
  const existedBefore = currentTrackedJob !== null;

  const job = await saveJob(id, existing => buildCapture(raw, existing, Date.now()));
  currentTrackedJob = job;
  void track(existedBefore ? 'job_tracked_updated' : 'job_tracked_created');
  paintFab(job);
  showCard(job);
}

/* ── SPA navigation / late content ──────────────────────────────────── */

let scanTimer: number | undefined;
function scheduleScan(delay = 400): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void refreshCurrentJobState(), delay);
}

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    closeCard();
    scheduleScan(300);
  }, 500);
}

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(mutation => mutation.addedNodes.length > 0);
  if (relevant && isJobishUrl(location.href)) scheduleScan();
});

/* ── Boot ────────────────────────────────────────────────────────────── */

// Keeps the fab/card in sync when a job is edited from the panel.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !currentJobId) return;
  const key = `ljt:job:${currentJobId}`;
  if (!(key in changes)) return;
  currentTrackedJob = (changes[key].newValue as TrackedJob | undefined) ?? null;
  paintFab(currentTrackedJob);
});

if (window.top === window && /\.linkedin\.com$/.test(location.hostname)) {
  void refreshCurrentJobState();
  observer.observe(document.body, { childList: true, subtree: true });
  watchNavigation();
}
