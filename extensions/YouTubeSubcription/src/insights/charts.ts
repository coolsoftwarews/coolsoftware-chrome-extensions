/**
 * The two charts, drawn as inline SVG.
 *
 * No chart library: the extension's CSP forbids remote code, everything here is
 * bars on a linear scale, and a dependency would be larger than the drawing.
 *
 * Mark conventions, applied consistently:
 *   • data-ends rounded 4px, anchored to the baseline (never floating)
 *   • a 2px surface-coloured gap between stacked segments and adjacent bars
 *   • grid and axes recede; the marks carry the ink
 *   • direct labels rather than a label on every mark
 */

export interface Slice {
  key: string;
  label: string;
  color: string;
  value: number;
}

export interface Column {
  label: string;
  /** Tooltip heading, e.g. the full date. */
  title: string;
  slices: Slice[];
  /** Video titles behind this column, newest first, for the popover. */
  items?: string[];
}

const SVG = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

export interface TooltipApi {
  show(x: number, y: number, html: HTMLElement): void;
  hide(): void;
}

/**
 * The hover layer, shared by both charts.
 *
 * Two things happen on hover and they are separate on purpose: the *popover*
 * answers "what are these numbers", and the chart itself answers "which mark am
 * I asking about" by settling everything else back. Neither is enough alone —
 * a popover with no highlight leaves the reader guessing which column it
 * describes, and a highlight with no popover shows nothing new.
 *
 * The pointer target is never the painted mark. Each column and each row gets a
 * transparent band spanning the plot, so a 3px segment is as easy to hit as a
 * tall one, and the same band takes keyboard focus and shows the same popover.
 *
 * Three rules keep it still, all learned by getting them wrong:
 *
 *  1. **The popover is anchored to the mark, not to the pointer.** Following the
 *     cursor means a card of changing width chasing you around, re-deciding
 *     which side of the pointer it fits on as it goes. Parked beside the band,
 *     it does not move at all while you read it.
 *  2. **It is rebuilt only when the band changes.** It was being rebuilt on
 *     every `pointermove` — dozens of times per column crossed, each one
 *     re-measuring and repositioning a card whose content had not changed.
 *  3. **Moving between adjacent bands does not hide it.** `pointerleave` on the
 *     old band fires before `pointerenter` on the new one, so hiding
 *     immediately made the card blink out and re-animate in for every column
 *     you crossed. The hide waits a frame and a re-entry cancels it.
 */
interface HoverLayer {
  /**
   * `hit` is what the pointer aims at; `anchor` is what the popover parks
   * beside. On columns they are the same band. On rows they differ: the hit
   * area is the whole row so the name is clickable-wide, but a popover at the
   * row's right edge would sit out in the margin, away from the bar it
   * describes.
   */
  attach(
    hit: SVGRectElement,
    index: number,
    content: () => HTMLElement,
    anchor?: SVGGraphicsElement,
  ): void;
}

function hoverLayer(host: HTMLElement, svg: SVGSVGElement, tip: TooltipApi): HoverLayer {
  let current = -1;
  let pendingHide = 0;

  const enter = (index: number, hit: SVGGraphicsElement, content: () => HTMLElement): void => {
    cancelAnimationFrame(pendingHide);
    pendingHide = 0;
    if (index === current) return;
    current = index;

    host.dataset.hovering = 'true';
    for (const mark of svg.querySelectorAll<SVGElement>('[data-i]')) {
      mark.classList.toggle('is-hot', mark.dataset.i === String(index));
    }

    // The band's own top-right corner. `tip.show` flips to the other side near
    // a viewport edge, so this is a preference rather than a demand.
    const box = hit.getBoundingClientRect();
    tip.show(box.right, box.top, content());
  };

  const leave = (): void => {
    cancelAnimationFrame(pendingHide);
    pendingHide = requestAnimationFrame(() => {
      pendingHide = 0;
      current = -1;
      delete host.dataset.hovering;
      for (const mark of svg.querySelectorAll('.is-hot')) mark.classList.remove('is-hot');
      tip.hide();
    });
  };

  return {
    attach(hit, index, content, anchor) {
      const at = anchor ?? hit;
      hit.addEventListener('pointerenter', () => enter(index, at, content));
      hit.addEventListener('pointerleave', leave);
      // Keyboard reaches the same readout, in the same place.
      hit.addEventListener('focus', () => enter(index, at, content));
      hit.addEventListener('blur', leave);
    },
  };
}

/**
 * Stacked columns over time.
 *
 * A time axis with one column per day: the reader's job is "when did things
 * arrive, and from whom", so time runs along x and identity is carried by
 * colour within each column.
 */
export function drawColumns(
  host: HTMLElement,
  columns: Column[],
  tip: TooltipApi,
  formatValue: (n: number) => string,
  unit = '',
): void {
  host.replaceChildren();
  if (columns.length === 0) return;

  const width = Math.max(host.clientWidth || 900, 320);
  const height = 260;
  const pad = { top: 12, right: 8, bottom: 26, left: 40 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;

  const totals = columns.map((c) => c.slices.reduce((sum, s) => sum + s.value, 0));
  const max = Math.max(1, ...totals);
  const ticks = niceTicks(max, 4);
  const scaleMax = ticks[ticks.length - 1];

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': `Uploads per day, ${columns.length} days`,
  });

  // Grid + y axis.
  const grid = el('g', { class: 'grid' });
  const axis = el('g', { class: 'axis' });
  for (const tick of ticks) {
    const y = pad.top + plotH - (tick / scaleMax) * plotH;
    grid.append(el('line', { x1: pad.left, x2: width - pad.right, y1: y, y2: y }));
    const label = el('text', { x: pad.left - 8, y: y + 4, 'text-anchor': 'end' });
    label.textContent = formatValue(tick);
    axis.append(label);
  }
  svg.append(grid, axis);

  const band = plotW / columns.length;
  const barW = Math.max(2, Math.min(band - 2, 34));

  // Marks first, hit bands last: the bands are transparent, and an SVG element
  // only receives the pointer if nothing paints over it.
  const marks = el('g', { class: 'marks' });
  const hits = el('g', { class: 'hits' });
  const hover = hoverLayer(host, svg, tip);

  columns.forEach((column, index) => {
    const x = pad.left + index * band + (band - barW) / 2;
    let cursor = pad.top + plotH;

    for (const slice of column.slices) {
      if (slice.value <= 0) continue;
      const h = (slice.value / scaleMax) * plotH;
      // 2px gap between stacked segments, taken off the top of each.
      const drawn = Math.max(1, h - 2);
      cursor -= h;

      marks.append(
        el('rect', {
          class: 'mark',
          'data-i': index,
          x,
          y: cursor,
          width: barW,
          height: drawn,
          rx: Math.min(4, barW / 2),
          fill: slice.color,
        }),
      );
    }

    const hit = el('rect', {
      class: 'hit',
      'data-i': index,
      x: pad.left + index * band,
      y: pad.top,
      width: band,
      height: plotH,
      rx: 4,
      tabindex: 0,
      role: 'img',
      'aria-label': `${column.title}: ${formatValue(totals[index])}${unit ? ` ${unit}` : ''}`,
    });
    hits.append(hit);
    hover.attach(hit, index, () => tooltip(column, formatValue, unit));
  });

  svg.append(marks, hits);

  // X labels, thinned so they never collide.
  const step = Math.max(1, Math.ceil(columns.length / Math.floor(plotW / 64)));
  const xAxis = el('g', { class: 'axis' });
  columns.forEach((column, index) => {
    if (index % step !== 0) return;
    const label = el('text', {
      x: pad.left + index * band + band / 2,
      y: height - 8,
      'text-anchor': 'middle',
    });
    label.textContent = column.label;
    xAxis.append(label);
  });
  svg.append(xAxis);

  host.append(svg);
}

/**
 * The column popover: heading, the day's total as the hero number, then the
 * breakdown ordered high → low.
 *
 * Every label here is untrusted — channel and group names come from the feed —
 * so all of it goes in through `textContent`, never string-built markup.
 */
function tooltip(column: Column, formatValue: (n: number) => string, unit: string): HTMLElement {
  const box = document.createElement('div');

  const title = document.createElement('p');
  title.className = 'tip__title';
  title.textContent = column.title;

  const total = document.createElement('p');
  total.className = 'tip__total';
  total.append(document.createTextNode(formatValue(column.slices.reduce((s, x) => s + x.value, 0))));
  if (unit) {
    const suffix = document.createElement('span');
    suffix.className = 'tip__unit';
    suffix.textContent = unit;
    total.append(suffix);
  }
  box.append(title, total);

  const shown = [...column.slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  // One series is already the hero number above; repeating it as a single row
  // is a breakdown of nothing.
  if (shown.length < 2) {
    if (column.items?.length) box.append(tipItems(column.items));
    return box;
  }

  const rows = document.createElement('div');
  rows.className = 'tip__rows';

  // The popover is a card, not a scroller: past a handful of rows the rest are
  // summed rather than listed, so it never grows taller than the chart.
  const MAX = 7;
  for (const slice of shown.slice(0, MAX)) {
    rows.append(tipRow(slice.label, formatValue(slice.value), slice.color));
  }
  if (shown.length > MAX) {
    const rest = shown.slice(MAX).reduce((sum, s) => sum + s.value, 0);
    rows.append(tipRow(`${shown.length - MAX} more`, formatValue(rest), 'var(--text-muted)'));
  }

  box.append(rows);
  if (column.items?.length) box.append(tipItems(column.items));
  return box;
}

/**
 * The titles behind a mark.
 *
 * A count answers "how many", and the next question is always "which ones" —
 * on a chart of your own subscriptions the names *are* the data. Capped,
 * because a popover is a glance and a day with thirty uploads would fill the
 * screen; the table view has all of them.
 */
function tipItems(items: string[]): HTMLElement {
  const box = el2('div', 'tip__items');
  const MAX = 5;
  for (const title of items.slice(0, MAX)) {
    const line = el2('p', 'tip__item');
    line.textContent = title;
    box.append(line);
  }
  if (items.length > MAX) {
    const more = el2('p', 'tip__item tip__item--more');
    more.textContent = `+${items.length - MAX} more`;
    box.append(more);
  }
  return box;
}

function el2(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function tipRow(label: string, value: string, color: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'tip__row';

  const key = document.createElement('span');
  key.className = 'tip__key';
  key.style.background = color;

  const name = document.createElement('span');
  name.className = 'tip__name';
  name.textContent = label;

  const amount = document.createElement('span');
  amount.className = 'tip__value';
  amount.textContent = value;

  row.append(key, name, amount);
  return row;
}

export interface Bar {
  label: string;
  value: number;
  /** Popover breakdown, as label/value pairs — one line each, in given order. */
  stats: Array<{ label: string; value: string }>;
  /** Video titles behind this bar, newest first, for the popover. */
  items?: string[];
  color: string;
}

/**
 * Horizontal bars, sorted high → low.
 *
 * Horizontal because the categories are channel names — long, and unreadable
 * rotated. One series, so no legend: the heading names it, and every bar is
 * directly labelled, which is also the required relief for the light palette's
 * sub-3:1 slots.
 */
export function drawBars(
  host: HTMLElement,
  bars: Bar[],
  tip: TooltipApi,
  formatValue: (n: number) => string,
): void {
  host.replaceChildren();
  if (bars.length === 0) return;

  const width = Math.max(host.clientWidth || 900, 320);
  const rowH = 26;
  const height = bars.length * rowH + 12;
  const labelW = Math.min(220, Math.max(120, Math.round(width * 0.22)));
  const valueW = 56;
  const plotW = width - labelW - valueW;
  const max = Math.max(1, ...bars.map((b) => b.value));

  const svg = el('svg', {
    viewBox: `0 0 ${width} ${height}`,
    role: 'img',
    'aria-label': 'Most active channels',
  });

  const marks = el('g', { class: 'marks' });
  const hits = el('g', { class: 'hits' });
  const hover = hoverLayer(host, svg, tip);

  bars.forEach((bar, index) => {
    const y = index * rowH + 6;
    const w = Math.max(2, (bar.value / max) * plotW);

    const name = el('text', {
      x: labelW - 10,
      y: y + rowH / 2 + 1,
      'text-anchor': 'end',
      class: 'mark-label mark',
      'data-i': index,
    });
    name.textContent = bar.label;

    const rect = el('rect', {
      class: 'mark',
      'data-i': index,
      x: labelW,
      y: y + 3,
      width: w,
      height: rowH - 12,
      rx: 4,
      fill: bar.color,
    });

    const value = el('text', {
      x: labelW + w + 8,
      y: y + rowH / 2 + 1,
      class: 'mark-label mark',
      'data-i': index,
    });
    value.textContent = formatValue(bar.value);

    marks.append(name, rect, value);

    // The whole row is the target, name and value included — a 14px-tall bar is
    // a thin thing to ask anyone to aim at, and the name is what they read.
    const hit = el('rect', {
      class: 'hit',
      'data-i': index,
      x: 0,
      y,
      width,
      height: rowH,
      rx: 6,
      tabindex: 0,
      role: 'img',
      'aria-label': `${bar.label}: ${formatValue(bar.value)}`,
    });
    hits.append(hit);
    hover.attach(hit, index, () => barTooltip(bar, formatValue), rect);
  });

  svg.append(marks, hits);
  host.append(svg);
}

function barTooltip(bar: Bar, formatValue: (n: number) => string): HTMLElement {
  const box = document.createElement('div');

  const title = document.createElement('p');
  title.className = 'tip__title';
  title.textContent = bar.label;

  const total = document.createElement('p');
  total.className = 'tip__total';
  total.textContent = formatValue(bar.value);
  box.append(title, total);

  if (bar.stats.length > 0) {
    const rows = document.createElement('div');
    rows.className = 'tip__rows';
    for (const stat of bar.stats) {
      // No key stroke: one channel is one series, so there is no identity to
      // carry — these rows are facts about it, not other series.
      rows.append(tipRow(stat.label, stat.value, 'transparent'));
    }
    box.append(rows);
  }
  if (bar.items?.length) box.append(tipItems(bar.items));
  return box;
}

/** Axis ticks at 1/2/5×10ⁿ, so the labels read as round numbers. */
function niceTicks(max: number, count: number): number[] {
  const rough = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? magnitude * 10;
  const top = Math.ceil(max / step) * step;

  const ticks: number[] = [];
  for (let value = step; value <= top + 1e-9; value += step) ticks.push(value);
  return ticks.length > 0 ? ticks : [1];
}
