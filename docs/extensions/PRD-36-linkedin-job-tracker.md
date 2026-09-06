# PRD — LinkedIn Job Application Tracker (read-only)

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

A local kanban for your job search, built into LinkedIn: track any posting you view — Saved through Applied, Interviewing, Offer, Rejected or Withdrawn — with notes, and export the lot.

## 2. The hypothesis

Every LinkedIn extension found in current market research targets the side of the platform that's selling something: folk X, Lusha, Dux-Soup, Lemlist, Salesforce connectors, LeadLeaper, Bluedot AI — sales reps, recruiters and agencies prospecting for leads and candidates. Not one of them targets the person on the *other* side of that transaction: the job seeker, browsing postings and trying to keep track of where each one stands.

Job seekers vastly outnumber SDRs and recruiters, and the tooling gap shows it: today, tracking a job search means a messy personal spreadsheet, a wall of open tabs, or nothing at all — memory. LinkedIn's own "Saved jobs" list is a bookmark, not a pipeline; it has no stages, no notes, no record of what happened after you clicked Apply.

**The hypothesis:** a lightweight, purely local kanban for job postings viewed on LinkedIn — Saved → Applied → Interviewing → Offer → Rejected → Withdrawn, with notes per job — serves a much larger and completely unserved audience than any tool currently listed for this platform. If this hypothesis holds, it also argues that the "workflow tool for the underserved side of a two-sided platform" pattern is worth hunting for on other platforms with an obvious sales/recruiting extension population.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Active job seekers | Keep every posting they've looked at in one place, with where it stands |
| Career changers | Track parallel applications across very different roles without losing context |
| Passive browsers | Save a posting worth a second look without committing to "applying" yet |
| New grads | Manage a first job search with no existing system, without building a spreadsheet from scratch |

## 4. Scope — V1

### In scope

**"+ Track this job" button**, shown while viewing any job posting on LinkedIn (the direct job page, or the detail pane inside search/collections results). Captures, at the moment of tracking:

| Field | Source |
| :-- | :-- |
| Job title | Page |
| Company | Page |
| Location | Page |
| Posted date | Page (whatever LinkedIn renders — a raw label, not a computed absolute date) |
| Salary | Page, only if LinkedIn shows a range on the posting |
| Job URL | Page, normalized to a stable job id |

**Side panel — kanban.** Opened from the toolbar icon. Jobs are grouped into six stages: **Saved · Applied · Interviewing · Offer · Rejected · Withdrawn**. Moving a job between stages is a dropdown control on the card (drag-and-drop is not required for V1 — a dropdown satisfies the same job with far less code and no accessibility gap for keyboard users).

**Notes per job.** A free-text field per tracked job — interview dates, contact names, anything the user wants to remember. The extension does **not** extract contact emails or phone numbers from the page; notes are entirely user-typed, keeping this on the safe side of what a read-only, no-account extension should be doing with other people's contact information.

**"Days since last update" indicator.** Not a push notification and not a background reminder — V1 has no `chrome.alarms`, no background polling, nothing that runs when the browser isn't focused on the extension's own surfaces. Each card in the panel shows a simple, computed "Updated 12 days ago" line (derived from the last time its stage or note changed), which is enough of a nudge without any background machinery.

**Export.** CSV (one row per job, every field above plus stage, note, tracked date, last-update date) and Markdown (one section per job, grouped by stage). **JSON export / import (merge) / clear all** — the full-backup format, re-importable without duplicating a job already tracked.

### Explicitly out of scope for V1

- **No auto-application or auto-fill of LinkedIn's Easy Apply forms.** This is a write action against the user's account and the platform — permanently excluded, not a V1 gap. The only actions this extension ever takes on LinkedIn's own DOM are reading it and inserting its own "+ Track this job" button; it never submits a form, clicks Apply, or fills a field on the user's behalf.
- **No salary-data aggregation across users.** Comparing "what similar roles pay across everyone using this extension" needs a backend to pool data — that's a different, server-backed product, not this one.
- **No resume or cover-letter storage.** V1 tracks metadata about a job and the user's notes on it, not documents. Adding file storage changes both the storage-quota math and the privacy story, and isn't needed to test the underlying hypothesis.
- No account, no sync, no cloud. No reminders/notifications beyond the passive "days since" line. No browser action beyond reading the current tab's rendered page.

## 5. Where the data comes from — read before committing

This extension reads only the job posting's own rendered page: title, company, location, description text, and a salary range when LinkedIn itself shows one on the posting. No API calls, no background crawling of other postings, no write actions against the user's account.

One thing this can't do reliably: know whether the user actually completed an Easy Apply flow after clicking it. LinkedIn's own UI gives no durable, readable-after-the-fact signal that distinguishes "opened the Easy Apply modal and closed it" from "submitted." Rather than guess and risk the extension silently claiming a false "Applied" state the user never actually reached, **the Saved → Applied transition (like every stage transition) is always a manual action the user takes in the panel or on the page — never an automatic detection.** This is the same posture as the rest of the product: read what's visibly true, never infer what isn't.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Track → confirmation | < 200 ms, no navigation away from the posting |
| Panel with 300 tracked jobs | Opens < 500 ms, scrolls smoothly |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel` + host permission `*://*.linkedin.com/*` |
| Storage | Warn at 80% of `chrome.storage.local`'s quota; export prompt always available |
| Privacy | No network requests of any kind — no `fetch`, `XMLHttpRequest`, `sendBeacon`, `WebSocket` |
| Read-only on LinkedIn | No code path posts, applies, connects, follows or messages — the only DOM writes are the extension's own injected button and card |

## 7. Edge cases

- **A job posting closed or expired after being tracked.** Still show it in the panel, marked stale (e.g. "No longer accepting applications" badge). Never delete the user's notes or move it out of its stage automatically — the user decides what a closed posting means for their pipeline (withdraw it, or leave it as a record of an application already in progress).
- **Duplicate postings re-listed by the same company.** LinkedIn issues a new job id for a re-post; that's treated as a distinct job by design (it's a new listing, potentially a new requisition), not merged into the original.
- **A job with no salary or no location shown.** Both fields are optional; a posting missing either stores that field as empty rather than a placeholder value, and the panel/export show a plain dash, never a fabricated "0" or "N/A" that could be misread as data.
- **The same job viewed via search results vs. the direct job page.** These are different DOM layouts (a detail pane inside a two-column search/collections view vs. a full permalink page), so dedupe **must** key on the job id parsed out of the URL (the numeric id LinkedIn assigns, read from the `/jobs/view/{id}` path or the `currentJobId` query parameter), never on page-layout-specific scraping — the same job seen both ways must always resolve to exactly one tracked card, with metadata refreshed from whichever view most recently supplied a field.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who track ≥ 3 jobs | 45% | 60% |
| Users who move a job past "Saved" | 40% | 55% |
| Export used ≥ once | 20% | 30% |
| Median tracked jobs per active user | 6 | 15 |

Movement past "Saved" matters most: a job tracker that only ever collects postings and never reflects a pipeline in motion hasn't proven it's doing more than LinkedIn's own bookmark feature already does.

## 9. Kill criteria

Under 300 installs at 90 days, **or** fewer than 25% of installs ever moving a tracked job out of the "Saved" stage. The second failing means the product read as a slightly nicer bookmarklet rather than a tracker — the whole point of a stage model — and more stages or a prettier board won't fix a positioning problem.

## 10. Open questions

- **Is six stages the right number, or too many for a V1 users adopt in one sitting?** Saved/Applied/Interviewing/Offer are the obvious four; Rejected and Withdrawn exist so a job never has to be deleted to leave the "active" view, but if usage data shows most users leave every rejected job sitting in "Applied" forever, that's a sign the extra two stages aren't earning their place in the initial UI and could move behind a "show closed" toggle in V2.
- **Does the "days since last update" line actually change behavior, or does it need to become an actual reminder (which V1 deliberately excludes) to matter?** If 90-day data shows tracked jobs going stale for months with no engagement from the panel, that's evidence the honest, no-alarms nudge isn't enough — worth a V2 conversation, not a V1 scope change.
- **Salary-range capture rate.** Unknown ahead of a live-page spike what fraction of postings actually expose a parsable salary range in the rendered page versus require expanding a details section. If the rate is low, the field is still worth keeping (never silently dropped), but the store listing shouldn't lean on it as a headline feature.
