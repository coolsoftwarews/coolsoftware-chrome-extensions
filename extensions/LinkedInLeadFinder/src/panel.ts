/**
 * The side panel: every lead collected across every post, search, status
 * filter, grouping by source post, the rule editor, export, and the data
 * ownership surface (PRD §4). The panel reads straight from
 * chrome.storage.local — it does not need the content script to be alive on
 * any particular tab, because leads outlive the page they were collected on.
 */

import { seenOnCount } from './dedupe';
import { toCsv, toMarkdown, buildFilename } from './formatters';
import { clearMetrics, readMetrics, track } from './metrics';
import { newRuleId, evaluateLead } from './rules';
import {
  clearAllData,
  deleteLead,
  exportBackup,
  importBackup,
  quotaStatus,
  readAllLeads,
  readRules,
  setNote,
  setStatus,
  writeRules,
} from './storage';
import { Lead, LEAD_STATUSES, LeadStatus, Rule } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  search: $<HTMLInputElement>('search'),
  statusFilter: $<HTMLSelectElement>('status-filter'),
  qualifiedOnly: $<HTMLInputElement>('qualified-only'),
  groupByPost: $<HTMLInputElement>('group-by-post'),
  dlCsv: $<HTMLButtonElement>('dl-csv'),
  dlMd: $<HTMLButtonElement>('dl-md'),
  state: $('state'),
  list: $('list'),
  status: $('status'),
  rules: $<HTMLDialogElement>('rules'),
  rulesToggle: $<HTMLButtonElement>('rules-toggle'),
  rulesList: $('rules-list'),
  ruleInput: $<HTMLInputElement>('rule-input'),
  ruleAdd: $<HTMLButtonElement>('rule-add'),
  rulesClose: $<HTMLButtonElement>('rules-close'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
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

let leads: Lead[] = [];
let rules: Rule[] = [];
let loaded = false;
let loadError: string | null = null;

function setStatusText(message: string): void {
  els.status.textContent = message;
}

/* ── States: loading / empty / error (list itself is the success state) ── */

function showLoading(): void {
  els.list.hidden = true;
  els.state.hidden = false;
  els.state.className = 'state';
  els.state.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const row = document.createElement('div');
    row.className = 'skeleton';
    els.state.appendChild(row);
  }
}

function showMessage(kind: 'empty' | 'error', title: string, body: string): void {
  els.list.hidden = true;
  els.state.hidden = false;
  els.state.className = kind === 'error' ? 'state state--error' : 'state';
  els.state.replaceChildren();

  const icon = document.createElement('img');
  icon.className = 'state__icon';
  icon.src = chrome.runtime.getURL('icons/icon-128.png');
  icon.alt = '';

  const heading = document.createElement('p');
  heading.className = 'state__title';
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'state__body';
  text.textContent = body;

  els.state.append(icon, heading, text);
}

/* ── Loading data ────────────────────────────────────────────────────── */

async function loadAll(): Promise<void> {
  showLoading();
  try {
    const [nextLeads, nextRules] = await Promise.all([readAllLeads(), readRules()]);
    leads = nextLeads;
    rules = nextRules;
    loaded = true;
    loadError = null;
  } catch {
    loaded = false;
    loadError = 'Local storage could not be read. Try reopening the panel.';
  }
  render();
}

/* ── Filtering ───────────────────────────────────────────────────────── */

interface Filtered {
  lead: Lead;
  match: ReturnType<typeof evaluateLead>;
}

function matchesSearch(lead: Lead, query: string): boolean {
  if (!query) return true;
  const haystack = [lead.name, lead.headline, lead.note, ...lead.captures.map(c => c.commentText)]
    .join('\n')
    .toLowerCase();
  return haystack.includes(query);
}

function filteredLeads(): Filtered[] {
  const query = els.search.value.trim().toLowerCase();
  const statusFilter = els.statusFilter.value as LeadStatus | 'all';
  const qualifiedOnly = els.qualifiedOnly.checked;

  return leads
    .map(lead => ({ lead, match: evaluateLead(lead, rules) }))
    .filter(({ lead }) => statusFilter === 'all' || lead.status === statusFilter)
    .filter(({ match }) => !qualifiedOnly || match.qualified)
    .filter(({ lead }) => matchesSearch(lead, query));
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function render(): void {
  if (!loaded) {
    showMessage('error', 'Could not load your leads', loadError ?? 'Something went wrong reading local storage.');
    els.summary.textContent = '';
    return;
  }

  const filtered = filteredLeads();
  els.summary.textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'} collected`;

  if (!leads.length) {
    showMessage(
      'empty',
      'No leads yet',
      'Open a post on LinkedIn, scroll to its comments, and click "Collect commenters" under the thread. Collected people show up here.',
    );
    setStatusText('');
    return;
  }

  if (!filtered.length) {
    showMessage('empty', 'No leads match', 'Try a different search, or clear the status and qualified filters.');
    setStatusText('');
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;
  els.list.replaceChildren();

  if (els.groupByPost.checked) {
    renderGrouped(filtered);
  } else {
    for (const entry of sortForDisplay(filtered)) els.list.appendChild(renderItem(entry));
  }

  setStatusText(`Showing ${filtered.length} of ${leads.length}`);
}

function sortForDisplay(filtered: Filtered[]): Filtered[] {
  return [...filtered].sort((a, b) => b.lead.lastCollectedAt - a.lead.lastCollectedAt);
}

function renderGrouped(filtered: Filtered[]): void {
  const groups = new Map<string, { label: string; entries: Filtered[] }>();
  for (const entry of filtered) {
    for (const capture of entry.lead.captures) {
      const group = groups.get(capture.postUrl) ?? { label: capture.postLabel, entries: [] };
      if (!group.entries.some(e => e.lead.id === entry.lead.id)) group.entries.push(entry);
      groups.set(capture.postUrl, group);
    }
  }

  const ordered = [...groups.entries()].sort(
    (a, b) => Math.max(...b[1].entries.map(e => e.lead.lastCollectedAt)) - Math.max(...a[1].entries.map(e => e.lead.lastCollectedAt)),
  );

  for (const [, group] of ordered) {
    const heading = document.createElement('p');
    heading.className = 'group-heading';
    heading.textContent = `${group.label} · ${group.entries.length}`;
    els.list.appendChild(heading);
    for (const entry of sortForDisplay(group.entries)) els.list.appendChild(renderItem(entry));
  }
}

function renderItem({ lead, match }: Filtered): HTMLElement {
  const item = document.createElement('div');
  item.className = 'item';

  const head = document.createElement('div');
  head.className = 'item__head';

  const name = document.createElement('p');
  name.className = 'item__name';
  name.textContent = (match.qualified ? '⭐ ' : '') + lead.name;
  head.appendChild(name);

  if (lead.isCompany) head.appendChild(badge('Company'));
  if (lead.isAnonymized) head.appendChild(badge('Anonymized'));
  const seen = seenOnCount(lead);
  if (seen > 1) head.appendChild(badge(`Seen on ${seen} posts`));

  item.appendChild(head);

  if (lead.headline) {
    const headline = document.createElement('p');
    headline.className = 'item__headline';
    headline.textContent = lead.headline;
    item.appendChild(headline);
  }

  if (lead.profileUrl) {
    const link = document.createElement('a');
    link.className = 'item__link';
    link.href = lead.profileUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = lead.profileUrl;
    item.appendChild(link);
  }

  const latest = [...lead.captures].sort((a, b) => b.collectedAt - a.collectedAt)[0];
  if (latest?.commentText) {
    const comment = document.createElement('p');
    comment.className = 'item__comment';
    comment.textContent = latest.commentText;
    item.appendChild(comment);
  }

  const meta = document.createElement('p');
  meta.className = 'item__meta';
  const reactions = latest?.reactionCount === null || latest?.reactionCount === undefined ? '' : ` · ${latest.reactionCount} reaction${latest.reactionCount === 1 ? '' : 's'}`;
  meta.textContent = `${latest?.commentDate || 'undated'}${reactions}${match.qualified ? ` · matched: ${match.matchedKeywords.join(', ')}` : ''}`;
  item.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'item__actions';

  const select = document.createElement('select');
  select.setAttribute('aria-label', `Status for ${lead.name}`);
  for (const value of LEAD_STATUSES) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = value[0].toUpperCase() + value.slice(1);
    option.selected = value === lead.status;
    select.appendChild(option);
  }
  select.addEventListener('change', () => void changeStatus(lead.id, select.value as LeadStatus));
  actions.appendChild(select);

  const noteButton = document.createElement('button');
  noteButton.type = 'button';
  noteButton.className = 'link-btn';
  noteButton.textContent = lead.note.trim() ? 'Edit note' : 'Add note';
  actions.appendChild(noteButton);

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'link-btn';
  removeButton.textContent = 'Remove';
  removeButton.addEventListener('click', () => void removeLead(lead.id));
  actions.appendChild(removeButton);

  item.appendChild(actions);

  const noteBox = document.createElement('textarea');
  noteBox.className = 'item__note';
  noteBox.value = lead.note;
  noteBox.placeholder = 'Note on this lead…';
  noteBox.hidden = true;
  noteButton.addEventListener('click', () => {
    noteBox.hidden = !noteBox.hidden;
    if (!noteBox.hidden) noteBox.focus();
  });
  noteBox.addEventListener('blur', () => {
    if (noteBox.value === lead.note) return;
    void saveNote(lead.id, noteBox.value);
  });
  item.appendChild(noteBox);

  return item;
}

function badge(text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'item__badge';
  el.textContent = text;
  return el;
}

/* ── Actions ─────────────────────────────────────────────────────────── */

async function changeStatus(id: string, status: LeadStatus): Promise<void> {
  await setStatus(id, status);
  void track('status_changed');
  await loadAll();
}

async function saveNote(id: string, note: string): Promise<void> {
  await setNote(id, note);
  void track('note_saved');
  await loadAll();
}

async function removeLead(id: string): Promise<void> {
  await deleteLead(id);
  await loadAll();
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

async function exportCsv(): Promise<void> {
  const rows = filteredLeads().map(f => f.lead);
  if (!rows.length) {
    setStatusText('No leads match the current filters — nothing to export.');
    return;
  }
  try {
    await download(new Blob([toCsv(rows, rules)], { type: 'text/csv;charset=utf-8' }), buildFilename('linkedin-leads', 'csv'));
    setStatusText(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'} as CSV`);
    void track('export_csv');
  } catch (error) {
    setStatusText(readableError(error, 'save the CSV file'));
  }
}

async function exportMarkdown(): Promise<void> {
  const rows = filteredLeads().map(f => f.lead);
  if (!rows.length) {
    setStatusText('No leads match the current filters — nothing to export.');
    return;
  }
  try {
    await download(
      new Blob([toMarkdown(rows, rules)], { type: 'text/markdown;charset=utf-8' }),
      buildFilename('linkedin-leads', 'md'),
    );
    setStatusText(`Exported ${rows.length} lead${rows.length === 1 ? '' : 's'} as Markdown`);
    void track('export_md');
  } catch (error) {
    setStatusText(readableError(error, 'save the Markdown file'));
  }
}

function readableError(error: unknown, action: string): string {
  // Never surface a raw API/error object to the user — plain language only.
  void error;
  return `Could not ${action}. Try again.`;
}

/* ── Rules sheet ─────────────────────────────────────────────────────── */

function renderRules(): void {
  els.rulesList.replaceChildren();
  for (const rule of rules) {
    const row = document.createElement('li');
    row.className = 'rule-row';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = rule.enabled;
    checkbox.setAttribute('aria-label', `Enable rule "${rule.keyword}"`);
    checkbox.addEventListener('change', () => void toggleRule(rule.id, checkbox.checked));

    const label = document.createElement('span');
    label.textContent = rule.keyword;

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-btn';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => void removeRule(rule.id));

    row.append(checkbox, label, remove);
    els.rulesList.appendChild(row);
  }
}

async function toggleRule(id: string, enabled: boolean): Promise<void> {
  rules = rules.map(r => (r.id === id ? { ...r, enabled } : r));
  await writeRules(rules);
  render();
}

async function removeRule(id: string): Promise<void> {
  rules = rules.filter(r => r.id !== id);
  await writeRules(rules);
  void track('rule_removed');
  renderRules();
  render();
}

async function addRule(): Promise<void> {
  const keyword = els.ruleInput.value.trim();
  if (!keyword) return;
  if (rules.some(r => r.keyword.toLowerCase() === keyword.toLowerCase())) {
    els.ruleInput.value = '';
    return;
  }
  rules = [...rules, { id: newRuleId(), keyword, enabled: true }];
  await writeRules(rules);
  void track('rule_added');
  els.ruleInput.value = '';
  renderRules();
  render();
}

/* ── Data ownership ─────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some leads.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `linkedin-lead-finder-backup-${stamp}.json`);
    setStatusText(`Exported ${backup.leads.length} lead${backup.leads.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error) {
    setStatusText(readableError(error, 'save the backup'));
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatusText(`Imported ${result.newLeads} new lead${result.newLeads === 1 ? '' : 's'} (${result.leads} in file)`);
    void track('data_imported');
    await loadAll();
  } catch {
    // JSON.parse and importBackup both throw plain-language messages already,
    // but never trust an arbitrary uploaded file to explain itself to the user.
    setStatusText('That file could not be read — it may not be a LinkedIn Lead Finder backup.');
  }
}

/* ── Usage counters ─────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const distinctPosts = new Set(leads.flatMap(l => l.captures.map(c => c.postUrl))).size;
  const qualifiedCount = leads.filter(l => evaluateLead(l, rules).qualified).length;

  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `Leads collected: ${leads.length}`,
    `Posts collected from: ${distinctPosts}`,
    `Qualified leads: ${qualifiedCount}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.search.addEventListener('input', () => render());
els.statusFilter.addEventListener('change', () => render());
els.qualifiedOnly.addEventListener('change', () => render());
els.groupByPost.addEventListener('change', () => render());

els.dlCsv.addEventListener('click', () => void exportCsv());
els.dlMd.addEventListener('click', () => void exportMarkdown());

els.rulesToggle.addEventListener('click', () => {
  renderRules();
  els.rules.showModal();
});
els.rulesClose.addEventListener('click', () => els.rules.close());
els.ruleAdd.addEventListener('click', () => void addRule());
els.ruleInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') void addRule();
});

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
  if (!confirm('Delete every lead and every rule? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatusText('All data cleared.');
    void loadAll();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'LLF_LEADS_CHANGED') void loadAll();
});

void (async () => {
  void track('panel_opened');
  await loadAll();
})();
