# X Conversation Saver

Chrome MV3 extension. Save posts and threads from X (Twitter) with a click — the full thread text,
your own note, a collection to file it under, and an export that isn't locked inside X. No account,
no backend, no network requests.

Built from [PRD-13](../../docs/extensions/PRD-13-x-conversation-saver.md). Storage,
export and import are the "Saver" pattern from
[docs/extensions/README.md](../../docs/extensions/README.md#shared-modules) —
the same shape as [WebHighlighter](../WebHighlighter)'s storage layer.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, capture, merge, exports
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure string parsing — count formatting ("1.2K"), status ids, handles, URLs |
| `src/scrape.ts` | The DOM half: finds tweets, reads whatever X rendered, gathers a visible thread |
| `src/capture.ts` | Turns a scrape into a capture card — classification, "update don't duplicate", search, people grouping |
| `src/merge.ts` | Import merge-by-id semantics, pulled out so it's testable without chrome.* |
| `src/formatters.ts` | CSV and Markdown export — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` records, collections, people notes, backup export/import, quota status |
| `src/content.ts` | Injects the "+ Save / + Save thread" control and captures on click |
| `src/panel.ts` | Side panel: library, people view, search, export, data ownership |

### Why saves live in a shadow-root overlay, not inside X's own DOM

X is a heavily virtualized React app — list cells get recycled as the user scrolls, and anything an
extension inserts *inside* a React-owned subtree risks being wiped on the next re-render. So this
extension never writes into X's tree. Exactly like WebHighlighter's selection popover, one shadow
root is appended to `document.documentElement`, and every "+ Save" control is an absolutely
positioned badge floating over its tweet, computed from `getBoundingClientRect()`. A save reads the
live DOM at the moment of the click, so a recycled node is a non-issue — whatever is on screen when
the user clicks is what gets captured (PRD §6).

### What "Save thread" actually gathers

"The whole visible thread" (PRD §6) means every tweet article currently rendered below the one the
user clicked, in document order, until:

- X's own "More Tweets" / "Discover more" boundary is reached (algorithmic suggestions are never
  pulled into a save), or
- a hard cap of 200 posts (a safety valve, not a real limit anyone should hit)

If a "Show more replies" affordance is visible in that range, the card is saved with
`truncated: true` and the panel shows a note — the extension never auto-clicks to expand it
(PRD §11: "let the user expand manually first"). A thread with more than one author is saved the
same way but classified `conversation` rather than `thread` (PRD §8), which is also how the panel
labels and how the export digest groups it.

### Update, don't duplicate

Saving the same root post twice (PRD §8) refreshes the captured text, metrics and post list, but the
note and collection you already set are preserved, and the original saved date doesn't move — see
`capture.ts#buildItem`.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Saved items, notes and usage counters live in `chrome.storage.local` and are
never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser and X's live markup — `npm test` cannot reach it.

- [ ] A single post with text only — Save captures author, handle, text, metrics, date, link
- [ ] A post with an image / video — captures a thumbnail reference, no text required
- [ ] A quote post — both the quote and the quoted post's text are captured
- [ ] A same-author thread — Save thread captures every visible post in order, labelled "Thread"
- [ ] A reply chain with a second author jumping in — labelled "Conversation", not "Thread"
- [ ] A thread with "Show more replies" not expanded — saves what's visible, `truncated` shows in the panel
- [ ] Saving the same post twice — the card updates in place, the note/collection you set survive
- [ ] A protected account's post (if visible to you) — captures whatever is rendered, no crash
- [ ] Scrolling a long timeline — badges track the currently visible tweets without leaking or duplicating
- [ ] Panel: search across text, author and note; filter by collection; rename a collection
- [ ] Panel: People view groups by author with a save count and a per-person note
- [ ] Export as .md, .csv and .json; import the .json back in (merge, not overwrite)
- [ ] Clear all data, confirm the four default collections come back empty
- [ ] Fill storage near 80% (many long threads) — the quota warning appears in the Data sheet

## Known limits

- X's markup uses `data-testid` attributes rather than stable class names; every selector in
  `scrape.ts` is a best-effort heuristic with a fallback, and PRD §8 explicitly names "X DOM
  rewrites" as an expected edge case — a field X didn't render becomes empty rather than failing
  the whole save.
- Views/replies/reposts/likes come from whatever aria-label or visible text X rendered at capture
  time; a metric X hid (some post types, protected accounts) is stored as `null`, not `0`.
- "Save thread" only ever captures what's already rendered — it will not scroll, click "Show more
  replies", or wait for content to load. That's a product decision (PRD §11), not a bug.
- Media beyond a thumbnail reference is not downloaded — the extension stores the CDN URL, not the
  file (PRD §4).
