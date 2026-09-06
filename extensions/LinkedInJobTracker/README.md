# LinkedIn Job Application Tracker (read-only)

Chrome MV3 extension. A local kanban for your job search, built into LinkedIn: track any posting
you view — Saved → Applied → Interviewing → Offer → Rejected → Withdrawn — with notes, and export
the lot as CSV, Markdown or JSON. No account, no backend, no network requests, and no code path
that ever writes anything back to LinkedIn on your behalf.

Built from [PRD-36](../../docs/extensions/PRD-36-linkedin-job-tracker.md). The storage
layer follows the "Saver" pattern from
[docs/extensions/README.md](../../docs/extensions/README.md#shared-modules) — the
same shape as [InstagramResearchSaver](../InstagramResearchSaver)'s `storage.ts` (capture card,
notes, search, CSV/MD/JSON export, import, clear) — with the "collection" axis replaced by a fixed
set of pipeline stages instead of user-created folders, since PRD §4 defines the stages, not the user.
The LinkedIn DOM-reading conventions (stable-string/best-effort extraction, SPA navigation watching,
shadow-DOM overlay UI) follow [LinkedInCreatorWatchlist](../LinkedInCreatorWatchlist).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — capture cards, stages, exports, storage/import
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/capture.ts` | Pure logic — job id/URL normalization (dedupe across page layouts), re-track merge, stage transitions, note edits, staleness, "days since last update" |
| `src/text.ts` | Pure text parsing — location/posted-date splitting, salary-range extraction, closed-posting detection |
| `src/scrape.ts` | The DOM half: finding a job posting's details container and reading whatever LinkedIn rendered |
| `src/content.ts` | Injects the "+ Track this job" button and the stage/note card, wires capture → storage, passively flags a tracked posting as stale |
| `src/formatters.ts` | CSV and Markdown export, grouped by stage — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records: tracked jobs, backup export/import, quota status |
| `src/metrics.ts` | Local-only usage counters |
| `src/background.ts` | Opens the side panel |
| `src/panel.ts` | Side panel: the whole pipeline as stacked stage sections, note editing, stage dropdown, export, data ownership |

### Dedupe by job id parsed from the URL — not by page layout (PRD §7)

The same job posting is reachable two different ways on LinkedIn: a permalink page
(`/jobs/view/{id}/...`) and a detail pane inside search/collections results
(`?currentJobId={id}`). Both have completely different surrounding DOM. `capture.ts#jobIdFromUrl`
reads the numeric id from whichever the current URL actually has, and every stored job is keyed on
that id — so the same posting viewed both ways always resolves to one tracked card, never two.

### Applied is always a manual click (PRD §5)

LinkedIn's Easy Apply flow gives no durable, readable-after-the-fact signal that distinguishes
"opened the modal and closed it" from "submitted." Rather than guess and risk a false "Applied"
state, every stage transition — including Saved → Applied — is a deliberate action the user takes,
never an automatic detection based on what the extension noticed happen on the page.

### Passive staleness, not a background crawler (PRD §7)

When the user revisits a job posting they already track, the content script checks the currently
rendered page for LinkedIn's own "No longer accepting applications" copy and flags the card stale if
so — this only ever reads the tab already open in front of the user; there is no polling, no
`chrome.alarms`, and nothing runs when LinkedIn isn't the active tab. A stale card is never deleted
and its note/stage are never touched — the user decides what a closed posting means for their
pipeline.

### "Days since last update," not a reminder (PRD §4)

V1 has no push notifications and no background alarms. Each card shows a computed "Updated N days
ago" line, derived from `lastActivityAt` (bumped only by a stage change or a note edit — a passive
metadata refresh from re-visiting the page does **not** count as activity, since that's not
something the user actually did). This is a nudge visible when the panel is open, not a reminder that
fires on its own.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Tracked jobs, notes and usage counters live in `chrome.storage.local` and are
never transmitted. Host access is scoped to `*.linkedin.com` only. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real, logged-in LinkedIn session and cannot be checked headlessly:

- [ ] Open a job posting directly (`/jobs/view/{id}/`) — the "+ Track this job" button appears
- [ ] Open the same job from a search results split-pane view (`?currentJobId={id}`) — the button
      appears in this layout too, and tracking it lands on the *same* card as the permalink view
- [ ] Track a job, confirm the stage dropdown and note field in the inline card, set both, confirm
      they land in the panel
- [ ] Re-track the same job a second time — one card, metadata refreshed, stage and note untouched
- [ ] A posting with no visible salary range — the field is blank in the panel/export, not "null"
- [ ] A posting with no visible location — same
- [ ] Move a tracked job through every stage from the panel's dropdown, confirm "days since last
      update" resets to "today" on each move
- [ ] Revisit an already-tracked posting that is now closed ("No longer accepting applications") —
      the card gets flagged stale without moving its stage or clearing its note
- [ ] SPA navigation from a search results list → a job's detail pane → a different job, and via the
      browser back button — the button/card track the currently-viewed job correctly each time
- [ ] Delete a tracked job from the panel
- [ ] Export CSV, Markdown and JSON; re-import the JSON backup and confirm no duplicates
- [ ] Clear all data, confirm the panel returns to its empty state
- [ ] 300 tracked jobs — panel opens in under 500 ms and scrolls smoothly (PRD §6)

## Known limits

- LinkedIn's DOM is not documented and changes without notice; selectors are best-effort with
  graceful fallback to empty/null fields rather than a thrown error, per PRD §7.
- Salary-range capture depends entirely on whether LinkedIn itself renders a range on the posting;
  many postings show none, and that's expected, not a bug.
- No API access and no background crawling — the "days since last update" line only updates while
  the panel is open or a tracked posting is revisited; it is not a live countdown.
- The stale flag is only ever set/cleared while the user is actually looking at that specific job's
  page; a posting that closes while the user is not on it stays marked non-stale until they revisit.
