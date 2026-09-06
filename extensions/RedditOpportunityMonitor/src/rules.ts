/**
 * The rules engine (README's shared-module table: "two-part intent+topic
 * matching, starter packs, hit counts"). Deliberately pure — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check it headlessly, and so it can
 * run inside the content script's tight per-post budget (PRD §6: < 5 ms per
 * post at 50 rules).
 *
 * Matching is literal, case-insensitive substring matching. No stemming, no
 * NLP — non-English subreddits are supported "without pretending to do NLP"
 * (PRD §7), the same way the Facebook pair handles non-English groups.
 */

import { IntentPhraseCount, Opportunity, Rule, RuleHit, SubredditSummary } from './types';

/** Lowercase and collapse whitespace, so "Looking   for\na" matches "looking for a". */
export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function containsToken(normalizedHaystack: string, needle: string): string | null {
  const token = normalizeText(needle);
  if (!token) return null;
  return normalizedHaystack.includes(token) ? token : null;
}

/**
 * A rule matches when the post contains at least one intent phrase AND at
 * least one topic word AND none of the ignore words — the two-part check
 * that keeps the noise down (PRD §4). Returns the first phrase/word that
 * hit, for the reason chip; order of rule.matchPhrases/topicWords is the
 * priority.
 */
export function evaluateRule(postText: string, rule: Rule): RuleHit | null {
  if (!rule.enabled) return null;
  const text = normalizeText(postText);
  if (!text) return null;

  for (const ignore of rule.ignoreWords) {
    if (containsToken(text, ignore)) return null;
  }

  let matchPhrase: string | null = null;
  for (const phrase of rule.matchPhrases) {
    const hit = containsToken(text, phrase);
    if (hit) {
      matchPhrase = phrase.trim();
      break;
    }
  }
  if (!matchPhrase) return null;

  let topicWord: string | null = null;
  for (const topic of rule.topicWords) {
    const hit = containsToken(text, topic);
    if (hit) {
      topicWord = topic.trim();
      break;
    }
  }
  if (!topicWord) return null;

  return { ruleId: rule.id, ruleName: rule.name, matchPhrase, topicWord };
}

/** Every enabled rule that fires on this post, in rule order. */
export function evaluatePost(postText: string, rules: Rule[]): RuleHit[] {
  const hits: RuleHit[] = [];
  for (const rule of rules) {
    const hit = evaluateRule(postText, rule);
    if (hit) hits.push(hit);
  }
  return hits;
}

/** `💡 "looking for" + "invoicing"` — the in-feed reason chip (PRD §4). The
 * caller appends ` · r/subreddit · N comments` — that part is page context,
 * not something the rules engine knows. */
export function formatReasonChip(hit: RuleHit): string {
  return `\u{1F4A1} "${hit.matchPhrase}" + "${hit.topicWord}"`;
}

/* ── Hit counts ──────────────────────────────────────────────────────────
 * "'invoicing' matched 11 times in 30 days" (PRD §4) — derived from the
 * stored opportunities rather than a separate counter, so it can never drift
 * out of sync with what the panel actually shows. */

const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_HIT_WINDOW_DAYS = 30;

export interface RuleHitSummary {
  ruleId: string;
  ruleName: string;
  total: number;
  recent: number;
}

/** Per-rule totals, all-time and within the trailing window — for the rules
 * list, so a rule that has gone quiet is visible without opening the panel's
 * item list. */
export function summarizeRuleHits(
  rules: Rule[],
  items: Opportunity[],
  days = DEFAULT_HIT_WINDOW_DAYS,
  now = Date.now()
): RuleHitSummary[] {
  const cutoff = now - days * DAY_MS;
  return rules.map(rule => {
    let total = 0;
    let recent = 0;
    for (const item of items) {
      const hitCount = item.matches.filter(m => m.ruleId === rule.id).length;
      if (!hitCount) continue;
      total += hitCount;
      if (item.capturedAt >= cutoff) recent += hitCount;
    }
    return { ruleId: rule.id, ruleName: rule.name, total, recent };
  });
}

export interface TopicHitSummary {
  topicWord: string;
  ruleNames: string[];
  count: number;
}

/**
 * The market-signal number the PRD singles out (§4: "more useful than any
 * single thread") — how often each topic word has fired within the window,
 * regardless of which rule carried it. Two rules sharing a topic word count
 * together, since the word is the thing being measured.
 */
export function summarizeTopicHits(
  items: Opportunity[],
  days = DEFAULT_HIT_WINDOW_DAYS,
  now = Date.now()
): TopicHitSummary[] {
  const cutoff = now - days * DAY_MS;
  const map = new Map<string, TopicHitSummary>();
  for (const item of items) {
    if (item.capturedAt < cutoff) continue;
    for (const hit of item.matches) {
      const key = hit.topicWord.toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count++;
        if (!existing.ruleNames.includes(hit.ruleName)) existing.ruleNames.push(hit.ruleName);
      } else {
        map.set(key, { topicWord: hit.topicWord, ruleNames: [hit.ruleName], count: 1 });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/** Human sentence for the panel: `"invoicing" matched 11 times in 30 days`. */
export function describeTopicHit(summary: TopicHitSummary, days = DEFAULT_HIT_WINDOW_DAYS): string {
  const noun = summary.count === 1 ? 'time' : 'times';
  return `"${summary.topicWord}" matched ${summary.count} ${noun} in ${days} days`;
}

/* ── Subreddit read ──────────────────────────────────────────────────────
 * "For the current subreddit, a small summary from what's loaded: post
 * volume, median score, the most common intent phrases" (PRD §4). Pure so it
 * can be unit tested; the content script supplies the scanned posts. */

export interface ScannedPostStat {
  subreddit: string;
  score: number | null;
  /** Title + snippet, already concatenated — the same text rule matching runs on. */
  text: string;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** All distinct intent phrases across enabled rules — the vocabulary used to
 * describe "how this community talks", independent of whether a topic word
 * also matched. */
export function allIntentPhrases(rules: Rule[]): string[] {
  const set = new Set<string>();
  for (const rule of rules) {
    if (!rule.enabled) continue;
    for (const phrase of rule.matchPhrases) {
      const trimmed = phrase.trim();
      if (trimmed) set.add(trimmed);
    }
  }
  return [...set];
}

const MAX_INTENT_PHRASES_SHOWN = 5;

export function summarizeSubreddit(
  subreddit: string,
  posts: ScannedPostStat[],
  intentVocabulary: string[]
): SubredditSummary {
  const inSub = posts.filter(p => p.subreddit.toLowerCase() === subreddit.toLowerCase());
  const scores = inSub.map(p => p.score).filter((s): s is number => s !== null);

  const counts = new Map<string, number>();
  for (const post of inSub) {
    const lower = normalizeText(post.text);
    for (const phrase of intentVocabulary) {
      if (containsToken(lower, phrase)) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
    }
  }
  const topIntentPhrases: IntentPhraseCount[] = [...counts.entries()]
    .map(([phrase, count]) => ({ phrase, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_INTENT_PHRASES_SHOWN);

  return {
    subreddit,
    postsScanned: inSub.length,
    medianScore: median(scores),
    topIntentPhrases,
  };
}

/* ── Validation ──────────────────────────────────────────────────────────
 * Kept here, not in the panel, so "does this rule actually do anything" has
 * one answer used by both the UI and the tests. */

export function isUsableRule(rule: Pick<Rule, 'matchPhrases' | 'topicWords'>): boolean {
  return (
    rule.matchPhrases.some(p => normalizeText(p).length > 0) &&
    rule.topicWords.some(t => normalizeText(t).length > 0)
  );
}

/** Split a textarea's comma/newline-separated list into clean, deduped tokens. */
export function parseTokenList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[,\n]/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}
