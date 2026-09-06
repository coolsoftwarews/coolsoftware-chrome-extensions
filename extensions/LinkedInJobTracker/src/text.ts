/**
 * Pure string parsing for whatever LinkedIn happens to render on a job
 * posting. Nothing here touches the DOM, so it is unit tested directly
 * (scripts/selftest.mjs). The DOM-bound half — finding *which* elements hold
 * this text — lives in src/scrape.ts and is covered by the manual checklist
 * in README.md, same split as LinkedInCreatorWatchlist's text.ts/content.ts.
 */

/** Collapses whitespace and caps length without cutting mid-character. */
export function truncateText(raw: string, max = 300): string {
  const collapsed = (raw ?? '').replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return Array.from(collapsed).slice(0, max).join('').trimEnd() + '…';
}

/**
 * LinkedIn's "primary description" line under a job title bundles location,
 * posted-date and sometimes an applicant count into one string, separated by
 * a middle-dot bullet — e.g. "San Francisco, CA · 3 days ago · Over 100
 * applicants" or "Remote · Reposted 2 weeks ago". Split it and classify each
 * segment rather than assuming a fixed position, since the number of
 * segments varies posting to posting.
 */
export function splitPrimaryDescription(raw: string): { location: string; postedDateRaw: string } {
  const segments = (raw ?? '')
    .split(/[•·]/)
    .map(s => s.trim())
    .filter(Boolean);

  let location = '';
  let postedDateRaw = '';
  for (const segment of segments) {
    if (/\b(ago|reposted|just now)\b/i.test(segment)) {
      if (!postedDateRaw) postedDateRaw = segment;
    } else if (/applicant/i.test(segment)) {
      // skip — applicant count, not captured (PRD §4 field table doesn't ask for it)
    } else if (!location) {
      location = segment;
    }
  }
  return { location, postedDateRaw };
}

/**
 * A LinkedIn salary pill reads like "$120,000/yr - $150,000/yr" or
 * "$45.00/hr - $60.00/hr" or a single figure. Returns the matched text
 * verbatim (PRD §4: capture the range as shown, never re-derive a number)
 * or null when nothing salary-shaped is present — a posting with no salary
 * is an expected, common case (PRD §7), not a parsing failure.
 */
export function extractSalary(blockText: string): string | null {
  const match = (blockText ?? '').match(
    /\$[\d,]+(?:\.\d+)?[Kk]?(?:\s*\/\s*(?:yr|hr|hour|year))?(?:\s*-\s*\$?[\d,]+(?:\.\d+)?[Kk]?(?:\s*\/\s*(?:yr|hr|hour|year))?)?/
  );
  return match ? match[0].trim() : null;
}

/** True when the posting's own copy says it's no longer taking applications (PRD §7). */
export function looksClosed(blockText: string): boolean {
  return /no longer accepting applications/i.test(blockText ?? '');
}
