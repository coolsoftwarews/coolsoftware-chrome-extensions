/**
 * The DOM half: finding a job posting on the page and reading whatever
 * LinkedIn has rendered for it (PRD §5 — "reads only the job posting's own
 * rendered page"). No API calls, no background crawling.
 *
 * LinkedIn ships class names that change without notice, so every selector
 * here is a best-effort heuristic with a fallback chain, and every field is
 * optional — a field LinkedIn didn't render becomes an empty string/null
 * rather than throwing (PRD §7: "a job with no salary/location shown"). This
 * file is DOM-bound and cannot be checked headlessly; it is covered by the
 * manual checklist in README.md, the same split WebHighlighter/
 * InstagramResearchSaver/LinkedInCreatorWatchlist use for their DOM layers.
 */

import { extractSalary, looksClosed, splitPrimaryDescription, truncateText } from './text';
import { RawJobCapture } from './types';

function firstMatch(root: ParentNode, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = root.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

/**
 * The container that owns one job posting's rendered details — either the
 * full permalink page's main content, or the detail pane inside a
 * search/collections split view. Falls back to `document` so extraction
 * still degrades gracefully rather than finding nothing at all.
 */
export function jobDetailRoot(): ParentNode {
  return (
    document.querySelector('.jobs-search__job-details--container') ||
    document.querySelector('.jobs-details__main-content') ||
    document.querySelector('.job-view-layout') ||
    document.querySelector('main') ||
    document
  );
}

function findTitle(root: ParentNode): string {
  const el = firstMatch(root, [
    'h1.job-details-jobs-unified-top-card__job-title',
    'h1.top-card-layout__title',
    '.jobs-unified-top-card__job-title',
    'h1',
  ]);
  return truncateText(text(el), 200);
}

function findCompany(root: ParentNode): string {
  const el = firstMatch(root, [
    '.job-details-jobs-unified-top-card__company-name a',
    '.job-details-jobs-unified-top-card__company-name',
    '.jobs-unified-top-card__company-name',
    '.topcard__org-name-link',
    '[class*="company-name"]',
  ]);
  return truncateText(text(el), 150);
}

function findPrimaryDescriptionText(root: ParentNode): string {
  const el = firstMatch(root, [
    '.job-details-jobs-unified-top-card__primary-description-container',
    '.job-details-jobs-unified-top-card__tertiary-description-container',
    '.jobs-unified-top-card__primary-description',
    '.jobs-unified-top-card__bullet',
    '[class*="primary-description"]',
  ]);
  return text(el);
}

function findSalaryText(root: ParentNode): string | null {
  // Salary usually renders inside a small "job insight" pill, not the
  // primary description line — check those first, then fall back to the
  // whole detail pane so a differently-placed pill still gets picked up.
  const insights = Array.from(
    root.querySelectorAll<HTMLElement>('[class*="job-details-jobs-unified-top-card__job-insight"], [class*="salary"]')
  );
  for (const el of insights) {
    const found = extractSalary(text(el));
    if (found) return found;
  }
  return extractSalary((root instanceof Document ? root.body?.textContent : root.textContent) ?? '');
}

/** Scrapes whatever is available around `root` for a single job posting. */
export function scrapeJob(root: ParentNode, jobUrl: string): RawJobCapture {
  const { location, postedDateRaw } = splitPrimaryDescription(findPrimaryDescriptionText(root));
  return {
    jobUrl,
    title: findTitle(root),
    company: findCompany(root),
    location,
    postedDateRaw,
    salaryRaw: findSalaryText(root),
  };
}

/** True when the posting's own copy says it's no longer taking applications (PRD §7). */
export function isClosedPosting(root: ParentNode): boolean {
  const text = root instanceof Document ? root.body?.textContent : root.textContent;
  return looksClosed(text ?? '');
}

/** True on any URL shape that can plausibly show a single job posting's details. */
export function isJobishUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  return /\/jobs\/view\//.test(href) || /currentJobId=\d+/.test(href);
}
