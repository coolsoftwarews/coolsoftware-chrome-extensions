/** Word count and a reading-time estimate. Deliberately simple (PRD-39 §10). */

const WORDS_PER_MINUTE = 225;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Always at least 1 minute, so a short piece never reads as "0 min read". */
export function estimateReadingMinutes(wordCount: number, wpm: number = WORDS_PER_MINUTE): number {
  if (wordCount <= 0) return 0;
  return Math.max(1, Math.round(wordCount / wpm));
}
