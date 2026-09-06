# LinkedIn Creator Watchlist

Chrome MV3 extension. Watch a handful of specific people on LinkedIn and see their best posts
in one place, collected as you browse — instead of hoping the feed shows them to you. No account,
no backend, no LinkedIn API, no network requests.

Built from [PRD-10](../../docs/extensions/PRD-10-linkedin-creator-watchlist.md). Its pair,
[LinkedIn Engagement Lead Finder](../../docs/extensions/PRD-11-linkedin-lead-finder.md), tests
sales intelligence on the same platform; this one tests a content workflow.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, outlier engine, CSV/Markdown export
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/text.ts` | Pure parsing: count strings ("1.2K"), relative dates ("2d", "3mo"), text preview, URL normalization |
| `src/outliers.ts` | The outlier engine — median baseline per person, ratio badge, sample-size honesty |
| `src/export.ts` | CSV and Markdown export — pure, fully tested |
| `src/content.ts` | Runs on linkedin.com: the Watch button, and capturing posts from watched people as they appear |
| `src/storage.ts` | `chrome.storage.local` records for people and posts, backup export/import, quota status |
| `src/metrics.ts` | Local-only usage counters |
| `src/panel.ts` | Side panel: the watchlist, sort/filter, notes, export, data ownership |
| `src/background.ts` | Opens the side panel from the toolbar icon. That is its entire job. |

### Collection is browsing-driven, not a crawler (PRD §4, §6)

Nothing is scraped in bulk and nothing is fetched. `src/content.ts` reads whatever LinkedIn has
already rendered in the current tab: when a post from someone **already on the watchlist** appears —
in the feed, on their profile, in search results — it is captured or updated. Posts from people who
are not being watched are never read into storage, even transiently. The panel says this plainly:
"collected from N posts you've seen."

A "+ Watch" button appears next to every author line and on profile pages; clicking it is the only
way a person joins the watchlist. There is no way to bulk-add anyone.

### Read-only, always (PRD §5)

There is no code path anywhere in this extension that posts, likes, comments, follows, connects or
messages on the user's behalf. It has no ability to act as the user at all — see
[PRIVACY.md](PRIVACY.md) and PRD §5, which calls this out as a permanent constraint, not a V1 limit.

### Extraction is best-effort and fails safely (PRD §7)

LinkedIn's markup is undocumented and changes often. Every extraction step in `src/content.ts` is
wrapped so a layout it doesn't recognise is skipped, never thrown — a broken read on one post must
never stop the rest of the page from working. Where possible, extraction reads the *visible wording*
(e.g. "1.2K reactions") via `src/text.ts`'s regexes rather than a brittle class-name chain, since the
words LinkedIn shows change far less often than the classes around them.

**Edge cases handled (PRD §7):**

- **Same post reappearing in the feed** — deduped by the post's URN (`data-urn`), which is the
  storage key.
- **Reposts and quoted posts** — attributed to the original author (found as the second author link
  inside a "reposted this" container) and flagged `seenAsRepost`, never counted as the reposter's own
  content.
- **Counts that change between sightings** — `upsertPost` in `src/storage.ts` only ever raises a
  count on merge; a lower number on a later sighting is treated as a rendering glitch, not a real drop.
- **Documents/carousels/video posts with no text** — `src/text.ts#previewFor` shows a labelled
  placeholder ("[Document / carousel post — no text]") instead of an empty row.
- **Non-English posts** — text is stored and displayed untouched; nothing here assumes Latin script.
- **A watched person who goes quiet** — the panel and the Markdown export both say "no posts seen in
  N days" once it passes 30 (`src/export.ts#daysSinceLastPost`).
- **Feed DOM rewrites** — every DOM read degrades to "skip this post" instead of throwing.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' Network tab while browsing LinkedIn with the extension active. Watched people, collected
posts, notes and usage counters live in `chrome.storage.local` and are never transmitted. See
[PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half of `src/content.ts` needs a real, logged-in LinkedIn session — spike this against
the live site before shipping (PRD §5 calls for a one-day spike specifically on this).

- [ ] Watch a person from their profile page; the button flips to "Watching ✓" immediately
- [ ] Watch a person from a post's author line in the main feed
- [ ] Scroll the feed — posts from that person get collected as they scroll into view
- [ ] Visit the person's own profile activity tab — their older posts get collected too
- [ ] Search LinkedIn for the person's name and open a result — posts collected there too
- [ ] The same post scrolls past twice (e.g. re-rendered after a "load more") — only one row in the panel
- [ ] Someone else reposts a watched person's post — it is attributed to the original author, not the reposter
- [ ] A document/carousel post and a video post with no caption — both show a labelled placeholder, not a blank row
- [ ] A post's reaction count goes up between two sightings — the panel shows the higher number
- [ ] Watch a third person, then wait (or backdate test data) past 30 days with no new post — the "gone quiet" badge appears
- [ ] Un-watch someone from the panel — their posts disappear too
- [ ] Sort by recency, then by outlier ratio; toggle ">2× outliers only"
- [ ] Add a note to a person and to a post; both persist after closing and reopening the panel
- [ ] Export CSV, open it in a spreadsheet — columns are person, post, reactions, comments, reposts, ratio, date, link, note
- [ ] Export Markdown — one heading per watched person
- [ ] Export all data → clear all → import → everything comes back
- [ ] Load the extension on a tab that was already open before install — reload it once, the Watch buttons appear
- [ ] Panel with ~100 people / ~3,000 posts (seed via import) opens in under 600 ms (PRD §6)

## Known limits

- LinkedIn's DOM is not documented and changes without notice; the selectors in `src/content.ts` are
  a best-effort read of the visible page, not an API, and may need updating after a LinkedIn redesign.
  When that happens, the extension degrades to collecting nothing rather than collecting wrong data.
- The repost/original-author heuristic assumes the standard "X reposted this" wrapper LinkedIn ships
  today; an unusual layout may occasionally attribute a repost to the wrong author. The `seenAsRepost`
  flag and the post's own link are there so this is easy for a user to spot and correct via the note field.
- A post without a recoverable URN (rare) falls back to an author+text-derived id, which is a weaker
  dedupe key than a real URN.
