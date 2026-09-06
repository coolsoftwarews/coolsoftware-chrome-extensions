/**
 * Runs on every page. Three jobs:
 *   1. picking mode — hover highlights a candidate table/list, click selects it
 *   2. parsing — turn the selected DOM into a NormalizedTable (table.ts / heuristics.ts)
 *   3. the preview panel — rows/columns preview, header toggle, CSV/JSON export
 *
 * All UI lives inside one shadow root marked `data-uts-ui`, so the host page's
 * CSS cannot reach it and the picking overlay never causes layout shift on the
 * page itself. Nothing here makes a network request — see PRIVACY.md.
 *
 * chrome.downloads is not available in a content script (a gotcha this
 * portfolio has hit before), so exporting sends a data URL to background.ts,
 * which is the only place that calls chrome.downloads.download.
 */

import { detectRepeatedList } from './heuristics';
import { buildExport, buildFilename, summarizeTable } from './formatters';
import { track } from './metrics';
import { normalizeTable } from './table';
import { CandidateItemSignature, NormalizedTable, PageMeta, PopupToContent, RawCell, RawRow } from './types';
import { isSupportedUrl, siteName } from './url';

const UI_ATTR = 'data-uts-ui';
const MAX_ANCESTOR_DEPTH = 6;
const MIN_LIST_ITEMS = 3;
const PREVIEW_ROW_LIMIT = 15;

const supported = isSupportedUrl(location.href);

function pageMeta(): PageMeta {
  return { url: location.href, title: document.title || 'Untitled page', site: siteName(location.href) };
}

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

const SHADOW_CSS = `
  .outline {
    position: fixed; pointer-events: none; display: none;
    border: 2px solid #34d399; background: rgba(52,211,153,.12);
    border-radius: 4px; z-index: 2147483646;
    transition: top .06s ease, left .06s ease, width .06s ease, height .06s ease;
  }
  @media (prefers-reduced-motion: reduce) { .outline { transition: none; } }
  .hint {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #0f0f0f; color: #fff; padding: 8px 16px; border-radius: 999px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647; display: none;
  }
  .panel {
    position: fixed; right: 16px; bottom: 16px; width: 420px; max-width: calc(100vw - 32px);
    max-height: min(560px, calc(100vh - 32px)); overflow: auto; display: none;
    background: #fff; color: #0f0f0f; border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0,0,0,.28); border: 1px solid rgba(0,0,0,.1);
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .panel--open { display: block; }
  .panel__head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,.08); }
  .panel__title { font-weight: 700; font-size: 14px; margin: 0; }
  .panel__close { border: none; background: none; cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 6px; border-radius: 6px; }
  .panel__close:hover { background: rgba(0,0,0,.06); }
  .panel__body { padding: 12px 14px; }
  .muted { color: #666; }
  .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .row + .row { margin-top: 10px; }
  .btn {
    border: 1px solid rgba(0,0,0,.15); background: #f7f7f7; color: #0f0f0f;
    border-radius: 8px; padding: 6px 12px; font: inherit; font-weight: 600; cursor: pointer;
  }
  .btn:hover { background: #eee; }
  .btn:focus-visible, .panel__close:focus-visible, .check:focus-within { outline: 2px solid #34d399; outline-offset: 2px; }
  .btn--primary { background: #0f0f0f; color: #fff; border-color: #0f0f0f; }
  .btn--primary:hover { background: #262626; }
  .check { display: inline-flex; align-items: center; gap: 6px; cursor: pointer; }
  .banner { background: #fff7e6; border: 1px solid #f0d38a; border-radius: 8px; padding: 8px 10px; margin-top: 10px; font-size: 12px; }
  .banner--error { background: #fdecea; border-color: #f3b4ac; }
  table.preview { border-collapse: collapse; width: 100%; margin-top: 10px; font-size: 12px; }
  table.preview th, table.preview td {
    border: 1px solid rgba(0,0,0,.12); padding: 4px 6px; text-align: left;
    max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  table.preview th { background: #fafafa; font-weight: 700; }
  .preview-wrap { overflow-x: auto; max-height: 220px; overflow-y: auto; }
  .state { text-align: center; padding: 20px 10px; }
  .state p { margin: 6px 0 0; }
`;

/* ── Picking mode ────────────────────────────────────────────────────── */

let picking = false;
let outlineEl: HTMLDivElement | null = null;
let hintEl: HTMLDivElement | null = null;
let currentCandidate: Candidate | null = null;
let rafId: number | null = null;

type Candidate = { kind: 'table'; el: HTMLTableElement } | { kind: 'list'; containerEl: HTMLElement };

function ensureOutline(): HTMLDivElement {
  if (outlineEl) return outlineEl;
  outlineEl = document.createElement('div');
  outlineEl.className = 'outline';
  ui().appendChild(outlineEl);
  return outlineEl;
}

function ensureHint(): HTMLDivElement {
  if (hintEl) return hintEl;
  hintEl = document.createElement('div');
  hintEl.className = 'hint';
  hintEl.setAttribute('role', 'status');
  hintEl.textContent = 'Click a table or a repeated list to select it. Esc to cancel.';
  ui().appendChild(hintEl);
  return hintEl;
}

function elementOf(candidate: Candidate): HTMLElement {
  return candidate.kind === 'table' ? candidate.el : candidate.containerEl;
}

function positionOutline(target: HTMLElement): void {
  const rect = target.getBoundingClientRect();
  const box = ensureOutline();
  box.style.display = 'block';
  box.style.left = `${Math.max(0, rect.left)}px`;
  box.style.top = `${Math.max(0, rect.top)}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
}

/** Cheap, hover-time-only shape check: does this element's parent look like a repeated list? */
function findListContainer(start: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = start;
  for (let depth = 0; depth < MAX_ANCESTOR_DEPTH && node; depth++) {
    const parent: HTMLElement | null = node.parentElement;
    if (parent && parent !== document.body && parent !== document.documentElement) {
      const children = Array.from(parent.children).filter(
        (c: Element) => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(c.tagName)
      ) as HTMLElement[];
      if (children.length >= MIN_LIST_ITEMS) {
        const counts = new Map<string, number>();
        for (const child of children) counts.set(child.tagName, (counts.get(child.tagName) ?? 0) + 1);
        const dominant = Math.max(...counts.values());
        if (dominant / children.length >= 0.6) return parent;
      }
    }
    node = parent;
  }
  return null;
}

function findCandidate(target: HTMLElement): Candidate | null {
  if (target.closest(`[${UI_ATTR}]`)) return null;
  const table = target.closest('table') as HTMLTableElement | null;
  if (table) return { kind: 'table', el: table };
  const container = findListContainer(target);
  if (container) return { kind: 'list', containerEl: container };
  return null;
}

function onPickMouseMove(event: MouseEvent): void {
  if (rafId !== null) return;
  rafId = window.requestAnimationFrame(() => {
    rafId = null;
    const target = event.target as HTMLElement | null;
    if (!target) return;
    const candidate = findCandidate(target);
    currentCandidate = candidate;
    if (candidate) positionOutline(elementOf(candidate));
    else if (outlineEl) outlineEl.style.display = 'none';
  });
}

function onPickClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest(`[${UI_ATTR}]`)) return; // clicks on our own UI pass through
  event.preventDefault();
  event.stopPropagation();
  const candidate = currentCandidate;
  stopPicking();
  if (candidate) void selectCandidate(candidate);
}

function onPickKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') stopPicking();
}

function startPicking(): void {
  if (!supported) return;
  picking = true;
  currentCandidate = null;
  ensureHint().style.display = 'block';
  document.addEventListener('mousemove', onPickMouseMove, true);
  document.addEventListener('click', onPickClick, true);
  document.addEventListener('keydown', onPickKeydown, true);
  void track('pick_started');
}

function stopPicking(): void {
  picking = false;
  currentCandidate = null;
  if (outlineEl) outlineEl.style.display = 'none';
  if (hintEl) hintEl.style.display = 'none';
  document.removeEventListener('mousemove', onPickMouseMove, true);
  document.removeEventListener('click', onPickClick, true);
  document.removeEventListener('keydown', onPickKeydown, true);
}

/* ── Table extraction (DOM → RawRow[]) ──────────────────────────────── */

/** Flattens a nested table's own rows into inline text rather than losing it or exploding the parent grid's column count (PRD §7). */
function cellText(cell: HTMLElement): string {
  const clone = cell.cloneNode(true) as HTMLElement;
  const nestedTables = Array.from(clone.querySelectorAll('table'));
  for (const nested of nestedTables) {
    const flat = Array.from(nested.querySelectorAll('tr'))
      .map(tr =>
        Array.from(tr.children)
          .map(c => (c.textContent || '').trim())
          .filter(Boolean)
          .join(' | ')
      )
      .filter(Boolean)
      .join(' / ');
    nested.replaceWith(document.createTextNode(flat));
  }
  return clone.textContent || '';
}

function extractRawTable(table: HTMLTableElement): RawRow[] {
  const rowEls = Array.from(table.querySelectorAll('tr')).filter(tr => tr.closest('table') === table);
  return rowEls.map(tr => {
    const cellEls = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH') as HTMLElement[];
    return cellEls.map(
      (cell): RawCell => ({
        text: cellText(cell),
        colSpan: Number(cell.getAttribute('colspan')) || 1,
        rowSpan: Number(cell.getAttribute('rowspan')) || 1,
        isHeader: cell.tagName === 'TH',
      })
    );
  });
}

/* ── List extraction (DOM → CandidateItemSignature[]) ───────────────── */

function normalizeClassList(el: Element): string {
  return Array.from(el.classList).sort().join('.');
}

function itemShape(item: HTMLElement): string {
  const childTags = Array.from(item.children).map(c => c.tagName);
  return `${item.tagName}.${normalizeClassList(item)}>${childTags.join(',')}`;
}

function itemFields(item: HTMLElement): Record<string, string> {
  const fields: Record<string, string> = {};
  const children = Array.from(item.children).filter(
    c => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(c.tagName)
  ) as HTMLElement[];
  if (!children.length) {
    fields.field_0 = (item.textContent || '').trim();
    return fields;
  }
  children.forEach((child, i) => {
    fields[`field_${i}`] = (child.textContent || '').trim();
  });
  return fields;
}

function extractListItems(container: HTMLElement): CandidateItemSignature[] {
  const children = Array.from(container.children).filter(
    c => !['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(c.tagName)
  ) as HTMLElement[];
  return children.map(child => ({ shape: itemShape(child), fields: itemFields(child) }));
}

/* ── Selection → preview ─────────────────────────────────────────────── */

interface PreviewState {
  kind: 'table' | 'list';
  sourceRawRows: RawRow[] | null; // table only — lets the header toggle re-normalize live
  table: NormalizedTable;
  lowConfidence?: string; // list only, set when detection refused to export
}

let current: PreviewState | null = null;

async function selectCandidate(candidate: Candidate): Promise<void> {
  if (candidate.kind === 'table') {
    void track('table_selected');
    const rawRows = extractRawTable(candidate.el);
    const table = normalizeTable(rawRows);
    current = { kind: 'table', sourceRawRows: rawRows, table };
    if (table.truncated) void track('row_cap_hit');
    renderPreview();
    return;
  }

  void track('list_selected');
  const items = extractListItems(candidate.containerEl);
  const detection = detectRepeatedList(items);
  if (!detection.confident) {
    void track('list_low_confidence');
    current = {
      kind: 'list',
      sourceRawRows: null,
      table: { headers: [], rows: [], headerInferred: false, truncated: false, totalRowCount: 0 },
      lowConfidence: detection.reason || "This doesn't look like a structured list.",
    };
    renderPreview();
    return;
  }

  const totalRowCount = detection.rows.length;
  const maxRows = 5000;
  const truncated = totalRowCount > maxRows;
  const rows = truncated ? detection.rows.slice(0, maxRows) : detection.rows;
  const headers = detection.columns.map((_, i) => `Column ${i + 1}`);
  if (truncated) void track('row_cap_hit');

  current = {
    kind: 'list',
    sourceRawRows: null,
    table: { headers, rows, headerInferred: false, truncated, totalRowCount },
  };
  renderPreview();
}

/* ── Preview panel ───────────────────────────────────────────────────── */

let panelEl: HTMLDivElement | null = null;

function ensurePanel(): HTMLDivElement {
  if (panelEl) return panelEl;
  panelEl = document.createElement('div');
  panelEl.className = 'panel';
  panelEl.setAttribute('role', 'dialog');
  panelEl.setAttribute('aria-modal', 'false');
  panelEl.setAttribute('aria-label', 'Table Scraper preview');
  ui().appendChild(panelEl);
  panelEl.addEventListener('keydown', event => {
    if (event.key === 'Escape') closePanel();
  });
  return panelEl;
}

function closePanel(): void {
  if (panelEl) panelEl.classList.remove('panel--open');
  current = null;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function renderPreviewTable(table: NormalizedTable): HTMLDivElement {
  const wrap = el('div', { className: 'preview-wrap' });
  const t = el('table', { className: 'preview' });
  const thead = el('thead');
  const headRow = el('tr');
  for (const h of table.headers) headRow.append(el('th', {}, [h || '']));
  thead.append(headRow);
  t.append(thead);

  const tbody = el('tbody');
  const shown = table.rows.slice(0, PREVIEW_ROW_LIMIT);
  for (const row of shown) {
    const tr = el('tr');
    for (const cell of row) tr.append(el('td', { title: cell }, [cell]));
    tbody.append(tr);
  }
  t.append(tbody);
  wrap.append(t);

  if (table.rows.length > shown.length) {
    wrap.append(el('p', { className: 'muted' }, [`…and ${table.rows.length - shown.length} more row(s) in the export.`]));
  }
  return wrap;
}

function renderPreview(): void {
  const panel = ensurePanel();
  panel.replaceChildren();
  if (!current) return;

  const head = el('div', { className: 'panel__head' }, [
    el('p', { className: 'panel__title' }, ['Table Scraper']),
  ]);
  const closeBtn = el('button', { className: 'panel__close', type: 'button' }, ['×']);
  closeBtn.setAttribute('aria-label', 'Close preview');
  closeBtn.addEventListener('click', () => closePanel());
  head.append(closeBtn);

  const body = el('div', { className: 'panel__body' });

  if (current.lowConfidence) {
    const state = el('div', { className: 'state' }, [
      el('p', { className: 'muted' }, ["Couldn't build a table from this selection."]),
      el('p', {}, [current.lowConfidence]),
    ]);
    body.append(state);
    const retryRow = el('div', { className: 'row' });
    const retryBtn = el('button', { className: 'btn btn--primary', type: 'button' }, ['Pick a different one']);
    retryBtn.addEventListener('click', () => {
      closePanel();
      startPicking();
    });
    retryRow.append(retryBtn);
    body.append(retryRow);
  } else {
    const summary = el('p', { className: 'muted' }, [summarizeTable(current.table)]);
    body.append(summary);

    if (current.kind === 'table') {
      const headerRow = el('div', { className: 'row' });
      const label = el('label', { className: 'check' });
      const checkbox = el('input', { type: 'checkbox' }) as HTMLInputElement;
      checkbox.checked = current.table.headerInferred;
      checkbox.addEventListener('change', () => {
        if (!current || !current.sourceRawRows) return;
        current.table = normalizeTable(current.sourceRawRows, { forceHeaderRow: checkbox.checked });
        void track('header_toggle_used');
        renderPreview();
      });
      label.append(checkbox, document.createTextNode('First row is headers'));
      headerRow.append(label);
      body.append(headerRow);
    }

    if (current.table.truncated) {
      body.append(
        el('div', { className: 'banner' }, [
          `Showing the first ${current.table.rows.length.toLocaleString()} of ${current.table.totalRowCount.toLocaleString()} rows — exports are capped for performance.`,
        ])
      );
    }

    body.append(renderPreviewTable(current.table));

    const exportRow = el('div', { className: 'row' });
    const csvBtn = el('button', { className: 'btn btn--primary', type: 'button' }, ['Export CSV']);
    csvBtn.addEventListener('click', () => void doExport('csv'));
    const jsonBtn = el('button', { className: 'btn', type: 'button' }, ['Export JSON']);
    jsonBtn.addEventListener('click', () => void doExport('json'));
    const pickAgainBtn = el('button', { className: 'btn', type: 'button' }, ['Pick a different one']);
    pickAgainBtn.addEventListener('click', () => {
      closePanel();
      startPicking();
    });
    exportRow.append(csvBtn, jsonBtn, pickAgainBtn);
    body.append(exportRow);

    const statusEl = el('p', { className: 'muted' }, ['']);
    statusEl.id = 'uts-status';
    statusEl.setAttribute('role', 'status');
    body.append(statusEl);
  }

  panel.append(head, body);
  panel.classList.add('panel--open');
}

function setStatus(message: string): void {
  const statusEl = panelEl?.querySelector('#uts-status');
  if (statusEl) statusEl.textContent = message;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function doExport(format: 'csv' | 'json'): Promise<void> {
  if (!current || current.lowConfidence) return;
  setStatus('Preparing file…');
  try {
    const { content, mime } = buildExport(current.table, format);
    const blob = new Blob([content], { type: mime });
    const dataUrl = await blobToDataUrl(blob);
    const filename = buildFilename(pageMeta(), format);
    const response = (await chrome.runtime.sendMessage({ type: 'UTS_DOWNLOAD', dataUrl, filename })) as
      | { ok: boolean; error?: string }
      | undefined;
    if (response?.ok) {
      setStatus(`Saved .${format}`);
      void track(format === 'csv' ? 'export_csv' : 'export_json');
    } else {
      setStatus('Could not save the file. Try again.');
    }
  } catch {
    setStatus('Could not build the export. Try again.');
  }
}

/* ── Messaging from the popup ────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PopupToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'UTS_PING':
      sendResponse({ ok: true, supported });
      return false;
    case 'UTS_START_PICK':
      if (supported) startPicking();
      sendResponse({ ok: supported });
      return false;
    default:
      return false;
  }
});
