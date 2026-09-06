import { activeFilterKeys } from '../lib/filters';
import { builtInPresets } from '../lib/presets';
import { EMPTY_FILTERS, type DatePreset, type FilterState, type Preset, type SortKey } from '../types';

/**
 * The injected filter bar. Owns no state of its own beyond the DOM: it is
 * handed a FilterState, renders it, and reports edits back through callbacks.
 */

export interface BarCallbacks {
  onChange(next: FilterState): void;
  onClear(): void;
  onPresetUsed(preset: Preset): void;
  onSavePreset(name: string): void;
  onDeletePreset(id: string): void;
}

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: '24h', label: 'Last 24h' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
  { value: 'custom', label: 'Custom…' },
];

const SORTS: Array<{ value: SortKey; label: string }> = [
  { value: 'relevance', label: "YouTube's order" },
  { value: 'vpd', label: 'Views / day' },
  { value: 'views', label: 'Views' },
  { value: 'date', label: 'Newest' },
  { value: 'outlier', label: 'Outlier ratio' },
];

export class FilterBar {
  readonly root: HTMLElement;

  private filters: FilterState = { ...EMPTY_FILTERS };
  private userPresets: Preset[] = [];
  private readonly summary: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly presetRow: HTMLElement;
  private readonly statusLine: HTMLElement;

  constructor(private readonly callbacks: BarCallbacks) {
    this.root = el('div', 'ypf-bar');

    const header = el('div', 'ypf-bar__header');
    const toggle = button('Filters', 'ypf-bar__toggle');
    this.summary = el('span', 'ypf-bar__summary');
    const clear = button('Clear', 'ypf-btn ypf-btn--ghost');

    toggle.addEventListener('click', () => {
      const open = this.root.classList.toggle('ypf-bar--open');
      toggle.setAttribute('aria-expanded', String(open));
    });
    toggle.setAttribute('aria-expanded', 'false');
    clear.addEventListener('click', () => this.callbacks.onClear());

    header.append(toggle, this.summary, spacer(), this.sortControl(), clear);

    this.presetRow = el('div', 'ypf-presets');
    this.panel = el('div', 'ypf-panel');
    this.statusLine = el('div', 'ypf-status');

    this.root.append(header, this.presetRow, this.panel, this.statusLine);
    this.buildPanel();
  }

  setUserPresets(presets: Preset[]): void {
    this.userPresets = presets;
    this.renderPresets();
  }

  /** Re-renders every control from the given state. Cheap enough to call on each change. */
  setFilters(filters: FilterState): void {
    this.filters = filters;
    this.syncInputs();
    const active = activeFilterKeys(filters);
    this.summary.textContent = active.length === 0 ? 'None active' : `${active.length} active`;
    this.root.classList.toggle('ypf-bar--active', active.length > 0);
  }

  /** The one-line result count under the bar, plus the empty-state escape hatch (§6). */
  setStatus(shown: number, total: number, pendingChannels: number): void {
    this.statusLine.replaceChildren();
    if (activeFilterKeys(this.filters).length === 0 && this.filters.sort === 'relevance') return;

    const text = el('span', 'ypf-status__text');
    text.textContent =
      shown === 0 ? 'No results match your filters.' : `Showing ${shown} of ${total} results.`;
    this.statusLine.append(text);

    if (pendingChannels > 0) {
      const loading = el('span', 'ypf-status__pending');
      loading.textContent = `Loading channel data for ${pendingChannels}…`;
      this.statusLine.append(loading);
    }

    if (shown === 0) {
      const loosen = button('Loosen filters', 'ypf-btn ypf-btn--link');
      loosen.addEventListener('click', () => this.callbacks.onClear());
      this.statusLine.append(loosen);
    }
  }

  private sortControl(): HTMLElement {
    const wrap = el('label', 'ypf-field ypf-field--sort');
    wrap.append(labelText('Sort'));
    const select = document.createElement('select');
    select.className = 'ypf-select';
    select.dataset.ypf = 'sort';
    for (const option of SORTS) {
      const node = document.createElement('option');
      node.value = option.value;
      node.textContent = option.label;
      select.append(node);
    }
    select.addEventListener('change', () => this.patch({ sort: select.value as SortKey }));
    wrap.append(select);
    return wrap;
  }

  private buildPanel(): void {
    const dateRow = el('div', 'ypf-row');
    dateRow.append(labelText('Published'));
    const dateGroup = el('div', 'ypf-chips');
    for (const option of DATE_PRESETS) {
      const chip = button(option.label, 'ypf-chip');
      chip.dataset.ypfDate = option.value;
      chip.addEventListener('click', () => this.patch({ datePreset: option.value }));
      dateGroup.append(chip);
    }
    dateRow.append(dateGroup);

    const customRow = el('div', 'ypf-row ypf-row--custom-date');
    customRow.append(
      labelText('Between'),
      this.dateInput('dateFrom'),
      labelText('and'),
      this.dateInput('dateTo'),
    );

    const numericRow = el('div', 'ypf-row ypf-row--grid');
    numericRow.append(
      this.rangeField('Views', 'viewsMin', 'viewsMax'),
      this.rangeField('Views / day', 'vpdMin', 'vpdMax'),
      this.rangeField('Subscribers', 'subsMin', 'subsMax'),
      this.rangeField('Duration (min)', 'durationMinMinutes', 'durationMaxMinutes'),
    );

    const kindRow = el('div', 'ypf-row');
    kindRow.append(
      this.checkbox('Exclude Shorts', 'excludeShorts'),
      this.checkbox('Exclude live & upcoming', 'excludeLive'),
      spacer(),
      this.savePresetControl(),
    );

    this.panel.append(dateRow, customRow, numericRow, kindRow);
  }

  private savePresetControl(): HTMLElement {
    const wrap = el('div', 'ypf-save');
    const input = document.createElement('input');
    input.className = 'ypf-input ypf-input--name';
    input.placeholder = 'Preset name';
    input.maxLength = 40;

    const save = button('Save preset', 'ypf-btn');
    const commit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.callbacks.onSavePreset(name);
      input.value = '';
    };
    save.addEventListener('click', commit);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') commit();
      // YouTube listens for bare keys as global shortcuts; without this a
      // preset named "kite" would pause the page and jump the player.
      event.stopPropagation();
    });

    wrap.append(input, save);
    return wrap;
  }

  private dateInput(key: 'dateFrom' | 'dateTo'): HTMLElement {
    const input = document.createElement('input');
    input.type = 'date';
    input.className = 'ypf-input ypf-input--date';
    input.dataset.ypf = key;
    input.addEventListener('change', () =>
      this.patch({ [key]: input.value || null, datePreset: 'custom' } as Partial<FilterState>),
    );
    return input;
  }

  private rangeField(
    label: string,
    minKey: keyof FilterState,
    maxKey: keyof FilterState,
  ): HTMLElement {
    const wrap = el('div', 'ypf-field');
    wrap.append(labelText(label));
    const pair = el('div', 'ypf-pair');
    pair.append(this.numberInput(minKey, 'Min'), this.numberInput(maxKey, 'Max'));
    wrap.append(pair);
    return wrap;
  }

  private numberInput(key: keyof FilterState, placeholder: string): HTMLElement {
    const input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.className = 'ypf-input ypf-input--num';
    input.placeholder = placeholder;
    input.dataset.ypf = String(key);

    const commit = () => {
      const raw = input.value.trim();
      const value = raw === '' ? null : Number(raw);
      this.patch({ [key]: value !== null && Number.isFinite(value) ? value : null } as Partial<FilterState>);
    };
    input.addEventListener('input', debounce(commit, 200));
    input.addEventListener('keydown', (event) => event.stopPropagation());
    return input;
  }

  private checkbox(label: string, key: 'excludeShorts' | 'excludeLive'): HTMLElement {
    const wrap = el('label', 'ypf-check');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.ypf = key;
    input.addEventListener('change', () => this.patch({ [key]: input.checked } as Partial<FilterState>));
    wrap.append(input, labelText(label));
    return wrap;
  }

  private renderPresets(): void {
    this.presetRow.replaceChildren();
    for (const preset of [...builtInPresets(), ...this.userPresets]) {
      const chip = button(preset.name, 'ypf-chip ypf-chip--preset');
      chip.addEventListener('click', () => this.callbacks.onPresetUsed(preset));

      if (!preset.builtIn) {
        const remove = button('×', 'ypf-chip__remove');
        remove.title = `Delete "${preset.name}"`;
        remove.addEventListener('click', (event) => {
          event.stopPropagation();
          this.callbacks.onDeletePreset(preset.id);
        });
        chip.append(remove);
      }
      this.presetRow.append(chip);
    }
  }

  private patch(partial: Partial<FilterState>): void {
    this.callbacks.onChange({ ...this.filters, ...partial });
  }

  private syncInputs(): void {
    for (const chip of this.panel.querySelectorAll<HTMLElement>('[data-ypf-date]')) {
      chip.classList.toggle('ypf-chip--on', chip.dataset.ypfDate === this.filters.datePreset);
    }
    this.root.classList.toggle('ypf-bar--custom-date', this.filters.datePreset === 'custom');

    for (const input of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('[data-ypf]')) {
      const key = input.dataset.ypf as keyof FilterState;
      const value = this.filters[key];
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = Boolean(value);
      } else if (document.activeElement !== input) {
        // Skip the focused field: rewriting its value mid-typing would fight
        // the user's caret.
        input.value = value === null || value === undefined ? '' : String(value);
      }
    }
  }
}

/* ── Small DOM helpers ────────────────────────────────────────────────── */

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

function labelText(text: string): HTMLElement {
  const node = el('span', 'ypf-label');
  node.textContent = text;
  return node;
}

function spacer(): HTMLElement {
  return el('span', 'ypf-spacer');
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined;
  return () => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}
