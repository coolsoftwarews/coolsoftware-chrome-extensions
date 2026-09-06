# X Thread Unroll & Reader Export

Chrome MV3 extension. Click **Unroll** on any thread on X (Twitter) and read it as one clean,
scrollable document — right in your own tab, from your own logged-in session — then export it as
Markdown or plain text, or copy it straight to the clipboard. No account, no backend, no
publishing anywhere.

Built from [PRD-25](../../docs/extensions/PRD-25-x-thread-unroll.md). Its closest sibling
in this portfolio is [XConversationSaver](../XConversationSaver) (PRD-13) — same platform, same
shadow-root-overlay-over-a-virtualized-feed technique, same truncation-honesty rule — but this
product deliberately has **no saved library**: it reads and exports the thread you're looking at
right now, and nothing else persists (see [Why there's no library](#why-theres-no-saved-library)
below).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, reading-time, exports
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | Pure string parsing — status ids, handles, URLs, a media-count label |
| `src/reading.ts` | Reading-time estimate and the honest "how much did we actually read" summary |
| `src/scrape.ts` | The DOM half: finds tweets, decides which start a same-author reply chain, walks it |
| `src/formatters.ts` | Markdown and plain-text export — pure, fully tested |
| `src/storage.ts` | The one thing this product persists: the last-used export format |
| `src/metrics.ts` | Local-only usage counters |
| `src/content.ts` | Injects the "Unroll" control, drives the bounded auto-scroll, streams progress to the panel |
| `src/background.ts` | Opens/enables the side panel; relays the open request a content script can't make itself |
| `src/panel.ts` | Side panel: the reading view — loading, streaming, done and error states, export |

### Why "Unroll" only appears on thread roots, not every post

A tweet gets the control only when `scrape.ts#isThreadRoot` finds that it starts a same-author
reply chain of two or more posts, and is not itself an interior post of one already (PRD-25 §4). A
reply from someone else never gets the control, and neither does the second, third, etc. post in an
existing chain — clicking anywhere in the middle would produce a confusing partial read.

### Why the reading view lives in a shadow-root overlay, not inside X's own DOM

X is a heavily virtualized React app — list cells get recycled as the user scrolls, and anything an
extension inserts *inside* a React-owned subtree risks being wiped on the next re-render. Exactly
like XConversationSaver and WebHighlighter before it, one shadow root is appended to
`document.documentElement`, and the "Unroll" control is an absolutely positioned badge floating over
its tweet, repositioned from `getBoundingClientRect()`.

### What "Unroll" actually does

1. Reads the origin post's author/handle.
2. Walks forward through whatever tweets are currently rendered, collecting every post by that same
   author, in document order — skipping over (never absorbing) replies from other accounts
   interleaved into the same DOM run, and inserting a gap placeholder wherever X shows a
   "this post is unavailable" cell mid-thread (PRD-25 §7).
3. Streams that growing list to the side panel after every step.
4. Auto-scrolls the page in small, bounded steps (≤24, ~380ms apart) so X's lazy-loaded replies get
   pulled into the DOM, stopping the moment three consecutive steps add nothing new, X's own
   "More Tweets"/"Discover more" boundary is reached, or a 200-post safety cap is hit.
5. Never clicks "Show more replies" for the user — same choice XConversationSaver made (PRD-13 §11):
   default to what scrolling alone reveals, and say so honestly (see below) rather than automate
   expanding it.

The whole run only happens while the panel is open and the user is on the tab driving it — nothing
scrolls or scans in the background, and a **Stop** button in the panel ends it early at any point.

### The one honesty rule this whole product turns on

X never exposes a thread's true total post count in the DOM, lazy-loads later replies, and gates
some behind an explicit "Show more replies" tap. Rather than invent a denominator ("12 of 30
posts"), the reading view reports a literal, verifiable **"N posts shown"** plus, only when a
"Show more replies" affordance was seen and not expanded, a separate **"More may exist — X did not
fully load this thread"** note (or, if the 200-post safety cap was hit, "Stopped at 200 posts — this
thread may have more"). Never both folded into one invented fraction. This is the same
"report what you can prove, flag what you can't count" rule XConversationSaver's `collectThread`
already ships — see `src/reading.ts#completenessNote`.

### Why there's no saved library

PRD-25 §4 keeps bookmarking explicitly out of scope — that job already belongs to
[XConversationSaver](../XConversationSaver). The current thread being read lives only in the content
script's and panel's memory for the session; `src/storage.ts` writes nothing but the last-used
export-format preference. Closing the panel or navigating away discards the reading view — export or
copy it first if you want to keep it.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. There is no network request anywhere in this extension: what you unroll never
leaves your device, and unlike server-side "unroll this thread" tools, nothing is ever republished to
a public URL. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser and X's live markup — `npm test` cannot reach it.

- [ ] A short same-author thread (3–5 posts), already fully loaded — Unroll shows every post in
      order with avatar, text, date and a working "Open on X" link
- [ ] A thread whose later replies only render after scrolling — the panel's post count grows as
      auto-scroll runs, and settles once nothing new appears for a few steps
- [ ] A thread with a quote-tweet inside one of its posts — both the quote and the quoted post's text
      render, and the quoted post's replies are never absorbed into the unroll
- [ ] A reply chain with a different account's reply interleaved mid-thread — that reply never
      appears in the reading view, and the original author's chain continues correctly after it
- [ ] A thread with "Show more replies" not expanded — the panel shows the honest
      "More may exist" note, never an invented fraction
- [ ] A thread with a deleted post in the middle (if reproducible) — the gap renders as
      "a post in this thread is no longer available" rather than silently closing up the numbering
- [ ] A very long thread (50+ posts) — auto-scroll stops at the 200-post cap with the matching note,
      not silently
- [ ] Click **Stop** mid-collection — the panel keeps whatever was gathered so far and export/copy
      still work on it
- [ ] Copy to clipboard and Download as both .md and .txt; confirm the last-used format is
      pre-selected the next time the panel opens
- [ ] Reload the X tab mid-read — the panel returns to its empty state rather than showing stale data
- [ ] Two X tabs open, each mid-unroll — each tab's own side panel only ever shows that tab's thread,
      never the other tab's

## Known limits

- X's markup uses `data-testid` attributes rather than stable class names; every selector in
  `scrape.ts` is a best-effort heuristic with a fallback, and a field X didn't render becomes empty
  rather than failing the whole unroll.
- "Unroll" only ever captures what scrolling reveals — it will not click "Show more replies" for the
  user. That's a product decision (PRD-25 §5), not a bug.
- Media beyond a count label and a thumbnail reference is not downloaded — the extension never fetches
  or stores the image/video file itself (PRD-25 §4).
- No PDF export in V1 — Markdown, plain text and copy-to-clipboard only, by design (PRD-25 §4).
