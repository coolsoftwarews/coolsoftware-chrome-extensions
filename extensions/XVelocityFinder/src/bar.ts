/**
 * The injected filter bar (PRD §4: "injected once, at the top"). Owns no
 * state beyond its own DOM — it is handed a FilterSettings, renders it, and
 * reports edits back through callbacks. content.ts is the single writer.
 */

import { hasActiveFilters } from './velocity';
import { AgeBand, ExportFormat, FilterSettings, SortMode } from './types';

export interface BarCallbacks {
  onChange(next: FilterSettings): void;
  onClear(): void;
  onSortChange(sort: SortMode): void;
  onExport(format: ExportFormat): void;
}

const AGE_BANDS: Array<{ value: AgeBand; label: string }> = [
  { value: 'any', label: 'Any age' },
  { value: '1h', label: '< 1h' },
  { value: '6h', label: '< 6h' },
  { value: '24h', label: '< 24h' },
];

export class FilterBar {
  readonly root: HTMLElement;

  private filters: FilterSettings;
  private readonly summary: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly statusLine: HTMLElement;
  private readonly sortToggle: HTMLButtonElement;
  private sortMode: SortMode = 'default';

  constructor(initial: FilterSettings, private readonly callbacks: BarCallbacks, private readonly searchPage: boolean) {
    this.filters = initial;
    this.root = el('div', 'xvf-bar');

    const header = el('div', 'xvf-bar__header');
    const toggle = button('Velocity filters', 'xvf-bar__toggle');
    this.summary = el('span', 'xvf-bar__summary');
    const clear = button('Clear', 'xvf-btn xvf-btn--ghost');

    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const open = this.root.classList.toggle('xvf-bar--open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    clear.addEventListener('click', () => this.callbacks.onClear());

    this.sortToggle = button('Sort by velocity', 'xvf-btn');
    this.sortToggle.hidden = !searchPage;
    this.sortToggle.setAttribute('aria-pressed', 'false');
    this.sortToggle.addEventListener('click', () => {
      this.sortMode = this.sortMode === 'velocity' ? 'default' : 'velocity';
      this.sortToggle.setAttribute('aria-pressed', String(this.sortMode === 'velocity'));
      this.sortToggle.classList.toggle('xvf-btn--on', this.sortMode === 'velocity');
      this.callbacks.onSortChange(this.sortMode);
    });

    header.append(toggle, this.summary, spacer(), this.sortToggle, clear);

    this.panel = el('div', 'xvf-panel');
    this.statusLine = el('div', 'xvf-status');

    this.root.append(header, this.panel, this.statusLine);
    this.buildPanel();
    this.syncInputs();
  }

  setFilters(filters: FilterSettings): void {
    this.filters = filters;
    this.syncInputs();
    const active = hasActiveFilters(filters);
    this.summary.textContent = active ? 'Active' : 'None active';
    this.root.classList.toggle('xvf-bar--active', active);
  }

  setStatus(shown: number, total: number): void {
    this.statusLine.replaceChildren();
    if (total === 0) return;

    const text = el('span', 'xvf-status__text');
    text.textContent =
      shown === total
        ? `${total} post${total === 1 ? '' : 's'} on screen.`
        : `Showing ${shown} of ${total} posts.`;
    this.statusLine.append(text);

    if (hasActiveFilters(this.filters) && shown === 0) {
      const loosen = button('Loosen filters', 'xvf-btn xvf-btn--link');
      loosen.addEventListener('click', () => this.callbacks.onClear());
      this.statusLine.append(loosen);
    }
  }

  private buildPanel(): void {
    const formula = el('p', 'xvf-formula');
    formula.textContent = 'Velocity = (likes + reposts + replies) ÷ hours since posting.';

    const numericRow = el('div', 'xvf-row xvf-row--grid');
    numericRow.append(this.numberField('Min velocity (/h)', 'minVelocity'), this.numberField('Min ratio (×)', 'minRatio'));

    const ageRow = el('div', 'xvf-row');
    ageRow.append(labelText('Age'));
    const ageGroup = el('div', 'xvf-chips');
    for (const band of AGE_BANDS) {
      const chip = button(band.label, 'xvf-chip');
      chip.dataset.xvfAge = band.value;
      chip.addEventListener('click', () => this.patch({ ageBand: band.value }));
      ageGroup.append(chip);
    }
    ageRow.append(ageGroup);

    const modeRow = el('div', 'xvf-row');
    modeRow.append(labelText('Below-threshold posts'), this.modeToggle(), spacer(), this.exportControls());

    this.panel.append(formula, numericRow, ageRow, modeRow);
  }

  private numberField(label: string, key: 'minVelocity' | 'minRatio'): HTMLElement {
    const wrap = el('label', 'xvf-field');
    wrap.append(labelText(label));
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = key === 'minRatio' ? '0.1' : '1';
    input.className = 'xvf-input';
    input.dataset.xvf = key;
    const commit = () => {
      const raw = input.value.trim();
      const value = raw === '' ? null : Number(raw);
      this.patch({ [key]: value !== null && Number.isFinite(value) ? value : null } as Partial<FilterSettings>);
    };
    input.addEventListener('input', debounce(commit, 200));
    input.addEventListener('keydown', event => event.stopPropagation());
    wrap.append(input);
    return wrap;
  }

  private modeToggle(): HTMLElement {
    const wrap = el('div', 'xvf-segmented');
    const dim = button('Dim', 'xvf-seg');
    const hide = button('Hide', 'xvf-seg');
    dim.dataset.xvfMode = 'dim';
    hide.dataset.xvfMode = 'hide';
    dim.addEventListener('click', () => this.patch({ mode: 'dim' }));
    hide.addEventListener('click', () => this.patch({ mode: 'hide' }));
    wrap.append(dim, hide);
    return wrap;
  }

  private exportControls(): HTMLElement {
    const wrap = el('div', 'xvf-export');
    const csv = button('Export CSV', 'xvf-btn');
    const md = button('Export Markdown', 'xvf-btn');
    csv.addEventListener('click', () => this.callbacks.onExport('csv'));
    md.addEventListener('click', () => this.callbacks.onExport('md'));
    wrap.append(csv, md);
    return wrap;
  }

  private patch(partial: Partial<FilterSettings>): void {
    this.callbacks.onChange({ ...this.filters, ...partial });
  }

  private syncInputs(): void {
    for (const chip of this.panel.querySelectorAll<HTMLElement>('[data-xvf-age]')) {
      chip.classList.toggle('xvf-chip--on', chip.dataset.xvfAge === this.filters.ageBand);
    }
    for (const seg of this.panel.querySelectorAll<HTMLElement>('[data-xvf-mode]')) {
      seg.classList.toggle('xvf-seg--on', seg.dataset.xvfMode === this.filters.mode);
    }
    for (const input of this.panel.querySelectorAll<HTMLInputElement>('[data-xvf]')) {
      const key = input.dataset.xvf as keyof FilterSettings;
      if (document.activeElement === input) continue; // don't fight the caret mid-typing
      const value = this.filters[key];
      input.value = value === null || value === undefined ? '' : String(value);
    }
  }
}

/* ── Small DOM helpers ────────────────────────────────────────────────── */

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(labelStr: string, className: string): HTMLButtonElement {
  const node = el('button', className);
  node.type = 'button';
  node.textContent = labelStr;
  return node;
}

function labelText(value: string): HTMLElement {
  const node = el('span', 'xvf-label');
  node.textContent = value;
  return node;
}

function spacer(): HTMLElement {
  return el('span', 'xvf-spacer');
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined;
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}
