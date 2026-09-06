/**
 * Shared types. Kept dependency-free so every pure module in this extension
 * (time.ts, session.ts, aggregate.ts, csv.ts, settings.ts) stays DOM-free and
 * unit-testable in scripts/selftest.mjs.
 */

/** Each hide toggle is independent, mirroring Unhook's own granularity (PRD §4). */
export interface Settings {
  hideRecommendations: boolean;
  hideHomeFeed: boolean;
  hideShorts: boolean;
  hideEndScreen: boolean;
  hideComments: boolean;
  /** Minutes of *continuous* watching before the gentle reminder shows. null/0 disables it. */
  reminderMinutes: number | null;
}

/** dateKey ('YYYY-MM-DD', local time) -> milliseconds watched that day. */
export type DailyTotals = Record<string, number>;

/** Local-only usage counters (PRD §8's dashboard-open metric etc). Never transmitted. */
export type MetricEvent =
  | 'toggle.recommendations'
  | 'toggle.homeFeed'
  | 'toggle.shorts'
  | 'toggle.endScreen'
  | 'toggle.comments'
  | 'reminder.shown'
  | 'reminder.dismissed'
  | 'export.csv'
  | 'export.backup'
  | 'import.backup'
  | 'data.cleared'
  | 'dashboard.opened';
