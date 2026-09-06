/**
 * Runs on etsy.com pages (manifest matches `*://*.etsy.com/*`) but only ever
 * builds UI on a listing page (PRD §4: "On any listing page"). Everything —
 * the teardown block, the compare tray, saved teardowns, exports — lives in
 * one shadow-DOM overlay so the host page's CSS can't reach it and nothing
 * here can shift the page's own layout.
 *
 * No network requests anywhere in this file or anything it imports — see
 * PRIVACY.md. Exports go through the background worker because content
 * scripts cannot call chrome.downloads directly (see src/background.ts).
 */

import { buildCompareRows, formatPriceRange, tagRecurrence } from './analysis';
import { buildCsv, buildFilename, buildMarkdownAudit, diffSnapshots } from './formatters';
import { extractTeardown } from './extract';
import { track } from './metrics';
import {
  addToTray,
  clearAllData,
  clearTray,
  exportBackup,
  importBackup,
  listSaved,
  quotaStatus,
  readTray,
  removeFromTray,
  removeSaved,
  saveTeardown,
} from './storage';
import { PanelCommand, SavedTeardown, Teardown, TRAY_LIMIT } from './types';
import { isListingUrl, listingIdFromUrl } from './url';

if (isListingUrl(location.href) && window.top === window) {
  void boot();
}

/* ── State ───────────────────────────────────────────────────────────── */

type TabName = 'teardown' | 'compare' | 'saved';

let panelOpen = false;
let activeTab: TabName = 'teardown';
let currentTeardown: Teardown | null = null;
let tray: Teardown[] = [];
let saved: SavedTeardown[] = [];
let currentNote = '';
let statusMessage = '';
let trackedListingId: string | null = null;

/* ── DOM helpers ─────────────────────────────────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === 'className') node.className = value as string;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === 'text') node.textContent = value as string;
    else (node as any)[key] = value;
  }
  for (const child of children) node.append(child);
  return node;
}

function mark(value: boolean | null): string {
  if (value === null) return '—';
  return value ? '✓' : '✗';
}

/* ── Shadow shell ────────────────────────────────────────────────────── */

const UI_ATTR = 'data-ela-ui';
let shadow: ShadowRoot | null = null;
let panelEl: HTMLDivElement | null = null;
let bodyEl: HTMLDivElement | null = null;
let statusEl: HTMLDivElement | null = null;
let toggleBtn: HTMLButtonElement | null = null;

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif; }
  .toggle {
    position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
    width: 44px; height: 44px; border-radius: 50%; border: none;
    background: #1a1a1a; color: #ffd633; font-size: 18px; font-weight: 700;
    cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.3);
  }
  .toggle:focus-visible, .panel :focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }
  .panel {
    position: fixed; right: 16px; bottom: 68px; z-index: 2147483000;
    width: 380px; max-width: calc(100vw - 32px); max-height: 82vh;
    background: #fff; color: #1a1a1a; border: 1px solid rgba(0,0,0,.14);
    border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,.3);
    display: none; flex-direction: column; overflow: hidden;
  }
  .panel--open { display: flex; }
  .head { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-bottom: 1px solid #e6e6e6; }
  .head h1 { font-size: 14px; margin: 0; font-weight: 650; }
  .close { border: none; background: none; font-size: 16px; cursor: pointer; color: #5f6368; padding: 2px 6px; }
  .tabs { display: flex; border-bottom: 1px solid #e6e6e6; }
  .tab { flex: 1; border: none; background: none; padding: 8px 4px; font-size: 12px; color: #5f6368; cursor: pointer; border-bottom: 2px solid transparent; }
  .tab[aria-selected="true"] { color: #1a1a1a; border-bottom-color: #1a73e8; font-weight: 600; }
  .body { padding: 10px 12px; overflow-y: auto; flex: 1; }
  .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .field { margin: 0 0 8px; }
  .field dt { color: #5f6368; font-size: 11px; text-transform: uppercase; letter-spacing: .02em; }
  .field dd { margin: 1px 0 0; }
  .btn { border: 1px solid #dcdcdc; background: #f3f3f3; border-radius: 14px; padding: 5px 10px; font-size: 12px; cursor: pointer; color: #1a1a1a; }
  .btn:hover:not(:disabled) { background: #e8e8e8; }
  .btn:disabled { opacity: .5; cursor: default; }
  .btn--primary { background: #1a1a1a; color: #ffd633; border-color: #1a1a1a; }
  .btn--danger { color: #b3261e; }
  textarea, input[type="text"] { width: 100%; border: 1px solid #dcdcdc; border-radius: 6px; padding: 5px 7px; font: inherit; }
  .status { padding: 6px 12px; font-size: 11px; color: #5f6368; border-top: 1px solid #e6e6e6; min-height: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 11px; }
  th, td { border: 1px solid #e6e6e6; padding: 3px 5px; text-align: left; vertical-align: top; }
  th { background: #f7f7f7; font-weight: 600; }
  .diff { background: #fff6d6; font-weight: 600; }
  .muted { color: #5f6368; }
  .warn { color: #b3261e; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .card { border: 1px solid #e6e6e6; border-radius: 8px; padding: 8px; }
  .card__title { font-weight: 600; margin: 0 0 4px; }
  .empty { color: #5f6368; text-align: center; padding: 20px 8px; }
`;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483000';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
  return shadow;
}

function buildShell(): void {
  const root = ui();

  toggleBtn = el('button', {
    className: 'toggle',
    type: 'button',
    text: 'EA',
    title: 'Etsy Listing Analyzer',
    'aria-label': 'Open Etsy Listing Analyzer',
    'aria-expanded': 'false',
    onClick: () => setPanelOpen(!panelOpen),
  });

  const tabsRow = el('div', { className: 'tabs', role: 'tablist', 'aria-label': 'Etsy Listing Analyzer sections' });
  (['teardown', 'compare', 'saved'] as TabName[]).forEach(name => {
    const tab = el('button', {
      className: 'tab',
      type: 'button',
      role: 'tab',
      id: `ela-tab-${name}`,
      'aria-controls': 'ela-panel-body',
      text: name === 'teardown' ? 'Teardown' : name === 'compare' ? `Compare (${tray.length})` : `Saved (${saved.length})`,
      onClick: () => {
        activeTab = name;
        if (name === 'compare') void track('compare_tray_viewed');
        render();
      },
    });
    tabsRow.appendChild(tab);
  });

  bodyEl = el('div', { className: 'body', id: 'ela-panel-body', role: 'tabpanel', tabIndex: -1 });
  statusEl = el('div', { className: 'status', role: 'status', 'aria-live': 'polite' });

  panelEl = el('div', { className: 'panel', role: 'dialog', 'aria-label': 'Etsy Listing Analyzer' }, [
    el('div', { className: 'head' }, [
      el('h1', { text: 'Etsy Listing Analyzer' }),
      el('button', { className: 'close', type: 'button', 'aria-label': 'Close panel', text: '✕', onClick: () => setPanelOpen(false) }),
    ]),
    tabsRow,
    bodyEl,
    statusEl,
  ]);

  root.appendChild(toggleBtn);
  root.appendChild(panelEl);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panelOpen) setPanelOpen(false);
  });
}

function setPanelOpen(open: boolean): void {
  panelOpen = open;
  panelEl?.classList.toggle('panel--open', open);
  toggleBtn?.setAttribute('aria-expanded', String(open));
  if (open) {
    void track('panel_opened');
    bodyEl?.focus();
  } else {
    toggleBtn?.focus();
  }
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function setStatus(message: string): void {
  statusMessage = message;
  if (statusEl) statusEl.textContent = message;
}

function render(): void {
  if (!bodyEl) return;
  const tabs = shadow?.querySelectorAll('.tab');
  tabs?.forEach(node => {
    const button = node as HTMLButtonElement;
    const name = button.id.replace('ela-tab-', '') as TabName;
    const selected = name === activeTab;
    button.setAttribute('aria-selected', String(selected));
    button.textContent =
      name === 'teardown' ? 'Teardown' : name === 'compare' ? `Compare (${tray.length})` : `Saved (${saved.length})`;
  });

  bodyEl.replaceChildren();
  if (activeTab === 'teardown') bodyEl.appendChild(renderTeardownTab());
  else if (activeTab === 'compare') bodyEl.appendChild(renderCompareTab());
  else bodyEl.appendChild(renderSavedTab());

  if (statusEl) statusEl.textContent = statusMessage;
}

function fieldRow(label: string, value: string): HTMLElement {
  return el('dl', { className: 'field' }, [el('dt', { text: label }), el('dd', { text: value })]);
}

function renderTeardownTab(): HTMLElement {
  if (!currentTeardown) {
    return el('div', { className: 'empty' }, ['Reading this listing…']);
  }
  const t = currentTeardown;
  const already = tray.some(e => e.listingId === t.listingId);
  const trayFull = tray.length >= TRAY_LIMIT && !already;

  const wrap = el('div', {});

  if (t.status.deactivated) wrap.appendChild(el('p', { className: 'warn', text: 'This listing appears to have been removed or deactivated — fields below may be incomplete.' }));
  else if (t.status.soldOut) wrap.appendChild(el('p', { className: 'warn', text: 'Sold out.' }));

  wrap.appendChild(fieldRow('Title', `${t.title.wordCount} words · ${t.title.charCount} chars · keyword front-loaded ${mark(t.title.frontLoaded)}`));
  wrap.appendChild(fieldRow('Tags', `${t.tags.count} of ${t.tags.max} used${t.tags.tags.length ? ` — ${t.tags.tags.join(', ')}` : ' — none shown'}`));
  wrap.appendChild(fieldRow('Photos', `${t.photos.count ?? '—'} · video ${mark(t.photos.hasVideo)}`));
  wrap.appendChild(
    fieldRow('Price', `${formatPriceRange(t.price)} · ${t.price.isDigital ? 'digital download (no shipping)' : `free shipping ${mark(t.price.freeShipping)}`}`)
  );
  wrap.appendChild(fieldRow('Options', `${t.options.variationCount} variation${t.options.variationCount === 1 ? '' : 's'} · personalization ${mark(t.options.hasPersonalization)}`));
  wrap.appendChild(
    fieldRow(
      'Sales',
      `${t.sales.purchases !== null ? t.sales.purchases.toLocaleString() : '—'}` +
        (t.sales.rating !== null ? ` · ★${t.sales.rating.toFixed(1)}${t.sales.reviewCount !== null ? ` (${t.sales.reviewCount.toLocaleString()} reviews)` : ''}` : '')
    )
  );
  wrap.appendChild(
    fieldRow(
      'Shop',
      [t.shop.name, t.shop.establishedYear ? `est. ${t.shop.establishedYear}` : null, t.shop.totalSales !== null ? `${t.shop.totalSales.toLocaleString()} sales` : null, t.shop.location]
        .filter(Boolean)
        .join(' · ') || '—'
    )
  );

  if (t.unavailable.length) {
    wrap.appendChild(el('p', { className: 'muted', text: `Could not read from this page: ${t.unavailable.join(', ')}.` }));
  }

  const actions = el('div', { className: 'row', style: 'margin-top:8px' }, [
    el('button', {
      className: 'btn btn--primary',
      type: 'button',
      text: already ? 'In compare tray' : 'Add to compare',
      disabled: already || trayFull,
      title: trayFull ? `Compare tray holds ${TRAY_LIMIT} listings` : undefined,
      onClick: () => void onAddToTray(),
    }),
    el('button', { className: 'btn', type: 'button', text: 'Export Markdown', onClick: () => void onExportMarkdown([t], { [t.listingId]: currentNote }) }),
  ]);
  wrap.appendChild(actions);

  const noteBox = el('textarea', {
    rows: 2,
    placeholder: 'Note for the saved teardown…',
    value: currentNote,
    oninput: (e: Event) => (currentNote = (e.target as HTMLTextAreaElement).value),
  });
  const saveRow = el('div', { className: 'row', style: 'margin-top:8px' }, [
    el('button', { className: 'btn', type: 'button', text: 'Save teardown', onClick: () => void onSaveTeardown() }),
  ]);
  wrap.appendChild(el('div', { style: 'margin-top:8px' }, [noteBox, saveRow]));

  return wrap;
}

function renderCompareTab(): HTMLElement {
  const wrap = el('div', {});
  if (!tray.length) {
    wrap.appendChild(el('p', { className: 'empty', text: 'Add listings from the Teardown tab to compare them side by side (up to 6).' }));
    return wrap;
  }

  const rows = buildCompareRows(tray);
  const table = el('table', {});
  const head = el('tr', {}, [el('th', { text: 'Field' }), ...tray.map((_, i) => el('th', { text: `#${i + 1}` }))]);
  table.appendChild(el('thead', {}, [head]));
  const body = el('tbody', {});
  for (const row of rows) {
    body.appendChild(el('tr', {}, [el('td', { text: row.label }), ...row.values.map(v => el('td', { className: row.differs ? 'diff' : '', text: v }))]));
  }
  table.appendChild(body);
  wrap.appendChild(table);

  const removeRow = el('div', { className: 'row', style: 'margin-top:8px' });
  tray.forEach((entry, i) => {
    removeRow.appendChild(
      el('button', { className: 'btn', type: 'button', text: `Remove #${i + 1}`, onClick: () => void onRemoveFromTray(entry.listingId) })
    );
  });
  wrap.appendChild(removeRow);

  const recurrence = tagRecurrence(tray.map(e => ({ listingId: e.listingId, tags: e.tags.tags })));
  if (recurrence === null) {
    wrap.appendChild(el('p', { className: 'muted', style: 'margin-top:8px', text: `Compare at least 4 listings to see which tags recur (${tray.length} so far).` }));
  } else if (recurrence.length) {
    wrap.appendChild(el('p', { style: 'margin-top:8px; font-weight:600', text: 'Recurring tags' }));
    const list = el('ul', { style: 'margin:4px 0 0; padding-left:18px' });
    for (const r of recurrence.slice(0, 10)) list.appendChild(el('li', { text: `${r.tag} — ${r.count} of ${r.total}` }));
    wrap.appendChild(list);
  }

  const actions = el('div', { className: 'row', style: 'margin-top:10px' }, [
    el('button', { className: 'btn btn--primary', type: 'button', text: 'Export CSV', onClick: () => void onExportCsv() }),
    el('button', { className: 'btn', type: 'button', text: 'Export Markdown', onClick: () => void onExportMarkdown(tray, {}) }),
    el('button', { className: 'btn btn--danger', type: 'button', text: 'Clear tray', onClick: () => void onClearTray() }),
  ]);
  wrap.appendChild(actions);

  return wrap;
}

function renderSavedTab(): HTMLElement {
  const wrap = el('div', {});
  if (!saved.length) {
    wrap.appendChild(el('p', { className: 'empty', text: 'Save a teardown from the Teardown tab and it will show up here, with a note and what changed on revisit.' }));
  } else {
    const list = el('ul', { className: 'list' });
    for (const record of saved) {
      const latest = record.snapshots[record.snapshots.length - 1];
      const diff = diffSnapshots(record);
      const card = el('li', { className: 'card' }, [
        el('p', { className: 'card__title', text: latest.title.text || record.listingId }),
        el('p', { className: 'muted', text: `${formatPriceRange(latest.price)} · saved ${new Date(record.updatedAt).toISOString().slice(0, 10)}` }),
      ]);
      if (record.note.trim()) card.appendChild(el('p', { text: record.note }));
      if (diff) {
        const bits: string[] = [];
        if (diff.priceChanged) bits.push(`price ${diff.priceFrom} → ${diff.priceTo}`);
        if (diff.salesChanged) bits.push(`purchases ${diff.purchasesFrom ?? '—'} → ${diff.purchasesTo ?? '—'}, reviews ${diff.reviewsFrom ?? '—'} → ${diff.reviewsTo ?? '—'}`);
        if (diff.tagsAdded.length) bits.push(`+tags: ${diff.tagsAdded.join(', ')}`);
        if (diff.tagsRemoved.length) bits.push(`-tags: ${diff.tagsRemoved.join(', ')}`);
        card.appendChild(el('p', { className: bits.length ? '' : 'muted', text: bits.length ? `Changed since last snapshot: ${bits.join(' · ')}` : 'No change since last snapshot.' }));
      }
      const actions = el('div', { className: 'row' }, [
        el('a', { className: 'btn', href: record.listingId ? `https://www.etsy.com/listing/${record.listingId}` : '#', target: '_blank', rel: 'noopener noreferrer', text: 'Open' }),
        el('button', { className: 'btn', type: 'button', text: 'Export Markdown', onClick: () => void onExportMarkdown([latest], { [latest.listingId]: record.note }) }),
        el('button', { className: 'btn btn--danger', type: 'button', text: 'Delete', onClick: () => void onRemoveSaved(record.listingId) }),
      ]);
      card.appendChild(actions);
      list.appendChild(card);
    }
    wrap.appendChild(list);
  }

  const dataRow = el('div', { className: 'row', style: 'margin-top:12px; border-top:1px solid #e6e6e6; padding-top:8px' }, [
    el('button', { className: 'btn', type: 'button', text: 'Export all data', onClick: () => void onExportAllData() }),
    el('button', { className: 'btn', type: 'button', text: 'Import', onClick: () => importInput?.click() }),
    el('button', { className: 'btn btn--danger', type: 'button', text: 'Clear all data', onClick: () => void onClearAllData() }),
  ]);
  wrap.appendChild(dataRow);
  wrap.appendChild(importInput);

  return wrap;
}

const importInput = el('input', {
  type: 'file',
  accept: 'application/json,.json',
  style: 'display:none',
  onChange: (e: Event) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    (e.target as HTMLInputElement).value = '';
    if (file) void onImportData(file);
  },
});

/* ── Actions ─────────────────────────────────────────────────────────── */

async function onAddToTray(): Promise<void> {
  if (!currentTeardown) return;
  const result = await addToTray(currentTeardown);
  tray = result.entries;
  if (result.ok) {
    void track('compare_added');
    setStatus('Added to compare tray.');
  } else {
    setStatus(result.reason ?? 'Could not add to the compare tray.');
  }
  render();
}

async function onRemoveFromTray(listingId: string): Promise<void> {
  tray = await removeFromTray(listingId);
  void track('compare_removed');
  render();
}

async function onClearTray(): Promise<void> {
  if (!confirm('Remove every listing from the compare tray?')) return;
  await clearTray();
  tray = [];
  render();
}

async function onSaveTeardown(): Promise<void> {
  if (!currentTeardown) return;
  await saveTeardown(currentTeardown, currentNote);
  saved = await listSaved();
  void track('teardown_saved');
  setStatus('Teardown saved.');
  render();
}

async function onRemoveSaved(listingId: string): Promise<void> {
  await removeSaved(listingId);
  saved = await listSaved();
  render();
}

async function requestDownload(filename: string, content: string, mimeType: string): Promise<boolean> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: 'ELA_DOWNLOAD', filename, content, mimeType })) as
      | { ok: boolean; error?: string }
      | undefined;
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function onExportCsv(): Promise<void> {
  if (!tray.length) return;
  const ok = await requestDownload(buildFilename('etsy-compare', 'csv'), buildCsv(tray), 'text/csv');
  setStatus(ok ? 'Saved .csv' : 'Could not save the CSV file.');
  if (ok) void track('export_csv');
}

async function onExportMarkdown(entries: Teardown[], notes: Record<string, string>): Promise<void> {
  if (!entries.length) return;
  const base = entries.length === 1 ? entries[0].title.text || entries[0].listingId : 'etsy-compare-audit';
  const ok = await requestDownload(buildFilename(base, 'md'), buildMarkdownAudit(entries, { notes }), 'text/markdown');
  setStatus(ok ? 'Saved .md' : 'Could not save the Markdown file.');
  if (ok) void track('export_md');
}

async function onExportAllData(): Promise<void> {
  const backup = await exportBackup();
  const ok = await requestDownload(`etsy-listing-analyzer-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), 'application/json');
  setStatus(ok ? `Exported ${backup.tray.length} tray listing(s) and ${backup.saved.length} saved teardown(s).` : 'Could not save the backup.');
  if (ok) void track('data_exported');
}

async function onImportData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    tray = await readTray();
    saved = await listSaved();
    void track('data_imported');
    setStatus(`Imported ${result.saved} saved teardown(s), ${result.tray} tray listing(s).`);
    render();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

async function onClearAllData(): Promise<void> {
  if (!confirm('Delete every saved teardown and the compare tray? Export first if you want a copy.')) return;
  await clearAllData();
  tray = [];
  saved = [];
  setStatus('All data cleared.');
  render();
}

/* ── Extraction lifecycle ───────────────────────────────────────────── */

function needsRetry(t: Teardown | null): boolean {
  return !t || t.unavailable.length > 0;
}

function loadTeardown(): void {
  const next = extractTeardown();
  currentTeardown = next;
  if (next && trackedListingId !== next.listingId && !next.unavailable.includes('title')) {
    trackedListingId = next.listingId;
    void track('teardown_viewed');
  }
  if (activeTab === 'teardown') render();
}

async function refreshCollections(): Promise<void> {
  tray = await readTray();
  saved = await listSaved();
  render();
}

async function boot(): Promise<void> {
  buildShell();
  render();
  await refreshCollections();
  loadTeardown();

  // Etsy hydrates price/photos/shop stats slightly after first paint on some
  // templates; retry briefly rather than accept a permanent miss (PRD §6:
  // teardown populated < 300 ms, so these are all inside the first couple of
  // seconds, not a poll loop).
  let attempts = 0;
  const retry = window.setInterval(() => {
    attempts++;
    if (!needsRetry(currentTeardown) || attempts > 6) {
      window.clearInterval(retry);
      return;
    }
    loadTeardown();
  }, 350);

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from the Saved tab.');

  // Etsy can soft-navigate between listings (e.g. related items). Watch for
  // that rather than requiring a full reload.
  let lastId = listingIdFromUrl(location.href);
  window.setInterval(() => {
    const nextId = listingIdFromUrl(location.href);
    if (nextId === lastId) return;
    lastId = nextId;
    currentNote = '';
    loadTeardown();
  }, 800);

  chrome.runtime.onMessage.addListener((message: PanelCommand) => {
    if (message?.type === 'ELA_TOGGLE_PANEL') setPanelOpen(!panelOpen);
  });
}
