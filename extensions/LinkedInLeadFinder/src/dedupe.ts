/**
 * Merging is the whole point of collecting from more than one post: the same
 * person commenting again is the strongest signal in the product (PRD §4,
 * "seen on 3 posts"). This file is pure — no chrome.* here — so the merge
 * behaviour is covered by scripts/selftest.mjs without a browser.
 */

import { Capture, Lead, RawCapture } from './types';
import { cleanText, isCompanyUrl, normalizeProfileUrl } from './text';

/**
 * The dedupe key for a raw capture. A resolvable profile/company URL is
 * always preferred. Anonymized or deleted commenters (PRD §7) have no URL to
 * key on; falling back to name+headline is a best effort that will merge two
 * different "LinkedIn Member"s only if they also share a headline, which is
 * the safer failure direction (an extra row beats a wrongly merged one).
 */
export function dedupeKey(capture: Pick<RawCapture, 'profileUrl' | 'name' | 'headline'>): string {
  const normalized = normalizeProfileUrl(capture.profileUrl);
  if (normalized) return normalized;
  const name = cleanText(capture.name).toLowerCase();
  const headline = cleanText(capture.headline).toLowerCase();
  return `anon:${name}|${headline}`;
}

function toCapture(raw: RawCapture, now: number): Capture {
  return {
    postUrl: raw.postUrl,
    postLabel: raw.postLabel,
    commentText: cleanText(raw.commentText),
    reactionCount: raw.reactionCount,
    commentDate: cleanText(raw.commentDate),
    collectedAt: now,
  };
}

export function emptyLead(raw: RawCapture, now: number): Lead {
  const profileUrl = normalizeProfileUrl(raw.profileUrl);
  return {
    id: dedupeKey(raw),
    name: cleanText(raw.name) || 'LinkedIn Member',
    headline: cleanText(raw.headline),
    profileUrl,
    isCompany: raw.isCompany || isCompanyUrl(profileUrl),
    isAnonymized: raw.isAnonymized || !profileUrl,
    captures: [toCapture(raw, now)],
    status: 'new',
    note: '',
    firstCollectedAt: now,
    lastCollectedAt: now,
  };
}

/**
 * Folds one freshly scraped capture into an existing lead (or creates one).
 * Re-collecting the same person from the same post updates that post's
 * capture in place rather than appending a duplicate — the "seen on N posts"
 * count must reflect distinct posts, not distinct clicks.
 */
export function mergeCapture(existing: Lead | undefined, raw: RawCapture, now: number): Lead {
  if (!existing) return emptyLead(raw, now);

  const capture = toCapture(raw, now);
  const captures = existing.captures.some(c => c.postUrl === capture.postUrl)
    ? existing.captures.map(c => (c.postUrl === capture.postUrl ? capture : c))
    : [...existing.captures, capture];

  return {
    ...existing,
    // Late-arriving headline/name text (a slow-loading page) is worth keeping
    // if we didn't have one before, but never overwrites a value we already have.
    name: existing.name === 'LinkedIn Member' && raw.name ? cleanText(raw.name) || existing.name : existing.name,
    headline: existing.headline || cleanText(raw.headline),
    captures,
    lastCollectedAt: now,
  };
}

/** Distinct posts a lead has been seen commenting on — the headline metric of the panel. */
export function seenOnCount(lead: Pick<Lead, 'captures'>): number {
  return new Set(lead.captures.map(c => c.postUrl)).size;
}
