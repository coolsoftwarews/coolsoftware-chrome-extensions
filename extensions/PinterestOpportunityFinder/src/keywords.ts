/**
 * The keyword panel — the differentiator (PRD §4). Pure and DOM-free.
 *
 * Everything here is counts with a sample size, never advice (PRD §4): a
 * phrase is "over-represented", not "you should use this word". Tokenizing
 * counts tokens rather than parsing grammar, so non-English queries and
 * descriptions still produce usable counts (PRD §7) even though the module
 * has no idea what language it's looking at.
 */

import { DomainStat, FormatBand, FormatStats, KeywordStat, PinCard } from './types';

const MIN_PHRASE_SAMPLE = 2; // below this many outlier occurrences, a phrase is noise, not a signal
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with', 'at', 'by', 'from',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'this', 'that', 'these', 'those', 'it', 'its',
  'you', 'your', 'our', 'we', 'i', 'my', 'as', 'how', 'what', 'when', 'why', 'so', 'if', 'not', 'no',
]);

/** Splits on anything that isn't a letter/number/apostrophe from any script — this is deliberately grammar-free (PRD §7). */
export function tokenize(text: string): string[] {
  if (!text) return [];
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter(t => t.length > 1 && !STOPWORDS.has(t));
}

/** 1–3 word phrases from a token stream, deduplicated within the text they came from. */
export function phrasesOf(text: string): Set<string> {
  const tokens = tokenize(text);
  const phrases = new Set<string>();
  for (let n = 1; n <= 3; n++) {
    for (let i = 0; i + n <= tokens.length; i++) {
      phrases.add(tokens.slice(i, i + n).join(' '));
    }
  }
  return phrases;
}

/**
 * Groups pins by their source image so a heavily repinned image doesn't get
 * counted once per repin in the keyword table (PRD §7: "group in the keyword
 * view, list separately in results"). Pins with no detectable image URL are
 * each their own group.
 */
export function groupByImage(pins: PinCard[]): PinCard[][] {
  const groups = new Map<string, PinCard[]>();
  const ungrouped: PinCard[][] = [];
  for (const pin of pins) {
    if (!pin.imageUrl) {
      ungrouped.push([pin]);
      continue;
    }
    const list = groups.get(pin.imageUrl);
    if (list) list.push(pin);
    else groups.set(pin.imageUrl, [pin]);
  }
  return [...groups.values(), ...ungrouped];
}

/** One representative per image group — the pin with the highest save count, falling back to the best (lowest) rank. */
export function representativeOf(group: PinCard[]): PinCard {
  return [...group].sort((a, b) => {
    if (a.saveCount != null && b.saveCount != null) return b.saveCount - a.saveCount;
    if (a.saveCount != null) return -1;
    if (b.saveCount != null) return 1;
    return a.rank - b.rank;
  })[0];
}

function textOf(pin: PinCard): string {
  return `${pin.title} ${pin.description}`.trim();
}

export function computeKeywordStats(outliers: PinCard[], rest: PinCard[]): KeywordStat[] {
  const outlierGroups = groupByImage(outliers).map(representativeOf);
  const restGroups = groupByImage(rest).map(representativeOf);

  const outlierSampleSize = outlierGroups.length;
  const restSampleSize = restGroups.length;

  const outlierPhraseCounts = new Map<string, number>();
  for (const pin of outlierGroups) {
    for (const phrase of phrasesOf(textOf(pin))) {
      outlierPhraseCounts.set(phrase, (outlierPhraseCounts.get(phrase) ?? 0) + 1);
    }
  }

  const restPhraseCounts = new Map<string, number>();
  for (const pin of restGroups) {
    for (const phrase of phrasesOf(textOf(pin))) {
      restPhraseCounts.set(phrase, (restPhraseCounts.get(phrase) ?? 0) + 1);
    }
  }

  const stats: KeywordStat[] = [];
  for (const [phrase, outlierCount] of outlierPhraseCounts) {
    if (outlierCount < MIN_PHRASE_SAMPLE) continue;
    const restCount = restPhraseCounts.get(phrase) ?? 0;

    // Laplace smoothing (+1 on both sides) so a phrase absent from "rest" reads
    // as strongly over-represented rather than divides by zero.
    const outlierRate = (outlierCount + 1) / (outlierSampleSize + 1);
    const restRate = (restCount + 1) / (restSampleSize + 1);
    const ratio = outlierRate / restRate;

    stats.push({ phrase, outlierCount, outlierSampleSize, restCount, restSampleSize, ratio });
  }

  return stats.sort((a, b) => b.ratio - a.ratio || b.outlierCount - a.outlierCount);
}

export function computeDomainStats(outliers: PinCard[]): DomainStat[] {
  const groups = groupByImage(outliers).map(representativeOf);
  const sampleSize = groups.length;
  const counts = new Map<string, number>();
  for (const pin of groups) {
    if (!pin.domain) continue;
    counts.set(pin.domain, (counts.get(pin.domain) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([domain, outlierCount]) => ({ domain, outlierCount, outlierSampleSize: sampleSize }))
    .sort((a, b) => b.outlierCount - a.outlierCount);
}

/** ~2:3 "standard" band centred on Pinterest's own recommended ratio, plus square, tall and very-tall neighbours. */
function aspectBand(width: number, height: number): string {
  const ratio = height / width;
  if (ratio <= 1.1) return 'Square (~1:1)';
  if (ratio <= 1.6) return 'Standard (~2:3)';
  if (ratio <= 2.2) return 'Tall (~1:2)';
  return 'Very tall (>1:2)';
}

export function computeFormatStats(outliers: PinCard[]): FormatStats {
  const groups = groupByImage(outliers).map(representativeOf);
  const sampleSize = groups.length;

  const aspectCounts = new Map<string, number>();
  const overlayCounts = new Map<string, number>();

  for (const pin of groups) {
    if (pin.imageWidth && pin.imageHeight) {
      const band = aspectBand(pin.imageWidth, pin.imageHeight);
      aspectCounts.set(band, (aspectCounts.get(band) ?? 0) + 1);
    }
    const overlayLabel = pin.hasTextOverlay === true ? 'Text overlay' : pin.hasTextOverlay === false ? 'Plain image' : 'Not detected';
    overlayCounts.set(overlayLabel, (overlayCounts.get(overlayLabel) ?? 0) + 1);
  }

  const toBands = (counts: Map<string, number>): FormatBand[] =>
    [...counts.entries()]
      .map(([label, count]) => ({ label, count, fraction: sampleSize ? count / sampleSize : 0 }))
      .sort((a, b) => b.count - a.count);

  return { aspectBands: toBands(aspectCounts), textOverlay: toBands(overlayCounts), sampleSize };
}
