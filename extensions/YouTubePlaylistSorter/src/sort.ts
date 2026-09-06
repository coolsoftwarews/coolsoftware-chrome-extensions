/**
 * Sorting the loaded rows. Pure — takes an array, returns a new array, never
 * touches the DOM or reorders anything on YouTube itself (PRD §4: this
 * product never writes to the platform).
 *
 * A row missing the field a sort needs is never dropped — it's pushed to the
 * end, in its original (custom/YouTube) order, so "sort by date" on a
 * playlist with a couple of unavailable rows still shows every row, just with
 * the unsortable ones parked at the bottom rather than vanishing.
 */

import { relativeDateToMs } from './parse';
import { PlaylistRow, SortKey } from './types';

function byPositionAscending(a: PlaylistRow, b: PlaylistRow): number {
  return a.position - b.position;
}

export function sortRows(rows: PlaylistRow[], key: SortKey): PlaylistRow[] {
  const rest = [...rows];

  if (key === 'custom') {
    return rest.sort(byPositionAscending);
  }

  if (key === 'duration') {
    const withValue = rest.filter((r) => r.durationSeconds !== null);
    const without = rest.filter((r) => r.durationSeconds === null).sort(byPositionAscending);
    withValue.sort((a, b) => (a.durationSeconds as number) - (b.durationSeconds as number));
    return [...withValue, ...without];
  }

  if (key === 'title') {
    const withValue = rest.filter((r) => r.title.trim().length > 0);
    const without = rest.filter((r) => r.title.trim().length === 0).sort(byPositionAscending);
    withValue.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
    return [...withValue, ...without];
  }

  // key === 'date': newest first. Only ever a relative-order sort (PRD §5/§10
  // open question) — there is no absolute upload date on a playlist row.
  const ages = new Map<string, number>();
  for (const row of rest) {
    const ms = relativeDateToMs(row.dateText);
    if (ms !== null) ages.set(row.id, ms);
  }
  const withValue = rest.filter((r) => ages.has(r.id));
  const without = rest.filter((r) => !ages.has(r.id)).sort(byPositionAscending);
  withValue.sort((a, b) => (ages.get(a.id) as number) - (ages.get(b.id) as number));
  return [...withValue, ...without];
}
