/**
 * The pure half of the rendering pipeline: word-wrapping and card geometry,
 * expressed entirely as numbers and strings with an injected `measure`
 * function rather than a real CanvasRenderingContext2D. This is what makes
 * scripts/selftest.mjs able to cover the layout math headlessly (there is no
 * canvas in Node) - render.ts is the thin, DOM-bound half that calls these
 * functions with `ctx.measureText(s).width` as the measure function and
 * actually draws the result.
 */

import { CardInput, CardLayout } from './types';
import { detectDirection, formatCount } from './text';

export type Measure = (text: string) => number;

/**
 * Splits text into lines that each fit within maxWidth, using the injected
 * measure function. Whitespace runs are their own tokens so trailing spaces
 * on a wrapped line never get measured into the width budget.
 *
 * A token with no internal whitespace that alone exceeds maxWidth (a long
 * URL, or a CJK/Japanese/Korean run with no spaces at all - PRD S7) is
 * split at the character level rather than overflowing the card.
 */
export function wrapText(text: string, maxWidth: number, measure: Measure): string[] {
  if (!text) return [];

  const tokens = text.split(/(\s+)/).filter(t => t.length > 0);
  const lines: string[] = [];
  let current = '';

  const pushCurrent = () => {
    if (current.length) lines.push(current);
    current = '';
  };

  for (const token of tokens) {
    const isWhitespace = /^\s+$/.test(token);
    const candidate = current + token;

    if (measure(candidate) <= maxWidth) {
      current = candidate;
      continue;
    }

    // The token alone doesn't fit even on an empty line - split it by
    // character (handles a long URL and covers CJK/Hangul runs, which have
    // no whitespace to break on in the first place).
    if (!isWhitespace && measure(token) > maxWidth) {
      pushCurrent();
      let chunk = '';
      for (const ch of token) {
        const next = chunk + ch;
        if (chunk && measure(next) > maxWidth) {
          lines.push(chunk);
          chunk = ch;
        } else {
          chunk = next;
        }
      }
      current = chunk;
      continue;
    }

    // Normal wrap point: the token fits on its own line, just not this one.
    // Trailing whitespace that would start a new line is simply dropped.
    if (isWhitespace) continue;
    pushCurrent();
    current = token;
  }

  pushCurrent();
  return lines;
}

/**
 * Applies a max-line cap to already-wrapped lines, truncating the last kept
 * line with an ellipsis if anything was cut (PRD S7 - very long posts never
 * grow the card without bound).
 *
 * Precondition: every entry in `lines` already fits within maxWidth - this
 * is always true for lines produced by wrapText() above, which is the only
 * real caller (computeCardLayout pipes one straight into the other). Only
 * the *number* of lines is checked here; a caller that hands this a raw,
 * un-wrapped line wider than maxWidth on its own will not have that line
 * trimmed unless the overall line count also exceeds maxLines.
 */
export function truncateLines(
  lines: string[],
  maxLines: number,
  maxWidth: number,
  measure: Measure
): { lines: string[]; truncated: boolean } {
  if (lines.length <= maxLines) return { lines, truncated: false };

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1];
  const ellipsis = '\u2026'; // "..." as a single character

  while (last.length > 0 && measure(last + ellipsis) > maxWidth) {
    last = last.slice(0, -1);
  }
  kept[maxLines - 1] = last.replace(/\s+$/, '') + ellipsis;

  return { lines: kept, truncated: true };
}

export interface LayoutConfig {
  width: number;
  padding: number;
  avatarSize: number;
  lineHeight: number;
  maxLines: number;
  showMetrics: boolean;
}

/**
 * Computes every coordinate render.ts needs, plus the card's total height -
 * the height is derived from how many lines the body text actually wraps
 * to, so a one-line reply and a maxed-out long post never share a fixed
 * canvas size (PRD S7).
 */
export function computeCardLayout(input: CardInput, config: LayoutConfig, measure: Measure): CardLayout {
  const { width, padding, avatarSize, lineHeight, maxLines, showMetrics } = config;
  const direction = detectDirection(input.text || input.author);

  const headerTextX = padding + avatarSize + 14;
  const nameY = padding + avatarSize * 0.38;
  const handleY = padding + avatarSize * 0.68;
  const dateY = padding + avatarSize + 26;

  const textAreaX = padding;
  const textAreaWidth = width - padding * 2;
  const textStartY = dateY + 20;

  const wrapped = wrapText(input.text, textAreaWidth, measure);
  const { lines, truncated } = truncateLines(wrapped, maxLines, textAreaWidth, measure);
  const bodyLines = lines.length ? lines : [''];
  const bodyHeight = bodyLines.length * lineHeight;

  const metricsY = textStartY + bodyHeight + 14;
  const bottomPadding = padding;
  const metricsBlockHeight = showMetrics ? 32 : 0;

  const height = Math.round(metricsY + metricsBlockHeight + bottomPadding - (showMetrics ? 0 : 14));

  return {
    width,
    height: Math.max(height, padding * 2 + avatarSize + 40),
    padding,
    avatarSize,
    avatarX: padding,
    avatarY: padding,
    nameX: headerTextX,
    nameY,
    handleY,
    dateText: input.dateLabel,
    dateY,
    textLines: bodyLines,
    textX: textAreaX,
    textStartY,
    lineHeight,
    truncated,
    showMetrics,
    metricsY,
    metricsText: metricsLine(input),
    direction,
  };
}

function metricsLine(input: CardInput): string {
  const parts: string[] = [];
  if (input.metrics.replies !== null) parts.push(`${formatCount(input.metrics.replies)} replies`);
  if (input.metrics.reposts !== null) parts.push(`${formatCount(input.metrics.reposts)} reposts`);
  if (input.metrics.likes !== null) parts.push(`${formatCount(input.metrics.likes)} likes`);
  return parts.join('   ');
}
