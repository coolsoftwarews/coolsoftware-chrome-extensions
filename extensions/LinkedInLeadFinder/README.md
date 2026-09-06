# LinkedIn Engagement Lead Finder

Chrome MV3 extension. Collect the people commenting on a LinkedIn post, mark the ones matching your
own keyword rules, and export a CSV or Markdown lead list. No account, no backend, no network
requests, and no action taken on your behalf — it only reads what's already rendered in the tab.

Built from
[PRD-11](../../docs/extensions/PRD-11-linkedin-lead-finder.md). Paired with
[LinkedIn Creator Watchlist](../LinkedInCreatorWatchlist) — that one tests content workflow, this one
tests sales intelligence. The storage/backup/export shape follows
[WebHighlighter](../WebHighlighter) and [YouTubeTranscription](../YouTubeTranscription).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, dedupe/merge, rules, CSV, Markdown, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/text.ts` | Pure string/number parsing — reaction counts, profile URL normalization |
| `src/rules.ts` | Qualification: plain keyword matching over headline + comment text |
| `src/dedupe.ts` | Merges a freshly scraped comment into the right lead, or creates one |
| `src/formatters.ts` | CSV and Markdown export, filenames — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` leads + rules, backup export/import, quota |
| `src/metrics.ts` | Local-only usage counters |
| `src/linkedin-dom.ts` | Finds posts and comment threads on a live page, reads what's rendered |
| `src/content.ts` | Injects "Collect commenters" per post, runs a collection, persists it |
| `src/background.ts` | Opens the side panel, disables it off linkedin.com |
| `src/panel.ts` | The lead list: search, status filter, grouping, rules editor, export, data ownership |

### Collecting a lead

A small control appears under the visible comment thread on any post:

```
Collect commenters (34 visible)
```

Clicking it reads only the comments currently rendered in the DOM — nothing is scrolled, expanded,
or fetched on the user's behalf. For each commenter it captures name, headline, profile URL, their
comment text, the comment's reaction count, which post it came from, and the date exactly as
LinkedIn rendered it (never re-interpreted, since a relative label like "2d" isn't a real timestamp).

Every capture is merged into a single lead record keyed by the person's normalized profile URL, so
the same person commenting on a second post increments **seen on N posts** instead of creating a
duplicate row — repeat engagers are the strongest signal this product surfaces (PRD §4).

### Qualification

Rules are plain, case-insensitive, user-defined keywords (`founder`, `head of`, `hiring`, `looking
for` ship as a starting set) matched against a lead's headline and every comment it made. A match
adds a star; it never hides anything — the user always sees every lead they collected, matching PRD
§4. Because a rule is just the user's own text, it works in any language without a translation layer.

### The cap

An individual "Collect commenters" click reads at most 500 comment nodes and reports when it hit
that cap, and separately reports how many comments LinkedIn's own count says are not yet loaded
("click 'Load more comments' to see them") — see PRD §7.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` anywhere in this extension — verifiable with
`grep -rn "fetch(" src/` and in devtools' network tab. Leads, rules and usage counters live in
`chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## What this extension will never do

No auto-connect, auto-message, auto-like, auto-visit, or any request the user didn't make by
clicking. This is a permanent product boundary, not a V1 limit (PRD §4) — it's what keeps a user's
LinkedIn account safe and this extension in the Chrome Web Store. If you're looking for outreach
automation, this isn't it, on purpose. Also permanently out of scope: email or phone enrichment
(resolving a person to contact details is a different legal category — PRD §5) and any data joined in
from outside the tab.

## Manual test checklist

The DOM-bound half (`src/linkedin-dom.ts`, `src/content.ts`) needs a real, logged-in LinkedIn session
and cannot be unit tested — LinkedIn's class names are unstable and differ a little between the main
feed and a single post's permalink page. Before shipping, walk this by hand:

- [ ] A feed post with a handful of comments — button shows the right visible count, collects correctly
- [ ] A post's own permalink page (`/posts/...-activity-.../`)
- [ ] A very long thread (100+ comments) — cap and "not yet loaded" message both report correctly
- [ ] A thread with at least one anonymized/deleted commenter ("LinkedIn Member", no profile link)
- [ ] A thread with a company page commenting, not a person
- [ ] Re-collecting the same post twice — no duplicate leads, reaction counts refresh
- [ ] The same person on two different posts — one lead, "seen on 2 posts"
- [ ] A non-English post and comments, with a rule keyword typed in that language
- [ ] Panel: search, status filter, qualified-only, group-by-post, note editing
- [ ] Export CSV and Markdown, then open the CSV in a spreadsheet and confirm columns/quoting
- [ ] Data → export all → clear all → import → everything comes back
- [ ] Scrolling the feed rapidly (mutation-driven re-scans stay responsive, no visible jank)

If LinkedIn changes its markup and the control stops appearing, update the selector lists at the top
of `src/linkedin-dom.ts` — nothing else in the extension needs to change.

## Known limits

- Selectors are best-effort against LinkedIn's current markup and will need periodic maintenance
  (PRD §7, "LinkedIn DOM rewrites") — this is inherent to reading someone else's page, not a bug.
- Anonymized/deleted commenters have no profile URL, so they dedupe on name + headline only; two
  different anonymized people with an identical headline could merge. Documented rather than silently
  wrong: the export always shows the "Anonymized" flag so this is visible.
- Reply threads are captured the same way as top-level comments; the export does not currently
  distinguish a reply from a top-level comment.
- No enrichment, ever — see "What this extension will never do" above.
