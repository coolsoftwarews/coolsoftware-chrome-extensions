/**
 * The opportunity panel: a dedicated extension tab (see background.ts for
 * why not `sidePanel`), rules, filters, the two "signal" surfaces (topic hit
 * counts and the current subreddit's read), the matched-thread list, export
 * and data ownership.
 *
 * The panel owns no opportunity/rule state of its own beyond what's in
 * `chrome.storage.local` — it reads on load and on every `storage.onChanged`
 * event, so a match captured on any Reddit tab shows up here without a
 * message round-trip. Live tab context (current subreddit, session cap) is
 * the one thing that *is* asked for live, via a message to whichever Reddit
 * tab looks active — that data doesn't exist anywhere but in that tab.
 */

import { buildFilename, toCsv, toMarkdown } from './export';
import { clearMetrics, readMetrics, track } from './metrics';
import { describeTopicHit, isUsableRule, parseTokenList, summarizeRuleHits, summarizeTopicHits } from './rules';
import { STARTER_PACKS } from './starter-packs';
import {
  clearAllData,
  clearOpportunities,
  deleteOpportunity,
  exportBackup,
  importBackup,
  mutateRules,
  newRuleId,
  quotaStatus,
  readAllOpportunities,
  readRules,
  setOpportunityNote,
  setOpportunityStatus,
} from './storage';
import { OPPORTUNITY_STATUSES, Opportunity, OpportunityStatus, PanelToContent, Rule, TabStatus } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  tabRefresh: $<HTMLButtonElement>('tab-refresh'),
  tabStatus: $('tab-status'),
  rulesEmpty: $('rules-empty'),
  rulesList: $<HTMLOListElement>('rules-list'),
  packSelect: $<HTMLSelectElement>('pack-select'),
  packAdd: $<HTMLButtonElement>('pack-add'),
  ruleName: $<HTMLInputElement>('rule-name'),
  ruleIntents: $<HTMLTextAreaElement>('rule-intents'),
  ruleTopics: $<HTMLTextAreaElement>('rule-topics'),
  ruleIgnore: $<HTMLTextAreaElement>('rule-ignore'),
  ruleAdd: $<HTMLButtonElement>('rule-add'),
  signalsList: $<HTMLOListElement>('signals-list'),
  signalsEmpty: $('signals-empty'),
  subredditRead: $('subreddit-read'),
  filterSubreddit: $<HTMLSelectElement>('filter-subreddit'),
  filterRule: $<HTMLSelectElement>('filter-rule'),
  filterStatus: $<HTMLSelectElement>('filter-status'),
  filterSearch: $<HTMLInputElement>('filter-search'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
  status: $('status'),
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

interface PanelFilters {
  subreddit: string;
  ruleId: string;
  status: OpportunityStatus | '';
  search: string;
}

let rules: Rule[] = [];
let opportunities: Opportunity[] = [];
let tabStatus: TabStatus | null = null;
let filters: PanelFilters = { subreddit: '', ruleId: '', status: '', search: '' };

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Talking to the active Reddit tab ────────────────────────────────── */

const REDDIT_URL_PATTERNS = ['*://www.reddit.com/*', '*://old.reddit.com/*', '*://reddit.com/*'];

async function findRedditTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ url: REDDIT_URL_PATTERNS });
  if (!tabs.length) return null;
  return tabs.find(t => t.active) ?? tabs[0];
}

async function askAllRedditTabs(message: PanelToContent): Promise<void> {
  const tabs = await chrome.tabs.query({ url: REDDIT_URL_PATTERNS });
  await Promise.all(
    tabs
      .filter((t): t is chrome.tabs.Tab & { id: number } => t.id !== undefined)
      .map(t => chrome.tabs.sendMessage(t.id, message).catch(() => undefined))
  );
}

async function refreshTabStatus(): Promise<void> {
  const tab = await findRedditTab();
  if (!tab || tab.id === undefined) {
    tabStatus = null;
    renderTabStatus('no-tab');
    renderSubredditRead(null);
    return;
  }
  try {
    tabStatus = (await chrome.tabs.sendMessage(tab.id, { type: 'ROM_GET_TAB_STATUS' } as PanelToContent)) as TabStatus;
    renderTabStatus('ok');
  } catch {
    tabStatus = null;
    renderTabStatus('needs-reload');
  }
  renderSubredditRead(tabStatus?.summary ?? null);
}

function renderTabStatus(kind: 'ok' | 'no-tab' | 'needs-reload'): void {
  if (kind === 'no-tab') {
    els.tabStatus.textContent = 'No Reddit tab open — browse a subreddit in another tab, matches show up here automatically.';
    return;
  }
  if (kind === 'needs-reload') {
    els.tabStatus.textContent = 'Found a Reddit tab, but it was open before this extension loaded — reload it to start scanning.';
    return;
  }
  if (!tabStatus) return;
  const where = tabStatus.subreddit ? `r/${tabStatus.subreddit}` : 'the current feed';
  const frontendLabel = tabStatus.frontend === 'old' ? 'old Reddit' : 'new Reddit';
  const capNote = tabStatus.sessionCapped ? ` · session cap reached (${tabStatus.sessionCaptured})` : '';
  els.tabStatus.textContent = `Reading ${where} (${frontendLabel}) · ${tabStatus.sessionCaptured} matched this session${capNote}`;
}

/* ── Rules ────────────────────────────────────────────────────────────── */

function summarizePhrases(list: string[], label: string): string {
  return list.length ? `${label}: ${list.join(', ')}` : '';
}

function renderRules(): void {
  els.rulesList.replaceChildren();
  els.rulesEmpty.hidden = rules.length > 0;

  const hitSummaries = summarizeRuleHits(rules, opportunities);
  const hitByRuleId = new Map(hitSummaries.map(h => [h.ruleId, h]));

  for (const rule of rules) {
    const li = document.createElement('li');
    li.className = 'rule';

    const head = document.createElement('div');
    head.className = 'rule__head';

    const enabledToggle = document.createElement('input');
    enabledToggle.type = 'checkbox';
    enabledToggle.checked = rule.enabled;
    enabledToggle.setAttribute('aria-label', `Enable rule ${rule.name}`);
    enabledToggle.addEventListener('change', () => void toggleRule(rule.id, enabledToggle.checked));

    const name = document.createElement('span');
    name.className = 'rule__name';
    name.textContent = rule.name;
    name.title = rule.name;

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link-btn';
    del.textContent = 'Delete';
    del.addEventListener('click', () => void deleteRule(rule.id));

    head.append(enabledToggle, name, del);
    li.appendChild(head);

    const phrases = document.createElement('p');
    phrases.className = 'rule__phrases';
    phrases.textContent = [
      summarizePhrases(rule.matchPhrases, 'Intent'),
      summarizePhrases(rule.topicWords, 'Topic'),
      summarizePhrases(rule.ignoreWords, 'Ignore'),
    ]
      .filter(Boolean)
      .join(' · ');
    li.appendChild(phrases);

    const summary = hitByRuleId.get(rule.id);
    const hits = document.createElement('p');
    hits.className = 'rule__hits';
    hits.textContent = summary && summary.total > 0 ? `${summary.total} matched total · ${summary.recent} in 30 days` : 'No matches yet';
    li.appendChild(hits);

    els.rulesList.appendChild(li);
  }
}

async function toggleRule(id: string, enabled: boolean): Promise<void> {
  await mutateRules(list => {
    const rule = list.find(r => r.id === id);
    if (rule) rule.enabled = enabled;
  });
  await askAllRedditTabs({ type: 'ROM_RULES_CHANGED' });
  await loadRules();
}

async function deleteRule(id: string): Promise<void> {
  await mutateRules(list => {
    const index = list.findIndex(r => r.id === id);
    if (index !== -1) list.splice(index, 1);
  });
  void track('rule_deleted');
  await askAllRedditTabs({ type: 'ROM_RULES_CHANGED' });
  await loadRules();
}

async function addRule(): Promise<void> {
  const rule: Rule = {
    id: newRuleId(),
    name: els.ruleName.value.trim() || 'Untitled rule',
    matchPhrases: parseTokenList(els.ruleIntents.value),
    topicWords: parseTokenList(els.ruleTopics.value),
    ignoreWords: parseTokenList(els.ruleIgnore.value),
    enabled: true,
    createdAt: Date.now(),
  };

  if (!isUsableRule(rule)) {
    setStatus('A rule needs at least one intent phrase and one topic word.');
    return;
  }

  await mutateRules(list => list.push(rule));
  void track('rule_created');
  els.ruleName.value = '';
  els.ruleIntents.value = '';
  els.ruleTopics.value = '';
  els.ruleIgnore.value = '';
  setStatus(`Added "${rule.name}"`);
  await askAllRedditTabs({ type: 'ROM_RULES_CHANGED' });
  await loadRules();
}

async function addPack(): Promise<void> {
  const pack = STARTER_PACKS.find(p => p.id === els.packSelect.value);
  if (!pack) return;

  await mutateRules(list => {
    for (const template of pack.rules) {
      list.push({
        id: newRuleId(),
        name: template.name,
        matchPhrases: [...template.matchPhrases],
        topicWords: [...template.topicWords],
        ignoreWords: [...(template.ignoreWords ?? [])],
        enabled: true,
        createdAt: Date.now(),
      });
    }
  });
  void track('starter_pack_used');
  setStatus(`Added ${pack.rules.length} rule${pack.rules.length === 1 ? '' : 's'} from "${pack.label}"`);
  await askAllRedditTabs({ type: 'ROM_RULES_CHANGED' });
  await loadRules();
}

function populatePackSelect(): void {
  els.packSelect.replaceChildren();
  for (const pack of STARTER_PACKS) {
    const option = document.createElement('option');
    option.value = pack.id;
    option.textContent = `${pack.label} — ${pack.description}`;
    els.packSelect.appendChild(option);
  }
}

/* ── Signals (topic hit counts) ──────────────────────────────────────── */

function renderSignals(): void {
  const summaries = summarizeTopicHits(opportunities).slice(0, 10);
  els.signalsList.replaceChildren();
  els.signalsEmpty.hidden = summaries.length > 0;
  for (const summary of summaries) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = describeTopicHit(summary);
    li.appendChild(label);
    els.signalsList.appendChild(li);
  }
}

/* ── Subreddit read ───────────────────────────────────────────────────── */

function renderSubredditRead(summary: TabStatus['summary']): void {
  if (!summary) {
    els.subredditRead.replaceChildren();
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = 'Open a subreddit’s listing in another tab, then press Refresh above.';
    els.subredditRead.appendChild(p);
    return;
  }
  void track('subreddit_read_viewed');
  els.subredditRead.replaceChildren();
  const dl = document.createElement('dl');
  const rows: Array<[string, string]> = [
    ['Subreddit', `r/${summary.subreddit}`],
    ['Posts loaded', String(summary.postsScanned)],
    ['Median score', summary.medianScore === null ? '—' : String(summary.medianScore)],
    [
      'Common intent phrases',
      summary.topIntentPhrases.length
        ? summary.topIntentPhrases.map(p => `"${p.phrase}" (${p.count})`).join(', ')
        : '—',
    ],
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dl.append(dt, dd);
  }
  els.subredditRead.appendChild(dl);
}

/* ── Filters + list ───────────────────────────────────────────────────── */

function populateFilterOptions(): void {
  const subreddits = [...new Set(opportunities.map(o => o.subreddit))].sort((a, b) => a.localeCompare(b));
  const currentSubreddit = els.filterSubreddit.value;
  els.filterSubreddit.replaceChildren(new Option('All', ''));
  for (const sub of subreddits) els.filterSubreddit.appendChild(new Option(`r/${sub}`, sub));
  els.filterSubreddit.value = subreddits.includes(currentSubreddit) ? currentSubreddit : '';

  const currentRule = els.filterRule.value;
  els.filterRule.replaceChildren(new Option('All', ''));
  for (const rule of rules) els.filterRule.appendChild(new Option(rule.name, rule.id));
  els.filterRule.value = rules.some(r => r.id === currentRule) ? currentRule : '';
}

function filteredOpportunities(): Opportunity[] {
  const search = filters.search.trim().toLowerCase();
  return opportunities.filter(item => {
    if (filters.subreddit && item.subreddit !== filters.subreddit) return false;
    if (filters.ruleId && !item.matches.some(m => m.ruleId === filters.ruleId)) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (search && !`${item.title} ${item.snippet}`.toLowerCase().includes(search)) return false;
    return true;
  });
}

function relativeAge(ms: number | null): string | null {
  if (ms === null) return null;
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function showState(message: string): void {
  els.state.hidden = false;
  els.state.replaceChildren();
  const p = document.createElement('p');
  p.className = 'state__text';
  p.textContent = message;
  els.state.appendChild(p);
  els.list.hidden = true;
}

function renderList(): void {
  const items = filteredOpportunities();

  if (!rules.length) {
    showState('Add a rule — or a starter pack — in the sidebar to start finding opportunities.');
    return;
  }
  if (!opportunities.length) {
    showState(
      'No opportunities yet. Reddit Opportunity Lens only reads what you scroll past — browse a subreddit that matches your rules in another tab, and matches will show up here. It reads posts only, not comment threads.'
    );
    return;
  }
  if (!items.length) {
    showState('No opportunities match these filters.');
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;
  els.list.replaceChildren();

  for (const item of items) {
    els.list.appendChild(renderItem(item));
  }
}

function renderItem(item: Opportunity): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'item';

  const head = document.createElement('div');
  head.className = 'item__head';

  const link = document.createElement('a');
  link.className = 'item__title';
  link.href = item.permalink;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = item.title || '(untitled post)';
  head.appendChild(link);

  const meta = document.createElement('span');
  meta.className = 'item__meta';
  const age = relativeAge(item.createdAtMs) ?? item.postedAtLabel ?? '';
  meta.textContent = [
    `r/${item.subreddit}`,
    item.score !== null ? `${item.score} pts` : null,
    item.numComments !== null ? `${item.numComments} comments` : null,
    age || null,
  ]
    .filter(Boolean)
    .join(' · ');
  head.appendChild(meta);
  li.appendChild(head);

  if (item.matches.length) {
    const chip = document.createElement('span');
    chip.className = 'item__chip';
    chip.textContent = item.matches
      .map(m => `\u{1F4A1} "${m.matchPhrase}" + "${m.topicWord}"`)
      .join('  ');
    li.appendChild(chip);
  }

  if (item.snippet.trim()) {
    const snippet = document.createElement('p');
    snippet.className = 'item__snippet';
    snippet.textContent = item.snippet;
    li.appendChild(snippet);
  }

  const actions = document.createElement('div');
  actions.className = 'item__actions';

  const seg = document.createElement('div');
  seg.className = 'seg';
  for (const status of OPPORTUNITY_STATUSES) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = status;
    if (status === item.status) button.classList.add('seg--on');
    button.addEventListener('click', () => void changeStatus(item.id, status));
    seg.appendChild(button);
  }
  actions.appendChild(seg);

  const noteButton = document.createElement('button');
  noteButton.type = 'button';
  noteButton.className = 'link-btn';
  noteButton.textContent = item.note.trim() ? 'Edit note' : 'Add note';
  actions.appendChild(noteButton);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'link-btn';
  deleteButton.textContent = 'Delete';
  deleteButton.style.marginLeft = 'auto';
  deleteButton.addEventListener('click', () => void removeItem(item.id));
  actions.appendChild(deleteButton);

  li.appendChild(actions);

  const noteBox = document.createElement('textarea');
  noteBox.className = 'item__note';
  noteBox.rows = 2;
  noteBox.value = item.note;
  noteBox.placeholder = 'Note on this thread…';
  noteBox.hidden = true;
  noteButton.addEventListener('click', () => {
    noteBox.hidden = !noteBox.hidden;
    if (!noteBox.hidden) noteBox.focus();
  });
  noteBox.addEventListener('blur', () => {
    if (noteBox.value === item.note) return;
    void setOpportunityNote(item.id, noteBox.value).then(() => {
      if (noteBox.value.trim()) void track('note_added');
      void loadOpportunities();
    });
  });
  li.appendChild(noteBox);

  return li;
}

async function changeStatus(id: string, status: OpportunityStatus): Promise<void> {
  await setOpportunityStatus(id, status);
  if (status === 'replied') void track('status_replied');
  if (status === 'dismissed') void track('status_dismissed');
  await loadOpportunities();
}

async function removeItem(id: string): Promise<void> {
  await deleteOpportunity(id);
  await loadOpportunities();
}

/* ── Export ───────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function exportScopeLabel(): string {
  const parts = [filters.subreddit, filters.status].filter(Boolean);
  return parts.length ? parts.join('-') : 'all';
}

async function exportCsv(): Promise<void> {
  const items = filteredOpportunities();
  try {
    await download(new Blob([toCsv(items)], { type: 'text/csv;charset=utf-8' }), buildFilename('csv', exportScopeLabel()));
    setStatus(`Exported ${items.length} row${items.length === 1 ? '' : 's'} as CSV`);
    void track('export_csv');
  } catch (error: unknown) {
    setStatus(error instanceof Error ? error.message : 'Could not save the CSV file.');
  }
}

async function exportMd(): Promise<void> {
  const items = filteredOpportunities();
  try {
    await download(
      new Blob([toMarkdown(items)], { type: 'text/markdown;charset=utf-8' }),
      buildFilename('md', exportScopeLabel())
    );
    setStatus(`Exported ${items.length} item${items.length === 1 ? '' : 's'} as Markdown`);
    void track('export_md');
  } catch (error: unknown) {
    setStatus(error instanceof Error ? error.message : 'Could not save the Markdown file.');
  }
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some items.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `reddit-opportunity-lens-backup-${stamp}.json`);
    setStatus(`Exported ${backup.rules.length} rule${backup.rules.length === 1 ? '' : 's'} and ${backup.items.length} item${backup.items.length === 1 ? '' : 's'}`);
    void track('data_exported');
  } catch (error: unknown) {
    setStatus(error instanceof Error ? error.message : 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.rules} rule${result.rules === 1 ? '' : 's'} and ${result.items} item${result.items === 1 ? '' : 's'}`);
    void track('data_imported');
    await loadAll();
  } catch (error: unknown) {
    setStatus(error instanceof Error ? error.message : 'That file could not be read.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

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

/* ── Loading + wiring ─────────────────────────────────────────────────── */

async function loadRules(): Promise<void> {
  rules = await readRules();
  renderRules();
  populateFilterOptions();
  renderList();
}

async function loadOpportunities(): Promise<void> {
  opportunities = await readAllOpportunities();
  renderRules();
  renderSignals();
  populateFilterOptions();
  renderList();
}

async function loadAll(): Promise<void> {
  [rules, opportunities] = await Promise.all([readRules(), readAllOpportunities()]);
  renderRules();
  renderSignals();
  populateFilterOptions();
  renderList();
}

els.tabRefresh.addEventListener('click', () => void refreshTabStatus());
els.packAdd.addEventListener('click', () => void addPack());
els.ruleAdd.addEventListener('click', () => void addRule());

els.filterSubreddit.addEventListener('change', () => {
  filters = { ...filters, subreddit: els.filterSubreddit.value };
  renderList();
});
els.filterRule.addEventListener('change', () => {
  filters = { ...filters, ruleId: els.filterRule.value };
  renderList();
});
els.filterStatus.addEventListener('change', () => {
  filters = { ...filters, status: els.filterStatus.value as OpportunityStatus | '' };
  renderList();
});
els.filterSearch.addEventListener('input', () => {
  filters = { ...filters, search: els.filterSearch.value };
  renderList();
});

els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportMd.addEventListener('click', () => void exportMd());

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
  if (!confirm('Delete every rule and every matched thread? Export first if you want a copy.')) return;
  void Promise.all([clearAllData(), clearOpportunities()]).then(() => {
    els.data.close();
    setStatus('All data cleared.');
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

// A match captured (or a rule edited) on any Reddit tab shows up here without
// a message round-trip — storage is the single source of truth.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes['rom:items']) void loadOpportunities();
  if (changes['rom:rules']) void loadRules();
});

void (async () => {
  showState('Loading…');
  populatePackSelect();
  void track('panel_opened');
  await loadAll();
  await refreshTabStatus();
})();
