/**
 * The watchlist's whole value proposition (PRD §4): "+140 reviews since 12
 * Aug". Pure comparison between the oldest and newest stored snapshot — no
 * background polling, the user has to come back and look.
 */

import { ProductWatch, ProductWatchSnapshot, SearchWatch, SearchWatchSnapshot } from './types';

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  } catch {
    return iso.slice(0, 10);
  }
}

function signed(value: number | null): string {
  if (value === null) return '';
  const rounded = Math.round(value * 10) / 10;
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}

export function describeSearchDelta(watch: SearchWatch): string | null {
  if (watch.snapshots.length < 2) return null;
  const first = watch.snapshots[0];
  const latest = watch.snapshots[watch.snapshots.length - 1];
  return describeSearchSnapshotDelta(first, latest);
}

export function describeSearchSnapshotDelta(first: SearchWatchSnapshot, latest: SearchWatchSnapshot): string {
  const parts: string[] = [];
  if (first.medianReviews !== null && latest.medianReviews !== null) {
    const diff = latest.medianReviews - first.medianReviews;
    if (diff !== 0) parts.push(`${signed(diff)} median reviews`);
  }
  const resultDiff = latest.resultCount - first.resultCount;
  if (resultDiff !== 0) parts.push(`${signed(resultDiff)} results`);
  if (first.medianRating !== null && latest.medianRating !== null) {
    const diff = latest.medianRating - first.medianRating;
    if (Math.abs(diff) >= 0.1) parts.push(`${signed(diff)} rating`);
  }
  if (!parts.length) return `No change since ${shortDate(first.capturedAt)}`;
  return `${parts.join(', ')} since ${shortDate(first.capturedAt)}`;
}

export function describeProductDelta(watch: ProductWatch): string | null {
  if (watch.snapshots.length < 2) return null;
  const first = watch.snapshots[0];
  const latest = watch.snapshots[watch.snapshots.length - 1];
  return describeProductSnapshotDelta(first, latest);
}

export function describeProductSnapshotDelta(first: ProductWatchSnapshot, latest: ProductWatchSnapshot): string {
  const parts: string[] = [];
  if (first.reviewCount !== null && latest.reviewCount !== null) {
    const diff = latest.reviewCount - first.reviewCount;
    if (diff !== 0) parts.push(`${signed(diff)} reviews`);
  }
  if (first.price !== null && latest.price !== null) {
    const diff = latest.price - first.price;
    if (Math.abs(diff) >= 0.01) parts.push(`${signed(Math.round(diff * 100) / 100)} price`);
  }
  if (first.rating !== null && latest.rating !== null) {
    const diff = latest.rating - first.rating;
    if (Math.abs(diff) >= 0.1) parts.push(`${signed(diff)} rating`);
  }
  if (!parts.length) return `No change since ${shortDate(first.capturedAt)}`;
  return `${parts.join(', ')} since ${shortDate(first.capturedAt)}`;
}
