/**
 * Charts and table — the same slice of feed data, read two ways.
 *
 * This used to be a standalone page in its own tab. It is now a component that
 * mounts wherever it is given room, which in practice means an overlay on the
 * YouTube tab you were already looking at. The change is not cosmetic: a
 * separate tab meant leaving the page you were organising, and it meant the
 * filters lived in the same window as the charts, so the side panel had nothing
 * to do but link to it.
 *
 * Now the split is by *shape of control*, not by feature: filters and view
 * toggles are panel-sized and live in the panel; charts and tables need width
 * and live over the page. Neither surface duplicates the other, and the wire
 * between them is `viz-state.ts` — no messages, no drift.
 *
 * This module builds its own DOM. There is no HTML file to keep in step, and
 * the same markup has to work inside a shadow root, where a document-level
 * stylesheet would never reach it.
 */

import { Bar, Column, drawBars, drawColumns } from './charts';
import { onStoreChanged, readStore } from '../storage';
import {
  DEFAULT_VIZ_STATE,
  METRICS,
  VizMetric,
  VizState,
  onVizStateChanged,
  readVizState,
  vizScope,
  writeVizState,
} from '../viz-state';
import { Channel, Group, StoreShape, VideoRow } from '../types';
import { periodLabel } from '../csv';
import { Matcher, highlight, makeMatcher, matchesVideo } from '../search';

export { default as VIZ_STYLES } from './insights.css';

/**
 * Categorical slots, assigned in fixed order and never cycled — a ninth series
 * is folded into "Other" rather than given a generated hue, which would be
 * indistinguishable under colour-blindness.
 */
const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
] as const;
const OTHER = 'var(--series-other)';
const MAX_SERIES = 6;

/**
 * How many videos a single Atom feed carries.
 *
 * The hard ceiling on everything counted here. A channel that uploaded 40 times
 * this month is indistinguishable from one that uploaded 15 — both arrive with
 * 15 entries — so any count that reaches this number is a floor, not a total,
 * and has to be shown as one.
 */
const FEED_CAP = 15;

type SortKey = 'publishedAt' | 'channel' | 'title' | 'views' | 'likes' | 'groups';

interface Row {
  video: VideoRow;
  channel: Channel | undefined;
  channelName: string;
  groupNames: string[];
  /** The series this row belongs to in the stacked chart. */
  seriesKey: string;
  seriesLabel: string;
}

export interface VizHandle {
  destroy(): void;
}

export interface VizOptions {
  container: HTMLElement;
  /** Rendered as a close button in the header; omit for a non-closable host. */
  onClose?: () => void;
}

export function mountViz(opts: VizOptions): VizHandle {
  return new Viz(opts);
}

class Viz implements VizHandle {
  private readonly els: Elements;
  private readonly stopStore: () => void;
  private readonly stopViz: () => void;
  private readonly resizeObserver: ResizeObserver;

  private store: StoreShape | null = null;
  private state: VizState = DEFAULT_VIZ_STATE;
  private sortKey: SortKey = 'publishedAt';
  private sortAsc = false;
  /**
   * Series switched off via the legend.
   *
   * Deliberately *not* persisted alongside the filters: muting is a momentary
   * "let me see past this one", scoped to the series currently on screen, and
   * a mute restored days later against a different set of groups would hide
   * data for reasons nobody could reconstruct.
   */
  private readonly muted = new Set<string>();

  constructor(opts: VizOptions) {
    this.els = build(opts.onClose);
    opts.container.append(this.els.root);

    this.wire(opts.onClose);

    this.stopStore = onStoreChanged((next) => {
      this.store = next;
      this.render();
    });
    this.stopViz = onVizStateChanged((next) => {
      // A filter change invalidates the legend it was made against.
      if (next.groupId !== this.state.groupId || next.window !== this.state.window) {
        this.muted.clear();
      }
      this.state = next;
      this.render();
    });

    // Charts are sized from their container, and the container is a modal that
    // reflows with the window — a ResizeObserver rather than a window listener,
    // so nothing is left behind on a page that never unloads.
    //
    // It watches the *host*, not our own root. Our root's height follows its
    // content, and redrawing changes that content: observing it would be a
    // feedback loop that redraws forever.
    this.resizeObserver = new ResizeObserver(() => this.scheduleRedraw());
    this.resizeObserver.observe(opts.container);

    void this.init();
  }

  destroy(): void {
    this.stopStore();
    this.stopViz();
    this.resizeObserver.disconnect();
    cancelAnimationFrame(this.redrawFrame);
    this.els.root.remove();
  }

  private async init(): Promise<void> {
    const [store, state] = await Promise.all([readStore(), readVizState()]);
    this.store = store;
    this.state = state;
    this.render();
  }

  /* ── Data shaping ──────────────────────────────────────────────────── */

  private rows(): Row[] {
    const store = this.store;
    if (!store) return [];
    const { groupId, days, limit } = vizScope(this.state);

    const byId = new Map(store.channels.map((c) => [c.id, c]));
    const groupsOf = new Map<string, Group[]>();
    for (const group of store.groups) {
      for (const id of group.channelIds) {
        const list = groupsOf.get(id);
        if (list) list.push(group);
        else groupsOf.set(id, [group]);
      }
    }

    const wanted = groupId
      ? new Set(store.groups.find((g) => g.id === groupId)?.channelIds ?? [])
      : null;
    const cutoff = days === null ? 0 : Date.now() - days * 86_400_000;
    /*
     * A premiere scheduled for next week is dated next week.
     *
     * Its Atom entry carries the *scheduled* time, so `publishedAt` is in the
     * future — which passes every "is it recent enough?" test ever written,
     * counted in the tiles, and then fell out of the chart because no bucket
     * reaches forward. Two of Alex Hormozi's ten were exactly this.
     *
     * They are excluded rather than bucketed: "uploads in the last 48 hours"
     * is a claim about the past, and a video nobody can watch yet is not an
     * upload.
     */
    const now = Date.now();
    const matcher = makeMatcher(this.state.query);

    // A single channel narrows the group rather than replacing it: "this
    // channel, in this period" is the question, and the heading says both.
    const only = this.state.channelId;

    const matched = store.videos
      .filter((v) => (wanted ? wanted.has(v.channelId) : true))
      .filter((v) => (only ? v.channelId === only : true))
      .filter((v) => v.publishedAt >= cutoff && v.publishedAt <= now)
      .map((video): Row => {
        const channel = byId.get(video.channelId);
        const groups = groupsOf.get(video.channelId) ?? [];
        // Grouped by group when looking at everything, by channel when already
        // inside one — in both cases, colour answers "who is this from?".
        const series = groupId
          ? { key: video.channelId, label: channel?.name ?? video.channelId }
          : groups.length > 0
            ? { key: groups[0].id, label: groups[0].name }
            : { key: '', label: 'Ungrouped' };

        return {
          video,
          channel,
          channelName: channel?.name ?? video.channelId,
          groupNames: groups.map((g) => g.name),
          seriesKey: series.key,
          seriesLabel: series.label,
        };
      })
      .filter((row) =>
        matchesVideo(
          matcher,
          {
            title: row.video.title,
            channel: row.channelName,
            handle: row.channel?.handle ?? '',
            groups: row.groupNames,
          },
          this.state.fields,
        ),
      );

    // "Latest N" is a row count, not a period. Take it from the newest end so
    // the charts show the same slice the CSV export would write.
    if (limit === null) return matched;
    return [...matched].sort((a, b) => b.video.publishedAt - a.video.publishedAt).slice(0, limit);
  }

  /**
   * Rank series by volume and keep the top few; the tail becomes "Other".
   *
   * Colour assignment follows the *entity*, not its rank within the current
   * filter — so a series keeps its hue as filters change, and the reader is not
   * asked to relearn the legend.
   */
  private seriesColors(all: Row[]): Map<string, { color: string; label: string }> {
    const counts = new Map<string, { label: string; n: number }>();
    for (const row of all) {
      const entry = counts.get(row.seriesKey);
      if (entry) entry.n++;
      else counts.set(row.seriesKey, { label: row.seriesLabel, n: 1 });
    }

    const ranked = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
    const colors = new Map<string, { color: string; label: string }>();

    ranked.forEach(([key, { label }], index) => {
      colors.set(key, {
        color: index < MAX_SERIES ? SERIES[index] : OTHER,
        label: index < MAX_SERIES ? label : 'Other',
      });
    });
    return colors;
  }

  /* ── Rendering ─────────────────────────────────────────────────────── */

  private redrawFrame = 0;

  private scheduleRedraw(): void {
    cancelAnimationFrame(this.redrawFrame);
    this.redrawFrame = requestAnimationFrame(() => this.render());
  }

  private render(): void {
    const store = this.store;
    if (!store) return;

    const chart = this.state.view === 'chart';
    this.els.chartView.hidden = !chart;
    this.els.tableView.hidden = chart;

    // The controls follow the state, never the other way round: the state can
    // also change from the panel, or from a second copy of this overlay.
    this.els.chart1Metric.value = this.state.metric;
    this.els.chart2Metric.value = this.state.channelMetric;

    const all = this.rows();
    const colors = this.seriesColors(all);
    const visible = all.filter((row) => !this.muted.has(colors.get(row.seriesKey)?.label ?? ''));

    /*
     * One line, and only the two things this picture cannot be read without:
     * what is in it, and how old the numbers are.
     *
     * A subscription count lived here too and earned nothing — the panel says
     * it three lines away, and it explains none of what is on screen. Staleness
     * does: every view count here is from the last check, not from now.
     */
    this.els.scope.textContent =
      store.uploadsCheckedAt === 0
        ? 'No upload data yet — press Refresh in the side panel.'
        : `${this.scopeName()} · ${this.periodLabel()}${
            this.state.query.trim() ? ` · “${this.state.query.trim()}”` : ''
          } — ${number(visible.length)} of ${number(store.videos.length)} held videos, ` +
          `as of ${relative(store.uploadsCheckedAt)}`;

    if (chart) {
      this.renderStats(visible);
      this.renderColumns(all, colors);
      this.renderChannels(visible, colors);
    } else {
      this.renderTable(visible, makeMatcher(this.state.query));
    }
  }

  private groupName(): string | null {
    return this.store?.groups.find((g) => g.id === this.state.groupId)?.name ?? null;
  }

  /**
   * What this picture is of: a channel, or a group, or everything — never a
   * channel without saying which group it was reached through, because the
   * numbers are still bounded by that group's period and search.
   */
  private scopeName(): string {
    const group = this.groupName() ?? 'All subscriptions';
    if (!this.state.channelId) return group;
    const channel = this.store?.channels.find((c) => c.id === this.state.channelId);
    return `${channel?.name ?? 'One channel'} · in ${group}`;
  }

  private periodLabel(): string {
    const { days, limit } = vizScope(this.state);
    return periodLabel(days, limit);
  }

  /**
   * What one video contributes to the chosen metric.
   *
   * A ratio has no per-video contribution that can be summed — 0.05 and 0.03 do
   * not add up to 0.08 — so it is not measured here. It is computed from totals
   * instead, wherever a bucket is closed.
   */
  private amount(row: Row): number {
    switch (this.state.metric) {
      case 'views':
        return row.video.views ?? 0;
      case 'likes':
        return row.video.likes ?? 0;
      default:
        return 1;
    }
  }

  /** Likes divided by views across a set of rows, or null if views are zero. */
  private ratioOf(rows: Row[]): number | null {
    let views = 0;
    let likes = 0;
    for (const row of rows) {
      views += row.video.views ?? 0;
      likes += row.video.likes ?? 0;
    }
    return views > 0 ? likes / views : null;
  }

  private metricLabel(metric: VizMetric = this.state.metric): string {
    return METRICS.find((m) => m.id === metric)?.label ?? 'Uploads';
  }

  /** Counts are counts; a ratio is a percentage. */
  private formatMetric = (value: number, metric: VizMetric = this.state.metric): string =>
    metric === 'ratio' ? `${(value * 100).toFixed(1)}%` : compact(value);

  private renderStats(visible: Row[]): void {
    const channels = new Set(visible.map((r) => r.video.channelId));
    const views = visible.reduce((sum, r) => sum + (r.video.views ?? 0), 0);
    const likes = visible.reduce((sum, r) => sum + (r.video.likes ?? 0), 0);
    const ratio = this.ratioOf(visible);
    const { days } = vizScope(this.state);
    const perDay = days ? visible.length / days : null;

    this.els.stats.replaceChildren(
      stat(
        'Videos',
        number(visible.length),
        days ? `in the ${periodLabel(days, null)}, of what we hold` : 'in everything held',
      ),
      stat(
        'Channels posting',
        number(channels.size),
        `of ${this.store!.channels.length} subscriptions`,
      ),
      stat('Views', compact(views), 'as of the last check'),
      stat(
        'Likes',
        compact(likes),
        ratio === null ? 'as of the last check' : `${(ratio * 100).toFixed(1)}% of views`,
      ),
      stat('Per day', perDay === null ? '—' : perDay.toFixed(1), 'average across the period'),
    );
  }

  private renderColumns(all: Row[], colors: Map<string, { color: string; label: string }>): void {
    const name = this.groupName();
    const metric = this.metricLabel();
    /*
     * A ratio cannot be stacked.
     *
     * Counts and sums split by group and add back up; likes-per-view does not —
     * stacking one group's 4% on another's 6% draws a 10% that exists nowhere.
     * So the ratio is computed per day from the whole bucket and drawn as one
     * series, with no legend to imply otherwise.
     */
    const stacked = this.state.metric !== 'ratio';
    this.els.chart1Title.textContent = stacked
      ? name
        ? `${metric} per day — ${name}`
        : `${metric} per day, by group`
      : `${metric} per day${name ? ` — ${name}` : ''}`;

    /*
     * Buckets have to span the same window the stat tiles count.
     *
     * They did not, and the numbers disagreed on screen: "Last 24 hours" gave
     * one *calendar day* bucket, so a video posted yesterday evening was inside
     * the rolling window, counted in "16 videos", and absent from a column that
     * topped out at 4. A rolling window does not align to midnight — 24 hours
     * ago is yesterday — so short windows are bucketed by hour, and day
     * buckets cover one extra day to hold the part before midnight.
     */
    const { days } = vizScope(this.state);
    const hourly = days !== null && days <= 2;
    const step = hourly ? 3_600_000 : 86_400_000;
    const floorTo = (ms: number) => (hourly ? floorHour(ms) : startOfDay(ms));

    const end = floorTo(Date.now());
    /*
     * One bucket more than the window, because the newest bucket is a *part*
     * hour (or day) and the window is rolling.
     *
     * At 20:15 with a 48-hour window, 48 hourly buckets reach back to 21:00
     * two days ago — but the window itself starts at 20:15 two days ago, and
     * anything in those 45 minutes was counted by the tiles and then had no
     * column to be drawn in. The tiles said 10, the chart showed 8, and
     * nothing said which two were missing.
     */
    const count =
      days === null ? Math.min(spanDays(all), 120) : hourly ? days * 24 + 1 : days + 1;

    const buckets = new Map<number, Map<string, number>>();
    for (let i = count - 1; i >= 0; i--) buckets.set(end - i * step, new Map());

    /** Rows per bucket, kept whole so a ratio can be computed from them. */
    const rowsByBucket = new Map<number, Row[]>();

    for (const row of all) {
      const key = floorTo(row.video.publishedAt);
      const bucket = buckets.get(key);
      if (!bucket) continue;
      const label = colors.get(row.seriesKey)?.label ?? 'Other';
      if (this.muted.has(label)) continue;

      bucket.set(label, (bucket.get(label) ?? 0) + this.amount(row));
      const list = rowsByBucket.get(key);
      if (list) list.push(row);
      else rowsByBucket.set(key, [row]);
    }

    // Legend order is the palette order, so colour ↔ label stays stable.
    const legend: Array<[string, string]> = [];
    const seen = new Set<string>();
    for (const { color, label } of colors.values()) {
      if (seen.has(label)) continue;
      seen.add(label);
      legend.push([label, color]);
    }

    const columns: Column[] = [...buckets.entries()].map(([at, counts]) => ({
      label: hourly
        ? new Date(at).toLocaleTimeString(undefined, { hour: 'numeric' })
        : new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      title: hourly
        ? new Date(at).toLocaleString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
            hour: 'numeric',
          })
        : new Date(at).toLocaleDateString(undefined, {
            weekday: 'short',
            day: 'numeric',
            month: 'short',
          }),
      items: (rowsByBucket.get(at) ?? [])
        .slice()
        .sort((a, b) => b.video.publishedAt - a.video.publishedAt)
        .map((row) => row.video.title),
      slices: stacked
        ? legend
            .filter(([label]) => (counts.get(label) ?? 0) > 0)
            .map(([label, color]) => ({
              key: label,
              label,
              color,
              value: counts.get(label) ?? 0,
            }))
        : ratioSlice(this.ratioOf(rowsByBucket.get(at) ?? [])),
    }));

    drawColumns(
      this.els.chart1,
      columns,
      this.tip,
      this.formatMetric,
      this.metricLabel().toLowerCase(),
    );
    // One series needs no legend, and a ratio has exactly one by definition.
    this.renderLegend(stacked ? legend : []);
  }

  /** A legend is present for ≥2 series; one series is named by the heading. */
  private renderLegend(legend: Array<[string, string]>): void {
    this.els.chart1Legend.replaceChildren();
    if (legend.length < 2) return;

    for (const [label, color] of legend) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'legend__item';
      button.setAttribute('aria-pressed', String(!this.muted.has(label)));

      const swatch = document.createElement('span');
      swatch.className = 'legend__swatch';
      swatch.style.background = color;
      const text = document.createElement('span');
      text.textContent = label;

      button.append(swatch, text);
      button.addEventListener('click', () => {
        if (this.muted.has(label)) this.muted.delete(label);
        else this.muted.add(label);
        this.render();
      });
      this.els.chart1Legend.append(button);
    }
  }

  private renderChannels(
    visible: Row[],
    colors: Map<string, { color: string; label: string }>,
  ): void {
    const byChannel = new Map<string, { name: string; rows: Row[] }>();
    for (const row of visible) {
      const entry = byChannel.get(row.video.channelId);
      if (entry) entry.rows.push(row);
      else byChannel.set(row.video.channelId, { name: row.channelName, rows: [row] });
    }

    /*
     * "Active" is a choice, not a definition.
     *
     * Most uploads, most views and most liked are three different rankings, and
     * which one answers "who is worth my attention" depends on the question in
     * the reader's head. It is deliberately separate from the daily chart's
     * metric: comparing "uploads per day" against "top channels by views" in
     * one glance is a normal thing to want.
     */
    const metric = this.state.channelMetric;

    const measured = [...byChannel.values()].map((entry) => {
      const uploads = entry.rows.length;
      const views = entry.rows.reduce((sum, r) => sum + (r.video.views ?? 0), 0);
      const likes = entry.rows.reduce((sum, r) => sum + (r.video.likes ?? 0), 0);
      const ratio = this.ratioOf(entry.rows);
      const value =
        metric === 'views'
          ? views
          : metric === 'likes'
            ? likes
            : metric === 'ratio'
              ? (ratio ?? 0)
              : uploads;
      // Colour follows the same series the stacked chart uses, so a channel
      // wears its group's hue in both pictures and the legend reads across.
      const series = colors.get(entry.rows[0]?.seriesKey ?? '');
      return { ...entry, uploads, views, likes, ratio, value, color: series?.color };
    });

    const ranked = measured.sort((a, b) => b.value - a.value || b.views - a.views);

    /*
     * The 15-video ceiling only distorts a *count*. Views and likes are summed
     * from whatever the feed held, so they are understated rather than clipped,
     * and printing "15+" beside a view total would be a claim about the wrong
     * number entirely.
     */
    const counting = metric === 'uploads';
    const capped = counting ? ranked.filter((entry) => entry.uploads >= FEED_CAP).length : 0;

    const bars: Bar[] = ranked.slice(0, 12).map((entry) => ({
      label: entry.name,
      value: entry.value,
      stats: [
        {
          label: 'Uploads',
          value:
            entry.uploads >= FEED_CAP ? `${FEED_CAP}+` : number(entry.uploads),
        },
        { label: 'Views', value: compact(entry.views) },
        { label: 'Likes', value: compact(entry.likes) },
        ...(entry.ratio === null
          ? []
          : [{ label: 'Liked', value: `${(entry.ratio * 100).toFixed(1)}%` }]),
      ],
      items: entry.rows
        .slice()
        .sort((a, b) => b.video.publishedAt - a.video.publishedAt)
        .map((row) => row.video.title),
      // Normally a magnitude ranking wants one hue — but these bars sit under
      // a stacked chart whose colours already mean something, and two pictures
      // colouring the same channel differently is worse than a little noise.
      color: entry.color ?? 'var(--series-1)',
    }));

    this.els.chart2Title.textContent = counting
      ? 'Most active channels'
      : `Top channels by ${this.metricLabel(metric).toLowerCase()}`;

    // "15+" rather than "15": the number is a floor for anyone at the cap, and a
    // row of identical bars otherwise reads as a genuine tie.
    drawBars(this.els.chart2, bars, this.tip, (n) =>
      counting && n >= FEED_CAP ? `${n}+` : this.formatMetric(n, metric),
    );

    this.els.chart2Note.hidden = capped === 0;
    this.els.chart2Note.textContent =
      `${capped} channel${capped === 1 ? '' : 's'} reached the ceiling: each channel's feed ` +
      `carries at most ${FEED_CAP} videos, so those counts are "at least", not totals. ` +
      'Shorten the period to compare them properly.';
  }

  private renderTable(visible: Row[], matcher: Matcher): void {
    const sorted = [...visible].sort((a, b) => {
      const direction = this.sortAsc ? 1 : -1;
      switch (this.sortKey) {
        case 'channel':
          return direction * a.channelName.localeCompare(b.channelName);
        case 'title':
          return direction * a.video.title.localeCompare(b.video.title);
        case 'likes':
          // Unknown sorts last in either direction: a hidden like count is not
          // a video with no likes.
          return direction * ((a.video.likes ?? -1) - (b.video.likes ?? -1));
        case 'views':
          return direction * ((a.video.views ?? -1) - (b.video.views ?? -1));
        case 'groups':
          return direction * a.groupNames.join().localeCompare(b.groupNames.join());
        default:
          return direction * (a.video.publishedAt - b.video.publishedAt);
      }
    });

    this.els.tableEmpty.hidden = sorted.length > 0;

    // A silent cap reads as "this is everything". If rows are dropped, say how
    // many and where the rest can be had.
    const LIMIT = 1000;
    this.els.tableNote.hidden = sorted.length <= LIMIT;
    this.els.tableNote.textContent =
      `Showing the first ${number(LIMIT)} of ${number(sorted.length)} rows — ` +
      'narrow the filters, or use Export CSV in the panel for all of them.';

    const frag = document.createDocumentFragment();

    for (const row of sorted.slice(0, LIMIT)) {
      const tr = document.createElement('tr');

      const date = document.createElement('td');
      date.className = 'cell-muted';
      date.textContent = row.video.publishedAt
        ? new Date(row.video.publishedAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })
        : '—';

      const channel = document.createElement('td');
      channel.append(marked(matcher, row.channelName));

      const title = document.createElement('td');
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/watch?v=${row.video.videoId}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.append(marked(matcher, row.video.title));
      title.append(link);

      const views = document.createElement('td');
      views.className = 'num';
      views.textContent = row.video.views === null ? '—' : number(row.video.views);

      const likes = document.createElement('td');
      likes.className = 'num';
      likes.textContent = row.video.likes === null ? '—' : number(row.video.likes);

      const groups = document.createElement('td');
      groups.className = 'cell-muted';
      groups.textContent = row.groupNames.join(', ') || '—';

      tr.append(date, channel, title, views, likes, groups);
      frag.append(tr);
    }
    this.els.tbody.replaceChildren(frag);
  }

  /* ── Wiring ────────────────────────────────────────────────────────── */

  private wire(onClose?: () => void): void {
    this.els.close?.addEventListener('click', () => onClose?.());

    for (const th of this.els.table.querySelectorAll<HTMLTableCellElement>('th[data-sort]')) {
      th.addEventListener('click', () => {
        const key = th.dataset.sort as SortKey;
        this.sortAsc = key === this.sortKey ? !this.sortAsc : key === 'channel' || key === 'title';
        this.sortKey = key;

        for (const other of this.els.table.querySelectorAll('th[data-sort]')) {
          other.removeAttribute('aria-sort');
        }
        th.setAttribute('aria-sort', this.sortAsc ? 'ascending' : 'descending');
        this.render();
      });
    }
  }

  /**
   * Tooltip placement.
   *
   * `charts.ts` reports viewport coordinates, and the tip is fixed-positioned,
   * so the two agree wherever this component is mounted.
   *
   * The popover *flips* to the other side of the pointer near an edge rather
   * than sliding along it. Clamping alone parks the card under the cursor, and
   * a readout you have to move away from to read is worse than none.
   */
  private readonly tip = {
    show: (x: number, y: number, content: HTMLElement): void => {
      const tip = this.els.tip;
      const appearing = tip.hidden;

      tip.replaceChildren(content);
      if (appearing) tip.dataset.entering = 'true';
      tip.hidden = false;

      const box = tip.getBoundingClientRect();
      const gap = 16;
      const left =
        x + gap + box.width > window.innerWidth - 8 ? x - gap - box.width : x + gap;
      const top =
        y + gap + box.height > window.innerHeight - 8 ? y - gap - box.height : y + gap;

      tip.style.left = `${Math.max(8, left)}px`;
      tip.style.top = `${Math.max(8, top)}px`;

      // Clear the entry state on the next frame so the transition has two
      // values to run between; setting it in the same frame animates nothing.
      if (appearing) {
        requestAnimationFrame(() => {
          delete tip.dataset.entering;
        });
      }
    },
    hide: (): void => {
      this.els.tip.hidden = true;
      delete this.els.tip.dataset.entering;
    },
  };
}

/* ── DOM ─────────────────────────────────────────────────────────────── */

interface Elements {
  root: HTMLElement;
  scope: HTMLElement;
  close: HTMLButtonElement | null;
  stats: HTMLElement;
  chartView: HTMLElement;
  tableView: HTMLElement;
  chart1Metric: HTMLSelectElement;
  chart2Metric: HTMLSelectElement;
  chart1: HTMLElement;
  chart1Title: HTMLElement;
  chart1Legend: HTMLElement;
  chart2: HTMLElement;
  chart2Title: HTMLElement;
  chart2Note: HTMLElement;
  table: HTMLTableElement;
  tbody: HTMLTableSectionElement;
  tableEmpty: HTMLElement;
  tableNote: HTMLElement;
  tip: HTMLElement;
}

function build(closable?: () => void): Elements {
  const root = el('div', 'viz-root');

  const top = el('header', 'top');
  const titles = el('div', 'top__titles');
  const h1 = el('h1');
  h1.textContent = 'Subscription insights';
  const scope = el('p', 'muted scope');
  titles.append(h1, scope);
  top.append(titles);

  let close: HTMLButtonElement | null = null;
  if (closable) {
    close = document.createElement('button');
    close.type = 'button';
    close.className = 'top__close';
    close.setAttribute('aria-label', 'Close insights');
    close.textContent = '✕';
    top.append(close);
  }

  const stats = el('section', 'stats');

  /*
   * Charts, each with its own measure control in its own header.
   *
   * These two selects used to sit in the panel under "Chart settings", a box
   * of dropdowns naming charts you could not see while you set them. A control
   * that changes one picture belongs on that picture: here "Uploads → Views"
   * is read as a property of the chart under it, and there is nothing left to
   * cross-reference.
   *
   * They still write to the shared viz state, so the panel and the overlay
   * cannot drift apart — the wire is the same one the filters use.
   */
  const chartView = el('section', 'view');
  const fig1 = el('figure', 'card');
  const cap1 = document.createElement('figcaption');
  const chart1Title = el('h2');
  const chart1Metric = metricSelect(
    'Measure',
    'What the per-day chart counts',
    (value) => void writeVizState({ metric: value }),
  );
  const chart1Legend = el('div', 'legend');
  cap1.append(chart1Title, chart1Metric.field, chart1Legend);
  const chart1 = el('div', 'plot');
  fig1.append(cap1, chart1);

  const fig2 = el('figure', 'card');
  const cap2 = document.createElement('figcaption');
  const chart2Title = el('h2');
  chart2Title.textContent = 'Most active channels';
  const chart2Metric = metricSelect(
    'Rank by',
    'How the channel ranking decides "most active"',
    (value) => void writeVizState({ channelMetric: value }),
  );
  cap2.append(chart2Title, chart2Metric.field);
  const chart2 = el('div', 'plot');
  const chart2Note = el('p', 'muted note');
  chart2Note.hidden = true;
  fig2.append(cap2, chart2, chart2Note);

  chartView.append(fig1, fig2);

  /* Table */
  const tableView = el('section', 'view');
  tableView.hidden = true;
  const tableCard = el('div', 'card card--flush');
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  for (const [key, label, numeric] of [
    ['publishedAt', 'Published', false],
    ['channel', 'Channel', false],
    ['title', 'Title', false],
    ['views', 'Views', true],
    ['likes', 'Likes', true],
    ['groups', 'Groups', false],
  ] as const) {
    const th = document.createElement('th');
    th.dataset.sort = key;
    th.textContent = label;
    if (numeric) th.className = 'num';
    if (key === 'publishedAt') th.setAttribute('aria-sort', 'descending');
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement('tbody');
  table.append(thead, tbody);

  const tableEmpty = el('p', 'empty muted');
  tableEmpty.textContent = 'Nothing matches these filters.';
  tableEmpty.hidden = true;
  const tableNote = el('p', 'muted note');
  tableNote.hidden = true;
  tableCard.append(table, tableEmpty, tableNote);
  tableView.append(tableCard);

  const tip = el('div', 'tip');
  tip.hidden = true;

  root.append(top, stats, chartView, tableView, tip);

  return {
    root,
    scope,
    close,
    stats,
    chartView,
    tableView,
    chart1,
    chart1Title,
    chart1Metric: chart1Metric.select,
    chart1Legend,
    chart2,
    chart2Title,
    chart2Metric: chart2Metric.select,
    chart2Note,
    table,
    tbody,
    tableEmpty,
    tableNote,
    tip,
  };
}

/**
 * A labelled measure picker for a chart header.
 *
 * The label is visible rather than a `title` attribute: "Uploads" alone in a
 * chart header is a word that could mean anything, and "Rank by: Uploads"
 * needs no hovering to explain itself.
 */
function metricSelect(
  label: string,
  hint: string,
  onChange: (value: VizMetric) => void,
): { field: HTMLElement; select: HTMLSelectElement } {
  const field = el('label', 'field');
  const text = el('span', 'field__label');
  text.textContent = label;

  const select = document.createElement('select');
  select.className = 'field__select';
  select.title = hint;
  for (const metric of METRICS) {
    const option = document.createElement('option');
    option.value = metric.id;
    option.textContent = metric.label;
    select.append(option);
  }
  select.addEventListener('change', () => onChange(select.value as VizMetric));

  field.append(text, select);
  return { field, select };
}

function el(tag: string, className?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * Text with the matched parts marked.
 *
 * Built from nodes rather than innerHTML: these strings are video titles and
 * channel names written by other people, and a search result is the last place
 * to start trusting them with markup.
 */
function marked(matcher: Matcher, text: string): DocumentFragment {
  const frag = document.createDocumentFragment();
  for (const part of highlight(matcher, text)) {
    if (!part.hit) {
      frag.append(part.text);
      continue;
    }
    const mark = document.createElement('mark');
    mark.textContent = part.text;
    frag.append(mark);
  }
  return frag;
}

/** The single unstacked slice a ratio produces. */
function ratioSlice(
  ratio: number | null,
): Array<{ key: string; label: string; color: string; value: number }> {
  if (ratio === null || ratio <= 0) return [];
  return [{ key: 'ratio', label: 'Likes per view', color: 'var(--series-1)', value: ratio }];
}

function stat(label: string, value: string, note: string): HTMLElement {
  const box = el('div', 'stat');
  const l = el('p', 'stat__label');
  l.textContent = label;
  const v = el('p', 'stat__value');
  v.textContent = value;
  const n = el('p', 'stat__note');
  n.textContent = note;
  box.append(l, v, n);
  return box;
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

const number = (n: number): string => n.toLocaleString();

function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
}

function floorHour(ms: number): number {
  const date = new Date(ms);
  date.setMinutes(0, 0, 0);
  return date.getTime();
}

function startOfDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Local-calendar day key. `toISOString` would bucket by UTC and shift days. */
function dayKey(ms: number): string {
  const date = new Date(startOfDay(ms));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function spanDays(all: Row[]): number {
  const oldest = all.reduce(
    (min, r) => Math.min(min, r.video.publishedAt || Date.now()),
    Date.now(),
  );
  const days = Math.ceil((Date.now() - oldest) / 86_400_000) + 1;
  // A column per day stops being readable long before a year of them.
  return Math.min(Math.max(days, 7), 120);
}

function relative(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
