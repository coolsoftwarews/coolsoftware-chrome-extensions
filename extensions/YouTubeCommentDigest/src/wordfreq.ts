/**
 * The word-frequency mini-summary (PRD §4): most-repeated words and short
 * phrases across the loaded comments, stopwords filtered, computed entirely
 * client-side. Deliberately not a summary in any AI sense — this file counts,
 * it never interprets.
 *
 * English-only in V1 (PRD §7's documented limitation): the stopword list only
 * understands English function words.
 */

import { Comment, WordFreqEntry, WordFreqResult } from './types';

// A standard-size English stopword list — function words that would otherwise
// dominate any frequency count without saying anything about the video.
const STOPWORDS = new Set(
  (
    'a about above after again against all am an and any are aren arent as at be because been before ' +
    'being below between both but by can cant cannot could couldnt did didnt do does doesnt doing dont ' +
    'down during each few for from further had hadnt has hasnt have havent having he hed hell hes her ' +
    'here heres hers herself him himself his how hows i id ill im ive if in into is isnt it its itself ' +
    'lets me more most mustnt my myself no nor not of off on once only or other ought our ours ourselves ' +
    'out over own same shant she shed shell shes should shouldnt so some such than that thats the their ' +
    'theirs them themselves then there theres these they theyd theyll theyre theyve this those through to ' +
    'too under until up very was wasnt we wed well were weve werent what whats when whens where wheres ' +
    'which while who whos whom why whys with wont would wouldnt you youd youll youre youve your yours ' +
    'yourself yourselves im youre hes shes its were theyre ive youve weve theyve id youd hed shed wed ' +
    'theyd ill youll hell shell well theyll just really like get got one also even still much many way ' +
    'thing things really actually maybe though yeah lol video watch watching watched comment comments ' +
    'youtube channel'
  )
    .split(/\s+/)
    .filter(Boolean)
);

const MIN_WORD_LENGTH = 3;
/** Caps how many times a single comment can contribute to one term's count, so one
 *  spammy or repetitive comment cannot make a term look like a shared reaction. */
const MAX_PER_COMMENT = 3;

function tokenize(text: string): string[] {
  // Apostrophes are dropped rather than kept mid-token, so "don't"/"it's" fold
  // to "dont"/"its" and match the stopword list's own unapostrophized forms.
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? [])
    .map(token => token.replace(/'/g, ''))
    .filter(Boolean);
}

function isContentWord(token: string): boolean {
  return token.length >= MIN_WORD_LENGTH && !STOPWORDS.has(token) && !/^\d+$/.test(token);
}

function rank(counts: Map<string, { count: number; comments: Set<number> }>, limit: number): WordFreqEntry[] {
  return [...counts.entries()]
    .map(([term, data]) => ({ term, count: data.count, commentCount: data.comments.size }))
    .sort((a, b) => b.count - a.count || b.commentCount - a.commentCount || a.term.localeCompare(b.term))
    .slice(0, limit);
}

export interface WordFreqOptions {
  /** Top N entries to keep per list. */
  limit?: number;
}

/**
 * Words are single content tokens; phrases are adjacent word-pairs where
 * neither half is a stopword (so "get the battery" doesn't produce "get the"
 * as a phrase — only genuinely content-bearing pairs like "battery life").
 */
export function computeWordFrequency(comments: Comment[], options: WordFreqOptions = {}): WordFreqResult {
  const limit = options.limit ?? 15;
  const wordCounts = new Map<string, { count: number; comments: Set<number> }>();
  const phraseCounts = new Map<string, { count: number; comments: Set<number> }>();

  comments.forEach((comment, index) => {
    const tokens = tokenize(comment.text);
    const perCommentWord = new Map<string, number>();
    const perCommentPhrase = new Map<string, number>();

    for (let i = 0; i < tokens.length; i += 1) {
      const token = tokens[i];
      if (isContentWord(token)) {
        const used = perCommentWord.get(token) ?? 0;
        if (used < MAX_PER_COMMENT) {
          perCommentWord.set(token, used + 1);
          const entry = wordCounts.get(token) ?? { count: 0, comments: new Set<number>() };
          entry.count += 1;
          entry.comments.add(index);
          wordCounts.set(token, entry);
        }
      }

      const next = tokens[i + 1];
      if (next && isContentWord(token) && isContentWord(next)) {
        const phrase = `${token} ${next}`;
        const used = perCommentPhrase.get(phrase) ?? 0;
        if (used < MAX_PER_COMMENT) {
          perCommentPhrase.set(phrase, used + 1);
          const entry = phraseCounts.get(phrase) ?? { count: 0, comments: new Set<number>() };
          entry.count += 1;
          entry.comments.add(index);
          phraseCounts.set(phrase, entry);
        }
      }
    }
  });

  return { words: rank(wordCounts, limit), phrases: rank(phraseCounts, limit) };
}
