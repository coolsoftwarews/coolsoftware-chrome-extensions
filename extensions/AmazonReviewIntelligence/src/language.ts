/**
 * A listing can carry reviews in more than one language (PRD §7: "cluster per
 * language, don't blend"). There is no LLM here, so language is bucketed by
 * counting which Unicode script dominates the text — coarse, but enough to
 * stop an English cluster and a German cluster being averaged into mush.
 */

import { LanguageBucket } from './types';

const SCRIPT_PATTERNS: Array<[LanguageBucket, RegExp]> = [
  ['cyrillic', /\p{Script=Cyrillic}/gu],
  ['cjk', /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu],
  ['hangul', /\p{Script=Hangul}/gu],
  ['arabic', /\p{Script=Arabic}/gu],
  ['greek', /\p{Script=Greek}/gu],
  ['hebrew', /\p{Script=Hebrew}/gu],
  ['latin', /\p{Script=Latin}/gu],
];

/**
 * The script with the most code points wins. CJK is checked before the
 * generic Han/Hangul split matters here only in that Hangul is reported
 * distinctly when it dominates; ties fall back to 'latin' since most Amazon
 * locales (.com/.co.uk/.de/.fr/...) are Latin-script and short reviews with
 * few letters (e.g. "Meh.") shouldn't get stranded in 'other'.
 */
export function detectLanguageBucket(text: string): LanguageBucket {
  if (!text || !text.trim()) return 'latin';

  let best: LanguageBucket = 'other';
  let bestCount = 0;
  for (const [bucket, pattern] of SCRIPT_PATTERNS) {
    const count = (text.match(pattern) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = bucket;
    }
  }
  return bestCount > 0 ? best : 'latin';
}
