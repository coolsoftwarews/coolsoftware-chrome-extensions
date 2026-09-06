# Facebook Group Opportunity Finder

Chrome MV3 extension. In the Facebook groups you're already in, flags the posts where someone is
asking for exactly what you sell — "looking for a bookkeeper", "can anyone recommend a web
developer" — using rules you write or pick from a starter pack. No account, no backend, no network
requests, no automation.

Built from [PRD-15](../../docs/extensions/PRD-15-facebook-group-opportunities.md). It
shares its Rules engine shape (two-part intent+topic matching, starter packs, hit counts) with
[XKeywordMute](../XKeywordMute), and its export/data-ownership shape (export all / import / clear
all) with [WebHighlighter](../WebHighlighter) — see the portfolio
[README](../../docs/extensions/README.md)'s shared-modules table.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — rules engine, dedupe, exports, text extraction
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Then open a Facebook group you're a member of and click the toolbar icon.

## How it works

| File | Job |
| :-- | :-- |
| `src/rules.ts` | The rules engine — two-part match+topic evaluation, hit counts, token parsing. Pure, fully tested. |
| `src/starter-packs.ts` | Four starter rule packs by profession (agency, bookkeeper, developer, photographer) |
| `src/dedupe.ts` | Stable id hashing so the same post seen twice on re-scroll isn't captured twice |
| `src/extract.ts` | Facebook DOM extraction (post text, author, permalink, comment count) + its pure text helpers |
| `src/content.ts` | Scans a group feed, paints the reason-chip badge, persists matches, answers the panel |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records for rules and matched posts, backup export/import, quota |
| `src/metrics.ts` | Local-only usage counters (§8 of the PRD) |
| `src/panel.ts` | Side panel: rules, matched posts, search/filter, export, data ownership |

### The rule, which is the whole product

A rule is two lists plus an optional third (PRD §4):

```
Match:  "looking for"  ·  "can anyone recommend"  ·  "does anyone know"
Topic:  "bookkeeper"  ·  "accountant"  ·  "invoicing"
Ignore: "free"  ·  "intern"
```

A post only counts when it contains **at least one match phrase AND at least one topic word**, and
**none** of the ignore words. That two-part check is what keeps a "looking for" rule from lighting up
on every unrelated post in the group — see `src/rules.ts`'s `evaluateRule`.

Matching is literal, case-insensitive substring matching — no stemming, no NLP, so it works the same
in non-English groups (PRD §7). Rule authoring is the whole onboarding (PRD §10), so the panel leads
with four starter packs instead of a blank form.

### Reading a Facebook group feed

Facebook ships no stable class names, but keeps a few semantic anchors: `[role="article"]` for a
feed post, `<abbr>` for the relative timestamp, and permalink URLs that always contain `/posts/`,
`/permalink/` or `story_fbid=`. `extract.ts` is built on those, with plain-text fallbacks everywhere,
and is written to return "unknown" cleanly rather than guess wrong. Its string-only helpers
(comment-count parsing, permalink detection, name filtering, title cleanup) are unit tested; the
DOM-walking half needs a real Facebook group — see the manual checklist below. **Expect breakage**:
Facebook's DOM changes without notice, and this extension is built to degrade to "no badge painted"
rather than mangle the feed.

A matched post gets an absolutely-positioned badge inside a shadow root, so it never changes the
post's box size — no layout shift (PRD §6). Nothing is clicked, liked, joined or commented on; the
extension only reads what's already rendered.

### No alerts, on purpose

Background scanning would mean polling a page the user isn't looking at, which is automation, which
is exactly what gets accounts and store listings banned (PRD §5). This extension only scans while a
group tab is open and active. The product's answer to "I want to know the moment someone posts" is a
good panel and the habit of opening it — not a crawler.

## Privacy

No `fetch`, `XMLHttpRequest` or `sendBeacon` anywhere — verifiable with `grep -rn "fetch(" src/` and
in devtools' network tab. Rules, matched posts and usage counters live in `chrome.storage.local` and
are never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser and a real group.

- [ ] A group with a normal chronological feed: post text, author and date read correctly
- [ ] Infinite scroll: scroll well past the initial page load, new posts still get evaluated
- [ ] The same post scrolled past twice does not create two panel entries
- [ ] A rule created, then a matching post already on screen gets its badge without a reload
- [ ] A post with an embedded link to another site is not mistaken for the post's own permalink
- [ ] An anonymous-style post (common in support groups) captures as "Anonymous member", not blank
- [ ] A very long post: full text saved, card view truncated
- [ ] A group with 100+ posts loaded in one session: the session cap message appears once
- [ ] The main feed, Marketplace and Watch: the panel shows the "open a group" gate, nothing scanned
- [ ] Export all data → clear all → import → rules and matched posts come back
- [ ] CSV opens cleanly in a spreadsheet app; Markdown renders cleanly in a plain viewer

## Known limits

- V1 reads the post only, not its comments — the PRD is explicit that the real opportunity sometimes
  lives in a reply, and says so rather than pretending otherwise (§7, §10).
- No alerts or background monitoring, permanently — see "No alerts, on purpose" above.
- A post captured, then edited on Facebook afterward, keeps the text as first captured; there is no
  re-scan-and-diff (that would need periodic re-reading, which this extension doesn't do).
- Facebook's DOM is actively hostile to scraping; extraction accuracy will drift with Facebook's own
  redesigns and is not guaranteed.
