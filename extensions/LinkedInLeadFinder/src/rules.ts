/**
 * Qualification, done locally (PRD §4). Rules never filter — the user always
 * sees every lead they collected — they only mark a lead with a star and say
 * why. Matching is a plain case-insensitive substring test over the headline
 * and every comment captured, which is deliberate: it needs no dictionary and
 * it works for whatever language the user types their keyword in (PRD §7,
 * "non-English headlines and comments" — the fix is that rules are the
 * user's own words, not an English-only list we ship).
 */

import { Lead, Rule, RuleMatch } from './types';

export const DEFAULT_RULE_KEYWORDS = ['founder', 'head of', 'hiring', 'looking for'];

export function newRuleId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultRules(): Rule[] {
  return DEFAULT_RULE_KEYWORDS.map(keyword => ({ id: newRuleId(), keyword, enabled: true }));
}

function haystack(lead: Pick<Lead, 'headline' | 'captures'>): string {
  return [lead.headline, ...lead.captures.map(c => c.commentText)].join('\n').toLowerCase();
}

/** Pure: given a lead's text and the active rules, which keywords hit. */
export function evaluateLead(lead: Pick<Lead, 'headline' | 'captures'>, rules: Rule[]): RuleMatch {
  const text = haystack(lead);
  const matched = rules
    .filter(rule => rule.enabled && rule.keyword.trim())
    .filter(rule => text.includes(rule.keyword.trim().toLowerCase()))
    .map(rule => rule.keyword);

  return { qualified: matched.length > 0, matchedKeywords: [...new Set(matched)] };
}
