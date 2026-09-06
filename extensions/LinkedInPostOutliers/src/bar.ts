/**
 * The injected header strip + filter row (PRD §4: "a single row, no settings
 * page"). Owns no state beyond the DOM: it's handed a FilterState and a
 * summary string, renders them, and reports edits back through callbacks —
 * same shape as the outlier engine's other users (InstagramOutlierFinder's
 * bar.ts, YouTubeProFilters' bar).
 */

import { DaysFilter, FilterState, RatioFilter, SortKey } from './types';

export interface BarCallbacks {
  onChange(next: FilterState): void;
  onExport(format: 'csv' | 'md'): void;
}

const RATIO_OPTIONS: Array<{ value: RatioFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '2x', label: '> 2×' },
  { value: '5x', label: '> 5×' },
];

const DAYS_OPTIONS: Array<{ value: string; label: string; days: DaysFilter }> = [
  { value: '30', label: '30 days', days: 30 },
  { value: '90', label: '90 days', days: 90 },
  { value: 'all', label: 'All loaded', days: null },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'ratio', label: 'Outlier ratio' },
  { value: 'date', label: 'Date' },
  { value: 'engagement', label: 'Engagement' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, className: string): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button';
  node.textContent = label;
  return node;
}

export class OverlayBar {
  readonly root: HTMLElement;

  private filters: FilterState;
  private readonly headerLine: HTMLElement;
  private readonly detailLine: HTMLElement;
  private readonly noticeLine: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly ratioButtons: HTMLButtonElement[] = [];
  private readonly daysButtons: HTMLButtonElement[] = [];
  private sortSelect: HTMLSelectElement | null = null;

  constructor(initial: FilterState, private readonly callbacks: BarCallbacks) {
    this.filters = initial;
    this.root = el('div', 'lpo-bar');

    const header = el('div', 'lpo-bar__header');
    this.headerLine = el('div', 'lpo-header__summary');
    this.detailLine = el('div', 'lpo-header__detail');
    header.append(this.headerLine, this.detailLine);

    const row = el('div', 'lpo-row');
    row.append(
      this.segment('Outlier ratio', RATIO_OPTIONS, this.ratioButtons, value => this.patch({ ratio: value as RatioFilter })),
      this.segment(
        'Window',
        DAYS_OPTIONS.map(o => ({ value: o.value, label: o.label })),
        this.daysButtons,
        value => this.patch({ days: DAYS_OPTIONS.find(o => o.value === value)?.days ?? null })
      ),
      this.sortControl(),
      this.exportControl()
    );

    this.noticeLine = el('div', 'lpo-notice');
    this.noticeLine.hidden = true;
    this.statusLine = el('div', 'lpo-status');

    this.root.append(header, row, this.noticeLine, this.statusLine);
    this.syncInputs();
  }

  setFilters(filters: FilterState): void {
    this.filters = filters;
    this.syncInputs();
  }

  /** headline: PRD §4's two header shapes — single-author or mixed-author page. */
  setSummary(headline: string, detail: string, greyed: boolean): void {
    this.headerLine.textContent = headline;
    this.headerLine.classList.toggle('lpo-header__summary--greyed', greyed);
    this.detailLine.textContent = detail;
  }

  setStatus(shown: number, total: number): void {
    this.statusLine.textContent = total === 0 ? '' : `Showing ${shown} of ${total} loaded posts`;
  }

  showNotice(message: string): void {
    this.noticeLine.textContent = message;
    this.noticeLine.hidden = false;
  }

  clearNotice(): void {
    this.noticeLine.hidden = true;
  }

  private segment(
    label: string,
    options: Array<{ value: string; label: string }>,
    store: HTMLButtonElement[],
    onPick: (value: string) => void
  ): HTMLElement {
    const wrap = el('div', 'lpo-field');
    const labelEl = el('span', 'lpo-label');
    labelEl.textContent = label;
    const group = el('div', 'lpo-segmented');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);

    for (const option of options) {
      const btn = button(option.label, 'lpo-seg');
      btn.dataset.value = option.value;
      btn.setAttribute('aria-pressed', 'false');
      btn.addEventListener('click', () => onPick(option.value));
      group.append(btn);
      store.push(btn);
    }

    wrap.append(labelEl, group);
    return wrap;
  }

  private sortControl(): HTMLElement {
    const wrap = el('label', 'lpo-field lpo-field--sort');
    const labelEl = el('span', 'lpo-label');
    labelEl.textContent = 'Sort';
    const select = document.createElement('select');
    select.className = 'lpo-select';
    for (const option of SORT_OPTIONS) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    select.addEventListener('change', () => this.patch({ sort: select.value as SortKey }));
    this.sortSelect = select;
    wrap.append(labelEl, select);
    return wrap;
  }

  private exportControl(): HTMLElement {
    const wrap = el('div', 'lpo-field lpo-field--export');
    const csv = button('Export .csv', 'lpo-btn');
    const md = button('Export .md', 'lpo-btn');
    csv.addEventListener('click', () => this.callbacks.onExport('csv'));
    md.addEventListener('click', () => this.callbacks.onExport('md'));
    wrap.append(csv, md);
    return wrap;
  }

  private patch(partial: Partial<FilterState>): void {
    this.callbacks.onChange({ ...this.filters, ...partial });
  }

  private syncInputs(): void {
    for (const btn of this.ratioButtons) btn.setAttribute('aria-pressed', String(btn.dataset.value === this.filters.ratio));
    const daysValue = this.filters.days === null ? 'all' : String(this.filters.days);
    for (const btn of this.daysButtons) btn.setAttribute('aria-pressed', String(btn.dataset.value === daysValue));
    if (this.sortSelect) this.sortSelect.value = this.filters.sort;
  }
}
