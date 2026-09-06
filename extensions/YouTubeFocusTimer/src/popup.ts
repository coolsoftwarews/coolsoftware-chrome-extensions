/**
 * Popup dashboard. An extension page, so — unlike content.ts — it can call
 * chrome.downloads directly; no background relay needed for exports here
 * (see the portfolio-wide "chrome.downloads is not available in content
 * scripts" note, which doesn't apply to popups/panels).
 */
import { sumDays } from './aggregate';
import { buildFilename, buildSessionCsv } from './csv';
import {
  bumpMetric,
  clearAllData,
  clearMetrics,
  exportBackup,
  importBackup,
  quotaStatus,
  readMetrics,
  readSettings,
  readTotals,
  writeSettings,
} from './storage';
import { dateKeyLocal, formatDuration, lastNDateKeys, shortWeekday } from './time';
import type { DailyTotals, Settings } from './types';

const LABELS: Record<string, string> = {
  'toggle.recommendations': 'Recommendations toggle used',
  'toggle.homeFeed': 'Homepage feed toggle used',
  'toggle.shorts': 'Shorts toggle used',
  'toggle.endScreen': 'End-screen toggle used',
  'toggle.comments': 'Comments toggle used',
  'reminder.shown': 'Reminders shown',
  'reminder.dismissed': 'Reminders dismissed',
  'export.csv': 'CSV exports',
  'export.backup': 'Backups exported',
  'import.backup': 'Backups imported',
  'data.cleared': 'Data cleared',
  'dashboard.opened': 'Dashboard opened',
};

function $<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

function setStatus(message: string): void {
  $<HTMLElement>('status').textContent = message;
}

/* ── Dashboard: totals + chart ──────────────────────────────────────── */

async function renderDashboard(): Promise<void> {
  const totals = await readTotals();
  const now = Date.now();
  const todayKey = dateKeyLocal(now);
  const weekKeys = lastNDateKeys(now, 7);

  $<HTMLElement>('today-total').textContent = formatDuration(totals[todayKey] ?? 0);
  $<HTMLElement>('week-total').textContent = formatDuration(sumDays(totals, weekKeys));

  renderChart(totals, weekKeys, todayKey);
}

function renderChart(totals: DailyTotals, weekKeys: string[], todayKey: string): void {
  const chart = $<HTMLElement>('chart');
  chart.replaceChildren();

  const maxMs = Math.max(60_000, ...weekKeys.map((key) => totals[key] ?? 0));
  for (const key of weekKeys) {
    const ms = totals[key] ?? 0;
    const heightPct = Math.max(2, Math.round((ms / maxMs) * 100));

    const bar = document.createElement('div');
    bar.className = 'chart__bar';

    const fill = document.createElement('div');
    fill.className = key === todayKey ? 'chart__fill chart__fill--today' : 'chart__fill';
    fill.style.height = `${heightPct}%`;
    fill.title = `${key}: ${formatDuration(ms)}`;

    const day = document.createElement('span');
    day.className = 'chart__day';
    day.textContent = shortWeekday(new Date(key + 'T00:00:00').getTime());

    bar.append(fill, day);
    chart.append(bar);
  }
}

/* ── Toggles + reminder select ──────────────────────────────────────── */

const TOGGLE_IDS: Record<keyof Omit<Settings, 'reminderMinutes'>, string> = {
  hideRecommendations: 'toggle-recommendations',
  hideHomeFeed: 'toggle-home',
  hideShorts: 'toggle-shorts',
  hideEndScreen: 'toggle-endscreen',
  hideComments: 'toggle-comments',
};

const METRIC_FOR_TOGGLE: Record<string, string> = {
  hideRecommendations: 'toggle.recommendations',
  hideHomeFeed: 'toggle.homeFeed',
  hideShorts: 'toggle.shorts',
  hideEndScreen: 'toggle.endScreen',
  hideComments: 'toggle.comments',
};

async function renderControls(): Promise<void> {
  const settings = await readSettings();

  (Object.keys(TOGGLE_IDS) as Array<keyof typeof TOGGLE_IDS>).forEach((key) => {
    const input = $<HTMLInputElement>(TOGGLE_IDS[key]);
    input.checked = settings[key];
    input.addEventListener('change', () => void onToggleChange(key, input.checked));
  });

  const select = $<HTMLSelectElement>('reminder-select');
  select.value = String(settings.reminderMinutes ?? 0);
  select.addEventListener('change', () => void onReminderChange(Number(select.value)));
}

async function onToggleChange(key: keyof typeof TOGGLE_IDS, checked: boolean): Promise<void> {
  const settings = await readSettings();
  const next = { ...settings, [key]: checked };
  await writeSettings(next);
  void bumpMetric(METRIC_FOR_TOGGLE[key]);
}

async function onReminderChange(minutes: number): Promise<void> {
  const settings = await readSettings();
  const next: Settings = { ...settings, reminderMinutes: minutes > 0 ? minutes : null };
  await writeSettings(next);
}

/* ── Data sheet: CSV export, JSON backup export/import, clear all ──── */

function download(filename: string, mimeType: string, content: string): void {
  const url = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  chrome.downloads.download({ url, filename, saveAs: false });
}

async function exportCsv(): Promise<void> {
  const totals = await readTotals();
  const days = lastNDateKeys(Date.now(), 90);
  const csv = buildSessionCsv(totals, days);
  download(buildFilename('youtube-focus-timer-sessions', 'csv'), 'text/csv', csv);
  void bumpMetric('export.csv');
  setStatus('CSV exported.');
}

async function exportJson(): Promise<void> {
  const backup = await exportBackup();
  download(buildFilename('youtube-focus-timer-backup', 'json'), 'application/json', JSON.stringify(backup, null, 2));
  void bumpMetric('export.backup');
  setStatus('Backup exported.');
}

async function importJson(file: File): Promise<void> {
  try {
    const text = await file.text();
    const { days } = await importBackup(JSON.parse(text));
    void bumpMetric('import.backup');
    setStatus(`Imported ${days} day(s).`);
    await renderDashboard();
    await renderControls();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : 'Import failed — is that the right file?');
  }
}

async function clearData(): Promise<void> {
  await clearAllData();
  void bumpMetric('data.cleared');
  setStatus('All data cleared.');
  await renderDashboard();
  await renderControls();
}

async function renderQuota(): Promise<void> {
  const status = await quotaStatus();
  const kb = Math.round(status.bytes / 1024);
  $<HTMLElement>('quota').textContent = status.warn
    ? `Using ${kb} KB of local storage (getting full — export a backup).`
    : `Using ${kb} KB of local storage.`;
}

/* ── Usage sheet ─────────────────────────────────────────────────────── */

async function renderMetrics(): Promise<void> {
  const list = $<HTMLElement>('metrics');
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

/* ── Wiring ──────────────────────────────────────────────────────────── */

function wireDialogs(): void {
  const dataDialog = $<HTMLDialogElement>('data');
  const statsDialog = $<HTMLDialogElement>('stats');

  $<HTMLButtonElement>('data-toggle').addEventListener('click', () => {
    void renderQuota();
    dataDialog.showModal();
  });
  $<HTMLButtonElement>('data-close').addEventListener('click', () => dataDialog.close());

  $<HTMLButtonElement>('stats-toggle').addEventListener('click', () => {
    void renderMetrics();
    statsDialog.showModal();
  });
  $<HTMLButtonElement>('stats-close').addEventListener('click', () => statsDialog.close());
  $<HTMLButtonElement>('stats-clear').addEventListener('click', () => {
    void clearMetrics().then(renderMetrics);
  });

  $<HTMLButtonElement>('export-csv').addEventListener('click', () => void exportCsv());
  $<HTMLButtonElement>('data-export').addEventListener('click', () => void exportJson());

  const fileInput = $<HTMLInputElement>('import-file');
  $<HTMLButtonElement>('data-import').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) void importJson(file);
  });

  $<HTMLButtonElement>('data-clear').addEventListener('click', () => {
    if (confirm('Clear all YouTube Focus Timer data on this device? This cannot be undone.')) {
      void clearData();
    }
  });
}

async function init(): Promise<void> {
  wireDialogs();
  await Promise.all([renderDashboard(), renderControls()]);
  void bumpMetric('dashboard.opened');
}

void init();
