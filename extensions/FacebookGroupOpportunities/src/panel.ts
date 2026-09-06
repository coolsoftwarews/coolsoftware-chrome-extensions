/**
 * The side panel: rules, matched posts, and the data-ownership surface.
 *
 * The panel owns no post data of its own — content.ts is the single writer
 * for captured opportunities, and this file reads chrome.storage.local
 * directly (rules and items don't need to round-trip through the content
 * script; only "what does this tab look like right now" does).
 */

import { isFacebookUrl, isGroupUrl } from './facebook-url';
import { track, readMetrics, clearMetrics } from './metrics';
import { buildFilename, toCsv, toMarkdown } from './formatters';
import {
  clearAllData,
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
import { describeWeeklyHits, isUsableRule, parseTokenList, summarizeHits } from './rules';
import { STARTER_PACKS } from './starter-packs';
import { MAX_CARD_TEXT_LENGTH, Opportunity, OpportunityStatus, Rule, TabStatus } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  tabStatus: $('tab-status'),
  refresh: $<HTMLButtonElement>('refresh'),
  gate: $('gate'),
  gateIcon: $<HTMLImageElement>('gate-icon'),
  gateTitle: $('gate-title'),
  gateBody: $('gate-body'),
  gateAction: $<HTMLButtonElement>('gate-action'),
  app: $('app'),
  ruleList: $<HTMLUListElement>('rule-list'),
  ruleEmpty: $('rule-empty'),
  ruleAdd: $<HTMLButtonElement>('rule-add'),
  starterPacks: $('starter-packs'),
  ruleForm: $<HTMLDialogElement>('rule-form'),
  ruleFormTitle: $('rule-form-title'),
  ruleFields: $<HTMLFormElement>('rule-fields'),
  rfName: $<HTMLInputElement>('rf-name'),
  rfMatch: $<HTMLTextAreaElement>('rf-match'),
  rfTopic: $<HTMLTextAreaElement>('rf-topic'),
  rfIgnore: $<HTMLTextAreaElement>('rf-ignore'),
  rfError: $('rf-error'),
  rfCancel: $<HTMLButtonElement>('rf-cancel'),
  itemCount: $('item-count'),
  fSearch: $<HTMLInputElement>('f-search'),
  fRule: $<HTMLSelectElement>('f-rule'),
  fStatus: $<HTMLSelectElement>('f-status'),
  itemsState: $('items-state'),
  itemList: $<HTMLOListElement>('item-list'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
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

let tabId: number | null = null;
let tabUrl: string | undefined;
let rules: Rule[] = [];
let items: Opportunity[] = [];
let editingRuleId: string | null = null;

const filter = { search: '', ruleId: '', status: 'all' as OpportunityStatus | 'all' };

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Gate (mirrors the shape used across the portfolio's panels) ────────── */

function showGate(title: string, body: string, actionLabel?: string, action?: () => void): void {
  els.app.hidden = true;
  els.gate.hidden = false;
  els.gateIcon.src = chrome.runtime.getURL('icons/icon-128.png');
  els.gateTitle.textContent = title;
  els.gateBody.textContent = body;
  if (actionLabel && action) {
    els.gateAction.hidden = false;
    els.gateAction.textContent = actionLabel;
    els.gateAction.onclick = action;
  } else {
    els.gateAction.hidden = true;
    els.gateAction.onclick = null;
  }
}

function hideGate(): void {
  els.gate.hidden = true;
  els.app.hidden = false;
}

/* ── Talking to the content script (tab status only) ─────────────────────── */

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function askTabStatus(): Promise<TabStatus | null> {
  if (tabId === null) return null;
  try {
    return (await chrome.tabs.sendMessage(tabId, { type: 'FGO_GET_TAB_STATUS' })) as TabStatus;
  } catch {
    return null;
  }
}

function notifyRulesChanged(): void {
  if (tabId === null) return;
  void chrome.tabs.sendMessage(tabId, { type: 'FGO_RULES_CHANGED' }).catch(() => undefined);
}

/* ── Load + refresh ────────────────────────────────────────────────────── */

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;
  tabUrl = tab?.url;

  if (!isFacebookUrl(tabUrl)) {
    showGate(
      'Open a Facebook group',
      'This extension only reads what Facebook renders in a group feed you belong to. Open a group and come back.',
    );
    return;
  }

  const status = await askTabStatus();
  if (!status) {
    showGate(
      'Reload this tab first',
      'This tab was open before the extension was installed or updated, so it has no scanner in it yet. One reload and it is ready.',
      'Reload the tab',
      () => {
        if (tabId !== null) void chrome.tabs.reload(tabId);
      },
    );
    return;
  }

  if (!status.onGroup || !isGroupUrl(tabUrl)) {
    showGate(
      'Open a group you belong to',
      'Matched posts only come from group feeds — the main feed, Marketplace and Watch are out of scope on purpose (PRD: read-only, foreground-only).',
    );
    return;
  }

  hideGate();
  els.tabStatus.textContent =
    status.groupName +
    (status.sessionCapped ? ` · session limit reached (${status.sessionCaptured})` : '');

  rules = await readRules();
  items = await readAllOpportunities();
  renderRules();
  renderFilterOptions();
  renderItems();
}

/* ── Rules ─────────────────────────────────────────────────────────────── */

function summarizeRule(rule: Rule): string {
  const parts = [`Match: ${rule.matchPhrases.join(' · ') || '—'}`, `Topic: ${rule.topicWords.join(' · ') || '—'}`];
  if (rule.ignoreWords.length) parts.push(`Ignore: ${rule.ignoreWords.join(' · ')}`);
  return parts.join('  ·  ');
}

function renderRules(): void {
  els.ruleList.replaceChildren();
  els.ruleEmpty.hidden = rules.length > 0;

  const hitSummaries = summarizeHits(rules, items);

  for (const rule of rules) {
    const summary = hitSummaries.find(s => s.ruleId === rule.id);
    const li = document.createElement('li');
    li.className = 'rule';

    const head = document.createElement('div');
    head.className = 'rule__head';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled;
    toggle.setAttribute('aria-label', `Enable ${rule.name}`);
    toggle.addEventListener('change', () => void toggleRule(rule.id, toggle.checked));

    const name = document.createElement('span');
    name.className = 'rule__name';
    name.textContent = rule.name;

    head.append(toggle, name);
    li.appendChild(head);

    const summaryEl = document.createElement('p');
    summaryEl.className = 'rule__summary';
    summaryEl.textContent = summarizeRule(rule);
    li.appendChild(summaryEl);

    if (summary) {
      const hits = document.createElement('p');
      hits.className = 'rule__hits';
      hits.textContent = `${describeWeeklyHits(summary)} · ${summary.total} total`;
      li.appendChild(hits);
    }

    const actions = document.createElement('div');
    actions.className = 'rule__actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'link-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => openRuleForm(rule));

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'link-btn';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => void deleteRule(rule.id));

    actions.append(editBtn, deleteBtn);
    li.appendChild(actions);

    els.ruleList.appendChild(li);
  }

  renderStarterPacks();
}

function renderStarterPacks(): void {
  els.starterPacks.replaceChildren();
  const used = new Set(rules.map(r => r.name));
  for (const pack of STARTER_PACKS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'starter-pack';
    btn.textContent = used.has(pack.rule.name) ? `✓ ${pack.label}` : `+ ${pack.label}`;
    btn.disabled = used.has(pack.rule.name);
    btn.title = pack.description;
    btn.addEventListener('click', () => void addStarterPack(pack.id));
    els.starterPacks.appendChild(btn);
  }
}

async function addStarterPack(packId: string): Promise<void> {
  const pack = STARTER_PACKS.find(p => p.id === packId);
  if (!pack) return;
  const rule: Rule = { id: newRuleId(), enabled: true, createdAt: Date.now(), ...pack.rule };
  await mutateRules(list => list.push(rule));
  void track('starter_pack_used');
  notifyRulesChanged();
  setStatus(`Added "${rule.name}"`);
  await refresh();
}

async function toggleRule(id: string, enabled: boolean): Promise<void> {
  await mutateRules(list => {
    const rule = list.find(r => r.id === id);
    if (rule) rule.enabled = enabled;
  });
  notifyRulesChanged();
  await refresh();
}

async function deleteRule(id: string): Promise<void> {
  if (!confirm('Delete this rule? Posts already captured stay in your list.')) return;
  await mutateRules(list => {
    const index = list.findIndex(r => r.id === id);
    if (index !== -1) list.splice(index, 1);
  });
  void track('rule_deleted');
  notifyRulesChanged();
  await refresh();
}

function openRuleForm(rule?: Rule): void {
  editingRuleId = rule?.id ?? null;
  els.ruleFormTitle.textContent = rule ? 'Edit rule' : 'New rule';
  els.rfName.value = rule?.name ?? '';
  els.rfMatch.value = rule?.matchPhrases.join(', ') ?? 'looking for, can anyone recommend, does anyone know';
  els.rfTopic.value = rule?.topicWords.join(', ') ?? '';
  els.rfIgnore.value = rule?.ignoreWords.join(', ') ?? 'free, intern';
  els.rfError.hidden = true;
  els.ruleForm.showModal();
  els.rfName.focus();
}

els.ruleFields.addEventListener('submit', event => {
  event.preventDefault();
  void saveRuleForm();
});

async function saveRuleForm(): Promise<void> {
  const name = els.rfName.value.trim();
  const matchPhrases = parseTokenList(els.rfMatch.value);
  const topicWords = parseTokenList(els.rfTopic.value);
  const ignoreWords = parseTokenList(els.rfIgnore.value);

  if (!name) {
    els.rfError.textContent = 'Give the rule a name.';
    els.rfError.hidden = false;
    return;
  }
  if (!isUsableRule({ matchPhrases, topicWords })) {
    els.rfError.textContent = 'Add at least one match phrase and one topic word — that pair is what finds an opportunity.';
    els.rfError.hidden = false;
    return;
  }

  if (editingRuleId) {
    await mutateRules(list => {
      const rule = list.find(r => r.id === editingRuleId);
      if (rule) Object.assign(rule, { name, matchPhrases, topicWords, ignoreWords });
    });
  } else {
    const rule: Rule = { id: newRuleId(), name, matchPhrases, topicWords, ignoreWords, enabled: true, createdAt: Date.now() };
    await mutateRules(list => list.push(rule));
    void track('rule_created');
  }

  notifyRulesChanged();
  els.ruleForm.close();
  setStatus('Rule saved');
  await refresh();
}

els.ruleAdd.addEventListener('click', () => openRuleForm());
els.rfCancel.addEventListener('click', () => els.ruleForm.close());

/* ── Opportunities ─────────────────────────────────────────────────────── */

function renderFilterOptions(): void {
  const current = els.fRule.value;
  els.fRule.replaceChildren();
  const allOption = document.createElement('option');
  allOption.value = '';
  allOption.textContent = 'All rules';
  els.fRule.appendChild(allOption);
  for (const rule of rules) {
    const option = document.createElement('option');
    option.value = rule.id;
    option.textContent = rule.name;
    els.fRule.appendChild(option);
  }
  els.fRule.value = rules.some(r => r.id === current) ? current : '';
}

function filteredItems(): Opportunity[] {
  const q = filter.search.trim().toLowerCase();
  return items.filter(item => {
    if (filter.status !== 'all' && item.status !== filter.status) return false;
    if (filter.ruleId && !item.matches.some(m => m.ruleId === filter.ruleId)) return false;
    if (q) {
      const haystack = `${item.postText} ${item.author} ${item.groupName}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
}

const STATUS_LABEL: Record<OpportunityStatus, string> = { new: 'New', replied: 'Replied', dismissed: 'Dismissed' };

function renderItems(): void {
  const list = filteredItems();
  els.itemCount.textContent = `${list.length} of ${items.length}`;
  els.itemList.replaceChildren();

  if (!list.length) {
    els.itemsState.hidden = false;
    els.itemList.hidden = true;
    els.itemsState.querySelector('.state__text')!.textContent = items.length
      ? 'No matched posts fit the current filter.'
      : "No matched posts yet. Browse a group feed you're a member of — matches show up here as you scroll.";
    return;
  }

  els.itemsState.hidden = true;
  els.itemList.hidden = false;

  for (const item of list) {
    const li = document.createElement('li');
    li.className = `item item--${item.status}`;

    const meta = document.createElement('div');
    meta.className = 'item__meta';
    const groupAuthor = document.createElement('span');
    const groupSpan = document.createElement('span');
    groupSpan.className = 'item__group';
    groupSpan.textContent = item.groupName;
    groupAuthor.append(groupSpan, document.createTextNode(` · ${item.author}`));
    const when = document.createElement('span');
    when.textContent = item.postedAt || new Date(item.capturedAt).toLocaleDateString();
    meta.append(groupAuthor, when);
    li.appendChild(meta);

    const chips = document.createElement('div');
    chips.className = 'item__chips';
    for (const match of item.matches) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = `"${match.matchPhrase}" + "${match.topicWord}"`;
      chips.appendChild(chip);
    }
    li.appendChild(chips);

    const text = document.createElement('p');
    text.className = 'item__text';
    text.textContent =
      item.postText.length > MAX_CARD_TEXT_LENGTH
        ? item.postText.slice(0, MAX_CARD_TEXT_LENGTH).trimEnd() + '…'
        : item.postText;
    li.appendChild(text);

    const linkRow = document.createElement('div');
    linkRow.className = 'row wrap';
    if (item.postUrl) {
      const link = document.createElement('a');
      link.className = 'item__link';
      link.href = item.postUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'Open post';
      linkRow.appendChild(link);
    }
    if (item.commentCount !== null) {
      const comments = document.createElement('span');
      comments.className = 'muted small';
      comments.textContent = `${item.commentCount} comment${item.commentCount === 1 ? '' : 's'}`;
      linkRow.appendChild(comments);
    }
    if (linkRow.childNodes.length) li.appendChild(linkRow);

    const actions = document.createElement('div');
    actions.className = 'item__actions';
    for (const status of ['new', 'replied', 'dismissed'] as OpportunityStatus[]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'status-btn';
      btn.textContent = STATUS_LABEL[status];
      btn.setAttribute('aria-pressed', String(item.status === status));
      btn.addEventListener('click', () => void setStatusFor(item.id, status));
      actions.appendChild(btn);
    }
    li.appendChild(actions);

    const note = document.createElement('textarea');
    note.className = 'item__note';
    note.rows = item.note ? 2 : 1;
    note.placeholder = 'Note (e.g. what you replied)…';
    note.value = item.note;
    note.addEventListener('blur', () => {
      if (note.value === item.note) return;
      void setNoteFor(item.id, note.value);
    });
    li.appendChild(note);

    els.itemList.appendChild(li);
  }
}

async function setStatusFor(id: string, status: OpportunityStatus): Promise<void> {
  await setOpportunityStatus(id, status);
  if (status === 'replied') void track('status_replied');
  if (status === 'dismissed') void track('status_dismissed');
  items = await readAllOpportunities();
  renderItems();
}

async function setNoteFor(id: string, note: string): Promise<void> {
  await setOpportunityNote(id, note);
  void track('note_added');
  items = await readAllOpportunities();
}

els.fSearch.addEventListener('input', () => {
  filter.search = els.fSearch.value;
  renderItems();
});
els.fRule.addEventListener('change', () => {
  filter.ruleId = els.fRule.value;
  renderItems();
});
els.fStatus.addEventListener('change', () => {
  filter.status = els.fStatus.value as OpportunityStatus | 'all';
  renderItems();
});

/* ── Exporting ─────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function exportScopeLabel(): string {
  if (filter.status !== 'all') return filter.status;
  const rule = rules.find(r => r.id === filter.ruleId);
  return rule ? rule.name : 'all';
}

els.exportCsv.addEventListener('click', async () => {
  const list = filteredItems();
  if (!list.length) {
    setStatus('Nothing to export with the current filter.');
    return;
  }
  try {
    await download(new Blob([toCsv(list)], { type: 'text/csv;charset=utf-8' }), buildFilename('csv', exportScopeLabel()));
    setStatus(`Exported ${list.length} row${list.length === 1 ? '' : 's'} as .csv`);
    void track('export_csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .csv file.');
  }
});

els.exportMd.addEventListener('click', async () => {
  const list = filteredItems();
  if (!list.length) {
    setStatus('Nothing to export with the current filter.');
    return;
  }
  try {
    await download(new Blob([toMarkdown(list)], { type: 'text/markdown;charset=utf-8' }), buildFilename('md', exportScopeLabel()));
    setStatus(`Exported ${list.length} post${list.length === 1 ? '' : 's'} as .md`);
    void track('export_md');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .md file.');
  }
});

/* ── Data ownership ────────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and clear some history.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());

els.dataExport.addEventListener('click', async () => {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `facebook-group-opportunities-backup-${stamp}.json`);
    setStatus(`Exported ${backup.rules.length} rule(s), ${backup.items.length} post(s)`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
});

els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.rules} rule(s) and ${result.items} post(s)`);
    void track('data_imported');
    notifyRulesChanged();
    await refresh();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every rule and every matched post? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    notifyRulesChanged();
    void refresh();
  });
});

/* ── Usage counters ────────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n') || 'No activity yet.';
  els.stats.showModal();
}

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

/* ── Wiring ────────────────────────────────────────────────────────────── */

els.refresh.addEventListener('click', () => void refresh());

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'FGO_OPPORTUNITY_CAPTURED' || message?.type === 'FGO_SESSION_CAP_REACHED') {
    void refresh();
  }
});

chrome.tabs.onActivated.addListener(() => void refresh());
chrome.tabs.onUpdated.addListener((id, changeInfo) => {
  if (id === tabId && changeInfo.status === 'complete') void refresh();
});

void (async () => {
  void track('panel_opened');
  await refresh();
})();
