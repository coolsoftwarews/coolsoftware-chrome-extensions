import { formatCompact } from '../lib/parse';
import type { EnrichedResult } from '../types';
import { thumbnailHost } from './selectors';

/** Below this multiple, "outlier" is noise rather than signal. */
const OUTLIER_THRESHOLD = 2;

const BADGE_CLASS = 'ypf-badges';

/**
 * Draws the velocity and outlier badges over a result's thumbnail. Called
 * again whenever enrichment lands, so it replaces its own previous output
 * rather than appending.
 */
export function renderBadges(row: Element, result: EnrichedResult): void {
  const host = thumbnailHost(row) ?? (row as HTMLElement);
  if (!host) return;

  const existing = host.querySelector(`.${BADGE_CLASS}`);
  const chips: Array<{ text: string; tone: 'velocity' | 'outlier'; title: string }> = [];

  if (result.viewsPerDay !== null) {
    chips.push({
      text: `${formatCompact(result.viewsPerDay)}/day`,
      tone: 'velocity',
      title: `${result.viewsPerDay.toLocaleString()} views per day since publication`,
    });
  }

  if (result.outlierRatio !== null && result.outlierRatio >= OUTLIER_THRESHOLD) {
    chips.push({
      text: `🔥 ${result.outlierRatio.toFixed(1)}×`,
      tone: 'outlier',
      title:
        `${result.outlierRatio.toFixed(1)}× this channel's median of ` +
        `${(result.channelMedianViews ?? 0).toLocaleString()} views on recent uploads`,
    });
  }

  if (chips.length === 0) {
    existing?.remove();
    return;
  }

  const container = (existing as HTMLElement | null) ?? document.createElement('div');
  container.className = BADGE_CLASS;
  container.replaceChildren(
    ...chips.map((chip) => {
      const element = document.createElement('span');
      element.className = `ypf-badge ypf-badge--${chip.tone}`;
      element.textContent = chip.text;
      element.title = chip.title;
      return element;
    }),
  );

  if (!existing) {
    // The thumbnail is positioned by YouTube; the badge container is absolute
    // within it, so it needs a positioned ancestor we can rely on.
    host.classList.add('ypf-badge-host');
    host.appendChild(container);
  }
}

export function clearBadges(root: ParentNode): void {
  root.querySelectorAll(`.${BADGE_CLASS}`).forEach((node) => node.remove());
}
