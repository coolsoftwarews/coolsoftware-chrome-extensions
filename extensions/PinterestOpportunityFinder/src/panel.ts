/**
 * The side panel: filters, the pin list, the keyword panel, and the data
 * ownership surface (export / import / clear).
 *
 * The panel owns no pin data of its own — the content script is the single
 * scanner and the panel asks it for the current snapshot whenever something
 * changes. Nothing here makes a network request.
 */

import { isPinterestUrl } from './domains';
import { applyFilters } from './filters';
import { buildFilename, toKeywordsCsv, toMarkdownReport, toPinsCsv } from './formatters';
import { computeDomainStats, computeFormatStats, computeKeywordStats, groupByImage } from './keywords';
import { clearMetrics, readMetrics, track } from './metrics';
import { formatRatio, formatSaveCount, outlierPins } from './outlier';
import { clearAllData, exportBackup, importBackup, quotaStatus, readFilters, writeFilters } from './storage';
import { DomainStat, Filters, FormatStats, KeywordStat, PinBadge, PinCard, QuerySnapshot } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  queryLine: $('query-line'),
  rescan: $<HTMLButtonElement>('rescan'),
  state: $('state'),
  body: $('body'),
  baselineLine: $('baseline-line'),
  fMinRatio: $<HTMLInputElement>('f-min-ratio'),
  fDomain: $<HTMLInputElement>('f-domain'),
  fOverlay: $<HTMLSelectElement>('f-overlay'),
  fLastN: $<HTMLInputElement>('f-last-n'),
  fClear: $<HTMLButtonElement>('f-clear'),
  tabPins: $<HTMLButtonElement>('tab-pins'),
  tabKeywords: $<HTMLButtonElement>('tab-keywords'),
  viewPins: $('view-pins'),
  viewKeywords: $('view-keywords'),
  pinList: $<HTMLOListElement>('pin-list'),
  keywordEmpty: $('keyword-empty'),
  keywordTable: $<HTMLTableElement>('keyword-table'),
  domainTable: $<HTMLTableElement>('domain-table'),
  formatBody: $('format-body'),
  status: $('status'),
  exportPins: $<HTMLButtonElement>('export-pins'),
  exportKeywords: $<HTMLButtonElement>('export-keywords'),
  exportReport: $<HTMLButtonElement>('export-report'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  data: $<HTMLDialogElement>('data'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let tabId: number | null = null;
let snapshot: QuerySnapshot | null = null;
let filters: Filters = { minRatio: null, domain: null, hasTextOverlay: null, lastN: null };
let activeTabName: 'pins' | 'keywords' = 'pins';

/** Recomputed on every render from the current snapshot + filters. */
let filteredPins: PinCard[] = [];
let keywords: KeywordStat[] = [];
let domains: DomainStat[] = [];
let formats: FormatStats = { aspectBands: [], textOverlay: [], sampleSize: 0 };

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(message: string): void {
  els.state.hidden = false;
  els.state.textContent = '';
  const p = document.createElement('p');
  p.className = 'state__text';
  p.textContent = message;
  els.state.appendChild(p);
  els.body.hidden = true;
}

function showBody(): void {
  els.state.hidden = true;
  els.body.hidden = false;
}

/* ── Talking to the content script ──────────────────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function ask<T>(message: unknown): Promise<T | null> {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as T;
  } catch {
    return null;
  }
}

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;

  if (!tab || !isPinterestUrl(tab.url)) {
    snapshot = null;
    els.queryLine.textContent = '';
    updateExportButtons();
    showState('Open Pinterest to get started. Run a search there and this panel lights up.');
    return;
  }

  const next = await ask<QuerySnapshot>({ type: 'POF_GET_SNAPSHOT' });
  if (!next) {
    snapshot = null;
    updateExportButtons();
    showState('This tab was open before the extension was installed or updated. Reload it to get started.');
    return;
  }

  snapshot = next;

  if (next.unsupported) {
    els.queryLine.textContent = '';
    updateExportButtons();
    showState(next.unsupported);
    return;
  }

  els.queryLine.textContent = next.query ? `"${next.query}" · ${next.pins.length} pins loaded` : `${next.pins.length} pins loaded`;
  showBody();
  render();
}

/* ── Filters ─────────────────────────────────────────────────────────── */

function readFilterInputs(): Filters {
  const minRatio = els.fMinRatio.value.trim() ? Number(els.fMinRatio.value) : null;
  const domain = els.fDomain.value.trim() || null;
  const overlay = els.fOverlay.value;
  const hasTextOverlay = overlay === '' ? null : overlay === 'true';
  const lastN = els.fLastN.value.trim() ? Math.max(1, Math.floor(Number(els.fLastN.value))) : null;
  return { minRatio: minRatio != null && Number.isFinite(minRatio) ? minRatio : null, domain, hasTextOverlay, lastN };
}

function applyFilterInputs(): void {
  els.fMinRatio.value = filters.minRatio != null ? String(filters.minRatio) : '';
  els.fDomain.value = filters.domain ?? '';
  els.fOverlay.value = filters.hasTextOverlay == null ? '' : String(filters.hasTextOverlay);
  els.fLastN.value = filters.lastN != null ? String(filters.lastN) : '';
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function badgeLabel(badge: PinBadge | undefined): { text: string; cls: string; title: string } {
  if (!badge) return { text: '', cls: '', title: '' };
  switch (badge.kind) {
    case 'ratio':
      return {
        text: `\u{1F525} ${formatRatio(badge.ratio ?? 0)}`,
        cls: 'item__badge--ratio',
        title: `vs. median of ${badge.sampleSize} pins with a visible save count`,
      };
    case 'rank':
      return {
        text: `#${(badge.rank ?? 0) + 1}`,
        cls: 'item__badge--rank',
        title: `Save counts unreliable for this search — showing result rank, never a save count`,
      };
    case 'promoted':
      return { text: 'Promoted', cls: 'item__badge--promoted', title: 'Excluded from the outlier median' };
    case 'idea-pin':
      return { text: 'Idea pin', cls: 'item__badge--idea-pin', title: 'Different surface, not compared to standard pins' };
    default:
      return { text: '—', cls: '', title: 'No engagement data detected' };
  }
}

function renderPinList(): void {
  els.pinList.replaceChildren();

  if (!filteredPins.length) {
    const li = document.createElement('li');
    li.className = 'muted small';
    li.textContent = snapshot?.pins.length
      ? 'No pins match the current filters.'
      : 'No pins detected yet — scroll the results or press re-scan.';
    els.pinList.appendChild(li);
    return;
  }

  const badges = snapshot?.badges ?? {};
  for (const pin of filteredPins) {
    const badge = badgeLabel(badges[pin.id]);
    const li = document.createElement('li');
    li.className = 'item';

    const row = document.createElement('div');
    row.className = 'item__row';
    const rank = document.createElement('span');
    rank.className = 'muted small';
    rank.textContent = `#${pin.rank + 1}`;
    const badgeSpan = document.createElement('span');
    badgeSpan.className = `item__badge ${badge.cls}`;
    badgeSpan.textContent = badge.text;
    badgeSpan.title = badge.title;
    row.append(rank, badgeSpan);

    const title = document.createElement('p');
    title.className = 'item__title';
    title.textContent = pin.title || '(untitled pin)';

    const meta = document.createElement('p');
    meta.className = 'item__meta';
    const metaParts = [
      pin.domain ?? '',
      pin.saveCount != null ? `${formatSaveCount(pin.saveCount)} saves` : '',
    ].filter(Boolean);
    meta.textContent = metaParts.join(' · ');

    const link = document.createElement('a');
    link.className = 'item__link small';
    link.href = pin.pinUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open pin';

    li.append(row, title, meta, link);
    els.pinList.appendChild(li);
  }
}

function renderKeywordTable(): void {
  els.keywordTable.replaceChildren();
  els.keywordEmpty.hidden = keywords.length > 0;
  if (!keywords.length) return;

  const thead = document.createElement('thead');
  thead.innerHTML =
    '<tr><th>Phrase</th><th>Outlier</th><th>Rest</th><th>Over-rep.</th></tr>';
  const tbody = document.createElement('tbody');
  for (const k of keywords.slice(0, 60)) {
    const tr = document.createElement('tr');
    const cells = [
      k.phrase,
      `${k.outlierCount}/${k.outlierSampleSize}`,
      `${k.restCount}/${k.restSampleSize}`,
      formatRatio(k.ratio),
    ];
    for (const cell of cells) {
      const td = document.createElement('td');
      td.textContent = cell;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  els.keywordTable.append(thead, tbody);
}

function renderDomainTable(): void {
  els.domainTable.replaceChildren();
  if (!domains.length) {
    const p = document.createElement('caption');
    p.className = 'muted small';
    p.textContent = 'No outbound domains were readable on the outlier pins.';
    els.domainTable.appendChild(p);
    return;
  }
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Domain</th><th>Outlier pins</th></tr>';
  const tbody = document.createElement('tbody');
  for (const d of domains.slice(0, 30)) {
    const tr = document.createElement('tr');
    const domainTd = document.createElement('td');
    domainTd.textContent = d.domain;
    const countTd = document.createElement('td');
    countTd.textContent = `${d.outlierCount}/${d.outlierSampleSize}`;
    tr.append(domainTd, countTd);
    tbody.appendChild(tr);
  }
  els.domainTable.append(thead, tbody);
}

function renderFormats(): void {
  els.formatBody.replaceChildren();
  const section = (title: string, bands: FormatStats['aspectBands']) => {
    const wrap = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.textContent = title;
    wrap.appendChild(h3);
    const ul = document.createElement('ul');
    if (!bands.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = 'No data.';
      ul.appendChild(li);
    }
    for (const band of bands) {
      const li = document.createElement('li');
      li.textContent = `${band.label}: ${band.count} (${Math.round(band.fraction * 100)}%)`;
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    return wrap;
  };
  els.formatBody.appendChild(section('Image shape', formats.aspectBands));
  els.formatBody.appendChild(section('Text overlay', formats.textOverlay));
}

function updateExportButtons(): void {
  const has = Boolean(snapshot && !snapshot.unsupported && snapshot.pins.length);
  els.exportPins.disabled = !has || !filteredPins.length;
  els.exportKeywords.disabled = !has || !keywords.length;
  els.exportReport.disabled = !has;
}

function render(): void {
  if (!snapshot) return;
  filteredPins = applyFilters(snapshot.pins, snapshot.badges, filters);

  const outliers = outlierPins(snapshot.pins, snapshot.badges, filters.minRatio ?? 2);
  const outlierIds = new Set(outliers.map(p => p.id));
  const rest = snapshot.pins.filter(p => !outlierIds.has(p.id));

  keywords = computeKeywordStats(outliers, rest);
  domains = computeDomainStats(outliers);
  formats = computeFormatStats(outliers);

  const b = snapshot.baseline;
  els.baselineLine.textContent = b.trustworthy
    ? `Median: ${formatSaveCount(b.median ?? 0)} saves across ${b.sampleSize} pins with a visible count.`
    : `Save counts unreliable for this search (${Math.round(b.usableFraction * 100)}% of pins expose one) — badges show result rank instead.`;

  renderPinList();
  renderKeywordTable();
  renderDomainTable();
  renderFormats();
  updateExportButtons();
}

/* ── Tabs ────────────────────────────────────────────────────────────── */

function setTab(tab: 'pins' | 'keywords'): void {
  activeTabName = tab;
  els.tabPins.classList.toggle('tab--on', tab === 'pins');
  els.tabPins.setAttribute('aria-selected', String(tab === 'pins'));
  els.tabKeywords.classList.toggle('tab--on', tab === 'keywords');
  els.tabKeywords.setAttribute('aria-selected', String(tab === 'keywords'));
  els.viewPins.hidden = tab !== 'pins';
  els.viewKeywords.hidden = tab !== 'keywords';
  if (tab === 'keywords') void track('keyword_panel_opened');
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportPinsCsv(): Promise<void> {
  if (!snapshot) return;
  try {
    const csv = toPinsCsv(filteredPins, snapshot.badges);
    await download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), buildFilename(snapshot.query, 'pins', 'csv'));
    setStatus('Saved pins .csv');
    void track('export_pins_csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the file.');
  }
}

async function exportKeywordsCsv(): Promise<void> {
  if (!snapshot) return;
  try {
    const csv = toKeywordsCsv(keywords);
    await download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), buildFilename(snapshot.query, 'keywords', 'csv'));
    setStatus('Saved keywords .csv');
    void track('export_keywords_csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the file.');
  }
}

async function exportReportMd(): Promise<void> {
  if (!snapshot) return;
  try {
    const md = toMarkdownReport({
      query: snapshot.query,
      url: snapshot.url,
      generatedAt: new Date().toISOString(),
      baseline: snapshot.baseline,
      pins: filteredPins,
      badges: snapshot.badges,
      keywords,
      domains,
      formats,
    });
    await download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), buildFilename(snapshot.query, 'report', 'md'));
    setStatus('Saved report .md');
    void track('export_report_md');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the file.');
  }
}

/* ── Data ownership ─────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn ? `Storage ${mb} MB — over 80% full.` : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `pinterest-opportunity-finder-backup-${stamp}.json`);
    setStatus(`Exported ${backup.queries.length} cached quer${backup.queries.length === 1 ? 'y' : 'ies'}`);
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.queries} cached quer${result.queries === 1 ? 'y' : 'ies'}`);
    filters = await readFilters();
    applyFilterInputs();
    await refresh();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage counters ─────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `Distinct searches analysed: ${metrics.analyzedQueries.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.rescan.addEventListener('click', () => {
  void ask({ type: 'POF_RESCAN' }).then(() => refresh());
});

for (const input of [els.fMinRatio, els.fDomain, els.fOverlay, els.fLastN]) {
  input.addEventListener('change', () => {
    filters = readFilterInputs();
    void writeFilters(filters);
    void track('filter_applied');
    render();
  });
}
els.fClear.addEventListener('click', () => {
  filters = { minRatio: null, domain: null, hasTextOverlay: null, lastN: null };
  applyFilterInputs();
  void writeFilters(filters);
  render();
});

els.tabPins.addEventListener('click', () => setTab('pins'));
els.tabKeywords.addEventListener('click', () => setTab('keywords'));

els.exportPins.addEventListener('click', () => void exportPinsCsv());
els.exportKeywords.addEventListener('click', () => void exportKeywordsCsv());
els.exportReport.addEventListener('click', () => void exportReportMd());

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());
els.dataExport.addEventListener('click', () => void exportAllData());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Clear all saved filters and cached medians? This does not affect Pinterest.')) return;
  void clearAllData().then(async () => {
    els.data.close();
    filters = await readFilters();
    applyFilterInputs();
    setStatus('All data cleared.');
    render();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

// This is a toolbar popup, not a side panel: it closes on blur, so there is
// no point wiring chrome.tabs.onActivated/onUpdated (they'd fire after the
// document has already unloaded). The content script pushes updates for as
// long as the popup stays open on the same tab — e.g. while the user scrolls.
chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'POF_SNAPSHOT_CHANGED') void refresh();
});

void (async () => {
  filters = await readFilters();
  applyFilterInputs();
  setTab('pins');
  void track('panel_opened');
  await refresh();
})();
