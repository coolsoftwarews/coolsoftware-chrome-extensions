/**
 * The toolbar popup: rules, starter packs, and the data-ownership surface.
 *
 * A popup, not a side panel — the PRD's permission budget is `storage` plus
 * the two X host permissions and nothing else, so there is no `sidePanel`
 * permission to spend on a persistent panel. Every open is a fresh page load
 * (MV3 popups are torn down on close), which is why `refresh()` re-reads
 * everything from storage and re-asks the content script for tab status on
 * every open rather than caching state across opens.
 *
 * The popup owns no post data of its own — content.ts never reports back
 * which posts it hid (that would mean storing X post text off the page,
 * which this product deliberately never does); it only reports counts and
 * a "this rule looks too broad" flag. Rules themselves are read directly
 * from chrome.storage.local, the same shape content.ts writes to when it
 * bumps a hit count.
 */

import { isXUrl } from './x-url';
import { track, readMetrics, clearMetrics, hiddenToday } from './metrics';
import {
  clearAllData,
  exportBackup,
  importBackup,
  mutateRules,
  newRuleId,
  quotaStatus,
  readRules,
} from './storage';
import { isUsableRule, isValidPattern } from './rules';
import { STARTER_PACKS } from './starter-packs';
import { ContentToPanel, Rule, RuleMode, TabStatus } from './types';

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
  broadWarning: $('broad-warning'),
  broadWarningText: $('broad-warning-text'),
  broadWarningDismiss: $<HTMLButtonElement>('broad-warning-dismiss'),
  ruleList: $<HTMLUListElement>('rule-list'),
  ruleEmpty: $('rule-empty'),
  ruleAdd: $<HTMLButtonElement>('rule-add'),
  starterPacks: $('starter-packs'),
  ruleForm: $<HTMLDialogElement>('rule-form'),
  ruleFormTitle: $('rule-form-title'),
  ruleFields: $<HTMLFormElement>('rule-fields'),
  rfValue: $<HTMLInputElement>('rf-value'),
  rfLabel: $<HTMLInputElement>('rf-label'),
  rfCase: $<HTMLInputElement>('rf-case'),
  rfError: $('rf-error'),
  rfCancel: $<HTMLButtonElement>('rf-cancel'),
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
  statsSummary: $('stats-summary'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let tabId: number | null = null;
let tabUrl: string | undefined;
let rules: Rule[] = [];
let editingRuleId: string | null = null;

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Gate ─────────────────────────────────────────────────────────────── */

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
    return (await chrome.tabs.sendMessage(tabId, { type: 'XKM_GET_TAB_STATUS' })) as TabStatus;
  } catch {
    return null;
  }
}

function notifyRulesChanged(): void {
  if (tabId === null) return;
  void chrome.tabs.sendMessage(tabId, { type: 'XKM_RULES_CHANGED' }).catch(() => undefined);
}

/* ── Load + refresh ────────────────────────────────────────────────────── */

async function refresh(): Promise<void> {
  const tab = await activeTab();
  tabId = tab?.id ?? null;
  tabUrl = tab?.url;

  if (!isXUrl(tabUrl)) {
    showGate('Open X (Twitter)', 'This extension only reads posts already rendered in your X timeline. Open x.com and come back.');
    return;
  }

  const status = await askTabStatus();
  if (!status) {
    showGate(
      'Reload this tab first',
      'This tab was open before the extension was installed or updated, so it has no filter running in it yet. One reload and it is ready.',
      'Reload the tab',
      () => {
        if (tabId !== null) void chrome.tabs.reload(tabId);
      },
    );
    return;
  }

  hideGate();
  els.tabStatus.textContent = `${status.sessionHiddenCount} hidden of ${status.sessionScanned} scanned this session`;

  rules = await readRules();
  renderRules();
}

/* ── Rules ─────────────────────────────────────────────────────────────── */

const MODE_LABEL: Record<RuleMode, string> = { substring: 'Substring', 'whole-word': 'Whole word', regex: 'Regex' };

function summarizeRule(rule: Rule): string {
  const parts = [rule.caseSensitive ? 'Case-sensitive' : 'Case-insensitive'];
  parts.push(`${rule.hitCount} hidden all-time`);
  return parts.join('  ·  ');
}

function renderRules(): void {
  els.ruleList.replaceChildren();
  els.ruleEmpty.hidden = rules.length > 0;

  for (const rule of rules) {
    const li = document.createElement('li');
    li.className = 'rule';

    const head = document.createElement('div');
    head.className = 'rule__head';

    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = rule.enabled;
    toggle.setAttribute('aria-label', `Enable rule ${rule.label || rule.value}`);
    toggle.addEventListener('change', () => void toggleRule(rule.id, toggle.checked));

    const value = document.createElement('span');
    value.className = 'rule__value';
    value.textContent = rule.label.trim() || rule.value;
    value.title = rule.value;

    const modeChip = document.createElement('span');
    modeChip.className = 'rule__mode';
    modeChip.textContent = MODE_LABEL[rule.mode];

    head.append(toggle, value, modeChip);
    li.appendChild(head);

    const summaryEl = document.createElement('p');
    summaryEl.className = 'rule__summary';
    summaryEl.textContent = summarizeRule(rule);
    li.appendChild(summaryEl);

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
  const existing = new Set(rules.map(r => `${r.value.toLowerCase()}::${r.mode}`));
  for (const pack of STARTER_PACKS) {
    const allPresent = pack.rules.every(r => existing.has(`${r.value.toLowerCase()}::${r.mode}`));
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'starter-pack';
    btn.textContent = allPresent ? `✓ ${pack.label}` : `+ ${pack.label}`;
    btn.disabled = allPresent;
    btn.title = pack.description;
    btn.addEventListener('click', () => void addStarterPack(pack.id));
    els.starterPacks.appendChild(btn);
  }
}

async function addStarterPack(packId: string): Promise<void> {
  const pack = STARTER_PACKS.find(p => p.id === packId);
  if (!pack) return;
  const existing = new Set(rules.map(r => `${r.value.toLowerCase()}::${r.mode}`));
  let added = 0;
  await mutateRules(list => {
    for (const packRule of pack.rules) {
      const key = `${packRule.value.toLowerCase()}::${packRule.mode}`;
      if (existing.has(key)) continue;
      list.push({
        id: newRuleId(),
        value: packRule.value,
        label: '',
        mode: packRule.mode,
        caseSensitive: packRule.caseSensitive,
        enabled: true,
        createdAt: Date.now(),
        hitCount: 0,
      });
      existing.add(key);
      added++;
    }
  });
  void track('starter_pack_used');
  notifyRulesChanged();
  setStatus(added ? `Added ${added} rule(s) from "${pack.label}"` : `"${pack.label}" is already fully enabled`);
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
  if (!confirm('Delete this rule? Posts already hidden this session stay hidden until you reload the tab.')) return;
  await mutateRules(list => {
    const index = list.findIndex(r => r.id === id);
    if (index !== -1) list.splice(index, 1);
  });
  void track('rule_deleted');
  notifyRulesChanged();
  await refresh();
}

function selectedMode(): RuleMode {
  const checked = els.ruleFields.querySelector<HTMLInputElement>('input[name="rf-mode"]:checked');
  return (checked?.value as RuleMode) ?? 'substring';
}

function setMode(mode: RuleMode): void {
  const input = els.ruleFields.querySelector<HTMLInputElement>(`input[name="rf-mode"][value="${mode}"]`);
  if (input) input.checked = true;
}

function openRuleForm(rule?: Rule): void {
  editingRuleId = rule?.id ?? null;
  els.ruleFormTitle.textContent = rule ? 'Edit rule' : 'New rule';
  els.rfValue.value = rule?.value ?? '';
  els.rfLabel.value = rule?.label ?? '';
  setMode(rule?.mode ?? 'substring');
  els.rfCase.checked = rule?.caseSensitive ?? false;
  els.rfError.hidden = true;
  els.ruleForm.showModal();
  els.rfValue.focus();
}

els.ruleFields.addEventListener('submit', event => {
  event.preventDefault();
  void saveRuleForm();
});

async function saveRuleForm(): Promise<void> {
  const value = els.rfValue.value.trim();
  const label = els.rfLabel.value.trim();
  const mode = selectedMode();
  const caseSensitive = els.rfCase.checked;

  if (!isUsableRule({ value })) {
    els.rfError.textContent = 'Enter a keyword, phrase, or pattern to match.';
    els.rfError.hidden = false;
    return;
  }
  if (mode === 'regex' && !isValidPattern({ value, mode, caseSensitive })) {
    els.rfError.textContent = 'That is not a valid regular expression.';
    els.rfError.hidden = false;
    return;
  }

  if (editingRuleId) {
    await mutateRules(list => {
      const rule = list.find(r => r.id === editingRuleId);
      if (rule) Object.assign(rule, { value, label, mode, caseSensitive });
    });
    void track('rule_edited');
  } else {
    const rule: Rule = {
      id: newRuleId(),
      value,
      label,
      mode,
      caseSensitive,
      enabled: true,
      createdAt: Date.now(),
      hitCount: 0,
    };
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

/* ── Too-broad warning banner ─────────────────────────────────────────── */

function showBroadWarning(message: string): void {
  els.broadWarningText.textContent = message;
  els.broadWarning.hidden = false;
}

els.broadWarningDismiss.addEventListener('click', () => {
  els.broadWarning.hidden = true;
});

/* ── Data ownership ────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your rules and clear some history.`
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
    await download(blob, `x-keyword-mute-rules-${stamp}.json`);
    setStatus(`Exported ${backup.rules.length} rule(s)`);
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the export.');
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
    setStatus(`Imported ${result.rules} rule(s)`);
    void track('data_imported');
    notifyRulesChanged();
    await refresh();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every rule? Export first if you want a copy.')) return;
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
  const activeRules = rules.filter(r => r.enabled).length;
  els.statsSummary.textContent = `Rules active: ${activeRules}  ·  Posts hidden today: ${hiddenToday(metrics)}`;
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

// Live updates while the popup happens to stay open (e.g. pinned/detached) —
// harmless best-effort, not load-bearing, since a normal popup closes on blur.
chrome.runtime.onMessage.addListener((message: ContentToPanel) => {
  if (message?.type === 'XKM_POST_HIDDEN') {
    void refresh();
  } else if (message?.type === 'XKM_RULE_FLAGGED_BROAD') {
    showBroadWarning(
      `"${message.label}" has hidden ${message.hits} of the last ${message.scanned} posts you scrolled past — check that rule?`,
    );
  }
});

void (async () => {
  void track('panel_opened');
  await refresh();
})();
