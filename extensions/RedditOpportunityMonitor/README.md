# Reddit Opportunity Lens

Chrome MV3 extension. Flags the threads in the subreddits you're already reading where someone is
asking for a tool, a service, or a recommendation in your space — using local, two-part rules. No
account, no backend, no alerts, no network requests.

Built from [PRD-22](../../docs/extensions/PRD-22-reddit-opportunity-monitor.md). The name
is deliberately not "Monitor" — PRD §10 flags that word as an over-promise, since this extension
never polls or watches in the background; it only reads what you scroll past.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — rules engine, exports, extraction helpers
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required (the repo's default `node` may be older).

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/rules.ts` | The rules engine — two-part intent+topic matching, hit counts, the subreddit read. Pure, fully tested. |
| `src/starter-packs.ts` | Four starter rule packs, one per PRD §3 target user |
| `src/extract.ts` | DOM extraction for both Reddit front-ends, split into pure text helpers (tested) and DOM-walking (manual checklist) |
| `src/content.ts` | Scans the feed, paints the in-feed chip, answers the panel's tab-status questions |
| `src/export.ts` | CSV and Markdown export + filenames — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records for rules and opportunities, backup export/import, quota status |
| `src/metrics.ts` | Local, anonymous usage counters |
| `src/panel.ts` | The opportunity panel: rules, filters, signals, subreddit read, export, data ownership |
| `src/background.ts` | Opens/focuses the panel tab when the toolbar icon is clicked |

### The rules engine, which is the whole product

A rule is **intent + topic**, same shape as the Facebook pair (README's shared "Rules engine"
module):

```
Intent:  "looking for"  ·  "recommend"  ·  "any alternative to"
Topic:   "invoicing"  ·  "time tracking"
Ignore:  "free only"
```

A post counts when it has at least one intent phrase **and** one topic word, and none of the ignore
words. Matching is literal, case-insensitive substring matching — no stemming, no NLP, so non-English
subreddits are supported honestly rather than pretended at (PRD §7). Evaluation for one post against
fifty rules stays well under the PRD's 5 ms budget (§6) because it's plain string search, nothing
more.

Four starter packs (SaaS founder, freelancer/agency, marketer, indie hacker) seed a first rule so the
panel is never a blank box on first open — the biggest lesson from the Facebook pair (PRD §10).

### Two front-ends, on purpose

`src/extract.ts` supports both `old.reddit.com` (stable `.thing` markup with `data-*` attributes) and
current `www.reddit.com` (the `<shreddit-post>` custom element and its `post-title`/`score`/
`comment-count`/`created-timestamp`/`subreddit-prefixed-name`/`permalink` attributes) — PRD §5 calls
out that a large share of the target audience still uses old Reddit, and that supporting both "buys
credibility with exactly the power users this tool targets."

Reddit redesigns periodically (PRD §7). `extract.ts` is written to degrade — return `null` or an
empty snippet — rather than guess wrong or throw, so one hostile post never stops the rest of the
feed from scanning.

### What gets read, and what doesn't

Only posts already rendered in the tab, on `reddit.com`, as the user scrolls — no Reddit API, no
account, no background polling (README's hard constraints; PRD §5's explicit reasoning). **Comments
are not read in V1** — the PRD is explicit that this is a real gap ("comments are where the gold is",
§10) and a likely V1.1, not something to fake by scraping the comment DOM anyway.

The extension never votes, comments, follows, joins, or posts anything — read-only on the platform,
permanently, not a V1 limit.

### The panel is a tab, not a side panel

The PRD's own non-functional requirement (§6) lists the permission budget as exactly `activeTab`,
`storage`, `downloads` + the Reddit host — no `sidePanel`, no `scripting`, no broad `tabs` permission.
So the "Opportunity panel" the PRD describes is a normal extension page opened in its own tab
(`background.ts` opens or refocuses it), not `chrome.sidePanel`. Live context about the active Reddit
tab (its current subreddit, session cap) is fetched with a single `chrome.tabs.sendMessage` to
whichever Reddit tab looks active — the one thing that only exists in that tab, and doesn't need the
`tabs` permission because host permissions already cover reading that tab's URL.

## Manual test checklist

The DOM-bound half needs a real browser and both front-ends. Before shipping:

- [ ] `old.reddit.com` and `www.reddit.com`, home feed and a subreddit listing, each with a rule that
      should match at least one visible post
- [ ] The chip appears within ~250 ms of a post rendering, with no visible shift of already-rendered
      content
- [ ] Infinite scroll: scroll far down, matches keep appearing without a reload
- [ ] The same post seen in the home feed and again in its own subreddit produces one opportunity,
      not two
- [ ] A crosspost is captured as its own post, not merged with the original
- [ ] A subreddit with 100+ posts loaded: the session cap message appears once, scanning stops, no
      page slowdown
- [ ] An NSFW/quarantined subreddit doesn't break scanning (no special handling needed, just no
      crash)
- [ ] Turn a rule off in the panel — chips on already-loaded posts disappear/stop reappearing without
      a page reload
- [ ] "Subreddit read" populates after browsing a subreddit's listing, and reads "No subreddit"
      correctly on the home feed
- [ ] A tab open before the extension was installed: the panel says to reload it, and reloading fixes
      it
- [ ] Export CSV and Markdown, both filtered and unfiltered
- [ ] Export all data → clear all → import → everything comes back

## Known limits

- Comment-level opportunities are out of scope for V1 (PRD §7) — the panel and README both say so
  plainly rather than imply a feature that isn't there.
- `<shreddit-post>`'s attribute set is undocumented by Reddit and has moved before. `extract.ts` is
  the one file to update if a redesign breaks it; every extraction call is wrapped so a break
  degrades to "no snippet" rather than a crash.
- The "subreddit read" summary is a live, this-session number computed from whatever has loaded in
  the tab (PRD §4: "from what's loaded") — it is not a database and resets on reload, on purpose.
