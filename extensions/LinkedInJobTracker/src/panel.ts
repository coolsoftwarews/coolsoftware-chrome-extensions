/**
 * The side panel: every tracked job, independent of whatever tab is active.
 * There is one writer (chrome.storage.local) and the panel simply reflects
 * it, refreshing on chrome.storage.onChanged so a track made from the
 * content script — or a passive stale flag it sets — shows up here
 * immediately without polling (PRD §6: foreground only).
 *
 * The kanban is rendered as stacked stage sections rather than side-by-side
 * columns: a Chrome side panel is a few hundred pixels wide, and six
 * horizontal columns would either be unreadable or force horizontal
 * scrolling inside an already-narrow surface. Stacked sections with a
 * per-card stage dropdown give the same "move a job between stages" job to
 * be done without fighting the panel's own width.
 */

import { daysSince } from './capture';
import { buildExportFilename, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import { changeNote, changeStage, clearAllData, deleteJob, exportBackup, importBackup, quotaStatus, readAllJobs } from './storage';
import { STAGES, Stage, TrackedJob } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  loading: $('loading'),
  state: $('state'),
  stages: $('stages'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataClose: $<HTMLButtonElement>('data-close'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  exportJson: $<HTMLButtonElement>('export-json'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let jobs: TrackedJob[] = [];
let hasLoadedOnce = false;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(title: string, body: string): void {
  els.stages.hidden = true;
  els.state.hidden = false;
  els.state.replaceChildren();

  const icon = document.createElement('img');
  icon.className = 'state__icon';
  icon.src = chrome.runtime.getURL('icons/icon-128.png');
  icon.alt = '';
  icon.width = 44;
  icon.height = 44;

  const heading = document.createElement('strong');
  heading.className = 'state__title';
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'state__body';
  text.textContent = body;

  els.state.append(icon, heading, text);
}

/* ── Loading + fetching ──────────────────────────────────────────────── */

async function load(): Promise<void> {
  // Only show the loading skeleton on the very first read — a refresh
  // triggered by chrome.storage.onChanged should update in place, never
  // flash the panel back to a blank/loading state.
  if (!hasLoadedOnce) {
    els.loading.hidden = false;
    els.state.hidden = true;
    els.stages.hidden = true;
  }

  jobs = await readAllJobs();
  hasLoadedOnce = true;

  els.loading.hidden = true;
  render();

  const quota = await quotaStatus();
  if (quota.warn) {
    const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
    setStatus(`Local storage ${mb} MB — over 80% full. Export from “Data” before it fills up.`);
  }
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function daysSinceLabel(job: TrackedJob): string {
  const days = daysSince(job.lastActivityAt, Date.now());
  if (days === 0) return 'Updated today';
  if (days === 1) return 'Updated 1 day ago';
  return `Updated ${days} days ago`;
}

function buildCardItem(job: TrackedJob): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'card-item' + (job.stale ? ' card-item--stale' : '');

  const head = document.createElement('div');
  head.className = 'card-item__head';

  const title = document.createElement('a');
  title.className = 'card-item__title';
  title.href = job.jobUrl;
  title.target = '_blank';
  title.rel = 'noopener noreferrer';
  title.textContent = job.title || 'Untitled role';
  title.addEventListener('click', () => void track('panel_opened'));
  head.appendChild(title);

  if (job.company) {
    const company = document.createElement('span');
    company.className = 'card-item__company';
    company.textContent = `· ${job.company}`;
    head.appendChild(company);
  }

  if (job.stale) {
    const badge = document.createElement('span');
    badge.className = 'card-item__badge';
    badge.textContent = 'Closed';
    head.appendChild(badge);
  }
  li.appendChild(head);

  const metaParts = [job.location, job.salaryRaw, job.postedDateRaw ? `Posted ${job.postedDateRaw}` : ''].filter(Boolean);
  if (metaParts.length) {
    const meta = document.createElement('p');
    meta.className = 'card-item__meta';
    meta.textContent = metaParts.join(' · ');
    li.appendChild(meta);
  }

  const activity = document.createElement('p');
  activity.className = 'card-item__meta';
  activity.textContent = daysSinceLabel(job);
  li.appendChild(activity);

  const note = document.createElement('textarea');
  note.className = 'card-item__note';
  note.rows = 1;
  note.placeholder = 'Note…';
  note.value = job.note;
  note.setAttribute('aria-label', `Note on ${job.title || 'this job'}`);
  note.addEventListener('blur', () => {
    if (note.value === job.note) return;
    void changeNote(job.id, note.value).then(() => {
      void track('note_saved');
      void load();
    });
  });
  li.appendChild(note);

  const row = document.createElement('div');
  row.className = 'card-item__row';

  const select = document.createElement('select');
  select.className = 'card-item__select';
  select.setAttribute('aria-label', `Move ${job.title || 'this job'} to a different stage`);
  for (const stage of STAGES) {
    const option = document.createElement('option');
    option.value = stage.id;
    option.textContent = stage.label;
    option.selected = stage.id === job.stage;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    void changeStage(job.id, select.value as Stage).then(() => {
      void track('stage_changed');
      void load();
    });
  });
  row.appendChild(select);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'link-btn';
  del.textContent = 'Delete';
  del.style.marginLeft = 'auto';
  del.addEventListener('click', () => {
    if (!confirm(`Remove "${job.title || 'this job'}" from your tracker?`)) return;
    void deleteJob(job.id).then(() => {
      void track('job_deleted');
      void load();
    });
  });
  row.appendChild(del);

  li.appendChild(row);
  return li;
}

function render(): void {
  els.summary.textContent = jobs.length ? `${jobs.length} tracked job${jobs.length === 1 ? '' : 's'}` : '';

  if (!jobs.length) {
    showState('Nothing tracked yet', 'Open a job posting on LinkedIn and click “+ Track this job”.');
    return;
  }

  els.state.hidden = true;
  els.stages.hidden = false;
  els.stages.replaceChildren();

  const byStage = new Map<Stage, TrackedJob[]>();
  for (const job of jobs) {
    const list = byStage.get(job.stage) ?? [];
    list.push(job);
    byStage.set(job.stage, list);
  }

  for (const stage of STAGES) {
    const list = (byStage.get(stage.id) ?? []).sort((a, b) => b.lastActivityAt - a.lastActivityAt);

    const section = document.createElement('section');
    section.className = 'stage';

    const header = document.createElement('div');
    header.className = 'stage__header';

    const name = document.createElement('span');
    name.className = 'stage__name';
    name.textContent = stage.label;
    header.appendChild(name);

    const count = document.createElement('span');
    count.className = 'stage__count';
    count.textContent = String(list.length);
    header.appendChild(count);

    section.appendChild(header);

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'stage__empty';
      empty.textContent = 'Nothing here yet.';
      section.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'cards';
      for (const job of list) ul.appendChild(buildCardItem(job));
      section.appendChild(ul);
    }

    els.stages.appendChild(section);
  }
}

/* ── Export / import / clear ───────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportCsv(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(new Blob([toCsv(backup.jobs)], { type: 'text/csv;charset=utf-8' }), buildExportFilename('csv'));
    setStatus(`Exported ${backup.jobs.length} job${backup.jobs.length === 1 ? '' : 's'} as CSV`);
    void track('export_csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the CSV file.');
  }
}

async function exportMd(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(new Blob([toMarkdown(backup.jobs)], { type: 'text/markdown;charset=utf-8' }), buildExportFilename('md'));
    setStatus(`Exported ${backup.jobs.length} job${backup.jobs.length === 1 ? '' : 's'} as Markdown`);
    void track('export_md');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the Markdown file.');
  }
}

async function exportJson(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }), buildExportFilename('json'));
    setStatus(`Exported ${backup.jobs.length} job${backup.jobs.length === 1 ? '' : 's'} as a full backup`);
    void track('export_json');
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.jobs} job${result.jobs === 1 ? '' : 's'}`);
    void track('data_imported');
    await load();
  } catch (error: any) {
    // Never surface a raw parse error — plain language only.
    setStatus(error?.message || 'That file could not be read. Make sure it is a Job Tracker backup.');
  }
}

/* ── Usage counters ─────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ─────────────────────────────────────────────────────────── */

els.dataToggle.addEventListener('click', async () => {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and remove a few jobs.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
});
els.dataClose.addEventListener('click', () => els.data.close());
els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportMd.addEventListener('click', () => void exportMd());
els.exportJson.addEventListener('click', () => void exportJson());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every tracked job? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void load();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

// The content script's tracks land straight in storage; reflect them live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some(key => key.startsWith('ljt:job:'))) {
    void load();
  }
});

void (async () => {
  void track('panel_opened');
  await load();
})();
