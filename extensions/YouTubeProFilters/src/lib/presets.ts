import { EMPTY_FILTERS, type Preset } from '../types';

/**
 * The three shipped presets from §4 of the PRD. A function, not a constant:
 * "Evergreen" is defined relative to today, and a long-lived SPA session would
 * otherwise pin it to whenever the content script happened to load.
 */
export function builtInPresets(now = Date.now()): Preset[] {
  return [
    {
      id: 'breakout',
      name: 'Breakout',
      builtIn: true,
      filters: {
        ...EMPTY_FILTERS,
        datePreset: '30d',
        subsMax: 50_000,
        viewsMin: 100_000,
        excludeShorts: true,
        sort: 'outlier',
      },
    },
    {
      id: 'fresh-velocity',
      name: 'Fresh velocity',
      builtIn: true,
      filters: {
        ...EMPTY_FILTERS,
        datePreset: '7d',
        vpdMin: 2_000,
        excludeShorts: true,
        sort: 'vpd',
      },
    },
    {
      id: 'evergreen',
      name: 'Evergreen',
      builtIn: true,
      filters: {
        ...EMPTY_FILTERS,
        // "older than a year" — an upper bound on the publish date, no lower bound.
        datePreset: 'custom',
        dateTo: isoDaysAgo(365, now),
        vpdMin: 500,
        excludeShorts: true,
        sort: 'vpd',
      },
    },
  ];
}

function isoDaysAgo(days: number, now: number): string {
  return new Date(now - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
