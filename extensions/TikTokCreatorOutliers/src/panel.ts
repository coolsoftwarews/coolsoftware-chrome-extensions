/**
 * The injected header strip: median/sample/date range, filters, hook panel,
 * export. Owns no state beyond the DOM — it's handed data and reports
 * interactions back through callbacks, same shape as the other extensions in
 * this portfolio.
 */

import { LENGTH_BAND_LABELS } from './filters';
import { DateFilter, DEFAULT_FILTERS, FilterState, HookResult, LengthBand, OutlierSnapshot, RatioFilter, SortKey } from './types';

export interface PanelCallbacks {
  onFilterChange(next: FilterState): void;
  onHookPanelOpen(): void;
  onExport(format: 'csv' | 'md'): void;
}

const RATIO_OPTIONS: Array<{ value: RatioFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: '2x', label: '> 2×' },
  { value: '5x', label: '> 5×' },
];

const DATE_OPTIONS: Array<{ value: DateFilter; label: string }> = [
  { value: 'all', label: 'Any time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
];

const LENGTH_OPTIONS: Array<{ value: LengthBand; label: string }> = [
  { value: 'all', label: 'Any length' },
  { value: 'under15', label: LENGTH_BAND_LABELS.under15 },
  { value: '15to30', label: LENGTH_BAND_LABELS['15to30'] },
  { value: '30to60', label: LENGTH_BAND_LABELS['30to60'] },
  { value: 'over60', label: LENGTH_BAND_LABELS.over60 },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: 'ratio', label: 'Ratio' },
  { value: 'views', label: 'Views' },
  { value: 'date', label: 'Date' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function chip(label: string, className: string): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button';
  node.textContent = label;
  return node;
}

export class OutlierPanel {
  readonly root: HTMLElement;

  private filters: FilterState = { ...DEFAULT_FILTERS };
  private readonly headerLine: HTMLElement;
  private readonly notice: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly ratioRow: HTMLElement;
  private readonly dateRow: HTMLElement;
  private readonly lengthRow: HTMLElement;
  private readonly sortSelect: HTMLSelectElement;
  private readonly hookBody: HTMLElement;
  private hookOpen = false;

  constructor(private readonly callbacks: PanelCallbacks) {
    this.root = el('div', 'tco-panel');

    this.headerLine = el('div', 'tco-header');
    this.notice = el('div', 'tco-notice');
    this.notice.hidden = true;

    const filterHeader = el('div', 'tco-row tco-row--header');
    const sortWrap = el('label', 'tco-field tco-field--sort');
    sortWrap.append(this.labelText('Sort'));
    this.sortSelect = document.createElement('select');
    this.sortSelect.className = 'tco-select';
    for (const option of SORT_OPTIONS) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      this.sortSelect.append(node);
    }
    this.sortSelect.addEventListener('change', () => this.patch({ sort: this.sortSelect.value as SortKey }));
    sortWrap.append(this.sortSelect);
    filterHeader.append(sortWrap);

    this.ratioRow = this.chipRow('Outlier ratio', RATIO_OPTIONS, value => this.patch({ ratio: value as RatioFilter }));
    this.dateRow = this.chipRow('Posted', DATE_OPTIONS, value => this.patch({ date: value as DateFilter }));
    this.lengthRow = this.chipRow('Length', LENGTH_OPTIONS, value => this.patch({ length: value as LengthBand }));

    this.statusLine = el('div', 'tco-status');

    const exportRow = el('div', 'tco-row tco-row--export');
    const csvButton = chip('Export CSV', 'tco-btn');
    csvButton.addEventListener('click', () => this.callbacks.onExport('csv'));
    const mdButton = chip('Export Markdown', 'tco-btn');
    mdButton.addEventListener('click', () => this.callbacks.onExport('md'));
    exportRow.append(csvButton, mdButton);

    const hookToggle = chip('Hook panel ▾', 'tco-btn tco-btn--hook');
    hookToggle.setAttribute('aria-expanded', 'false');
    hookToggle.addEventListener('click', () => {
      this.hookOpen = !this.hookOpen;
      hookToggle.setAttribute('aria-expanded', String(this.hookOpen));
      hookToggle.textContent = this.hookOpen ? 'Hook panel ▴' : 'Hook panel ▾';
      this.hookBody.hidden = !this.hookOpen;
      if (this.hookOpen) this.callbacks.onHookPanelOpen();
    });
    exportRow.append(hookToggle);

    this.hookBody = el('div', 'tco-hook');
    this.hookBody.hidden = true;

    this.root.append(
      this.headerLine,
      this.notice,
      filterHeader,
      this.ratioRow,
      this.dateRow,
      this.lengthRow,
      this.statusLine,
      exportRow,
      this.hookBody
    );
  }

  private labelText(text: string): HTMLElement {
    const node = el('span', 'tco-label');
    node.textContent = text;
    return node;
  }

  private chipRow(
    label: string,
    options: Array<{ value: string; label: string }>,
    onPick: (value: string) => void
  ): HTMLElement {
    const row = el('div', 'tco-row');
    row.append(this.labelText(label));
    const group = el('div', 'tco-chips');
    group.dataset.tcoGroup = label;
    for (const option of options) {
      const button = chip(option.label, 'tco-chip');
      button.dataset.tcoValue = option.value;
      button.addEventListener('click', () => onPick(option.value));
      group.append(button);
    }
    row.append(group);
    return row;
  }

  private patch(partial: Partial<FilterState>): void {
    this.callbacks.onFilterChange({ ...this.filters, ...partial });
  }

  setFilters(filters: FilterState): void {
    this.filters = filters;
    this.sortSelect.value = filters.sort;
    this.syncChips(this.ratioRow, filters.ratio);
    this.syncChips(this.dateRow, filters.date);
    this.syncChips(this.lengthRow, filters.length);
  }

  private syncChips(row: HTMLElement, active: string): void {
    row.querySelectorAll<HTMLButtonElement>('.tco-chip').forEach(node => {
      node.classList.toggle('tco-chip--on', node.dataset.tcoValue === active);
    });
  }

  /** Header strip per PRD §4's example: "Median: 24K views (of 36 loaded)". */
  setSnapshot(snapshot: OutlierSnapshot): void {
    if (snapshot.median === null) {
      this.headerLine.textContent = `Median: not enough data (of ${snapshot.loadedCount} loaded)`;
    } else {
      const label = snapshot.median.toLocaleString('en-US');
      this.headerLine.textContent = `Median: ${label} views (of ${snapshot.sampleSize} loaded)`;
    }
    this.headerLine.classList.toggle('tco-header--low-sample', snapshot.lowSample);
    if (snapshot.lowSample) {
      this.headerLine.title = 'Fewer than 12 videos loaded — scroll down for a more reliable median.';
    } else {
      this.headerLine.removeAttribute('title');
    }
  }

  setParseFailure(failed: boolean): void {
    this.notice.hidden = !failed;
    if (failed) {
      this.notice.textContent =
        "Couldn't read this profile's videos — TikTok may have changed its layout. Try refreshing.";
    }
  }

  setStatus(shown: number, total: number): void {
    this.statusLine.textContent = total === 0 ? 'No videos loaded yet.' : `Showing ${shown} of ${total} loaded videos.`;
  }

  setHookResult(result: HookResult): void {
    this.hookBody.replaceChildren();

    if (!result.sufficientData) {
      const notice = el('p', 'tco-hook__empty');
      notice.textContent = `Not enough outliers yet to say anything reliable — need at least ${result.minimumRequired}, have ${result.outlierCount}.`;
      this.hookBody.append(notice);
      return;
    }

    if (result.observations.length === 0) {
      const notice = el('p', 'tco-hook__empty');
      notice.textContent = 'No shared pattern stood out across these outliers.';
      this.hookBody.append(notice);
      return;
    }

    const list = el('ul', 'tco-hook__list');
    for (const observation of result.observations) {
      const item = document.createElement('li');
      item.textContent = observation;
      list.append(item);
    }
    this.hookBody.append(list);
  }
}
