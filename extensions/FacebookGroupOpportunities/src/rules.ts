/**
 * The rules engine (README's shared-module table: "two-part intent+topic
 * matching, starter packs, hit counts"). Deliberately pure — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check it headlessly, and so it can
 * run inside the content script's tight per-post budget (PRD §6: < 5 ms per
 * post at 50 rules).
 *
 * Matching is literal, case-insensitive substring matching. No stemming, no
 * NLP — the PRD is explicit that rules are literal strings so non-English
 * groups are supported "without pretending to do NLP" (§7).
 */

import { Opportunity, Rule, RuleHit } from './types';

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
 * A rule matches when the post contains at least one match phrase AND at
 * least one topic word AND none of the ignore words — the two-part check the
 * PRD says "keeps the noise down" (§4). Returns the first phrase/word that hit,
 * for the reason chip; order of rule.matchPhrases/topicWords is the priority.
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

/** `💡 opportunity — "looking for" + "bookkeeper"` — the in-feed reason chip (PRD §4). */
export function formatReasonChip(hit: RuleHit): string {
  return `\u{1F4A1} opportunity — "${hit.matchPhrase}" + "${hit.topicWord}"`;
}

/* ── Hit counts ──────────────────────────────────────────────────────────
 * "seen 3 similar posts this week" per rule (PRD §4) — derived from the
 * stored opportunities rather than a separate counter, so it can never drift
 * out of sync with what the panel actually shows. */

export interface RuleHitSummary {
  ruleId: string;
  ruleName: string;
  total: number;
  last7Days: number;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function summarizeHits(rules: Rule[], items: Opportunity[], now = Date.now()): RuleHitSummary[] {
  return rules.map(rule => {
    let total = 0;
    let last7Days = 0;
    for (const item of items) {
      const hitCount = item.matches.filter(m => m.ruleId === rule.id).length;
      if (!hitCount) continue;
      total += hitCount;
      if (now - item.capturedAt <= WEEK_MS) last7Days += hitCount;
    }
    return { ruleId: rule.id, ruleName: rule.name, total, last7Days };
  });
}

/** Human sentence for the panel: "Seen 3 similar posts this week". */
export function describeWeeklyHits(summary: RuleHitSummary): string {
  if (summary.last7Days === 0) return 'No matches this week yet';
  const noun = summary.last7Days === 1 ? 'post' : 'posts';
  return `Seen ${summary.last7Days} similar ${noun} this week`;
}

/* ── Validation ──────────────────────────────────────────────────────────
 * Kept here, not in the panel, so the "does this rule actually do anything"
 * question has one answer used by both the UI and the tests. */

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
