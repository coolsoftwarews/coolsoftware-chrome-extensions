# YouTube Comment Digest & Best-Comments Finder

Chrome MV3 extension. A sortable, searchable side panel for the YouTube comments already loaded in
the page — keyword search, "Load more" (triggers YouTube's own lazy-load, then re-indexes), CSV /
Markdown export, and a client-side word-frequency digest. No account, no API key, no network
requests of any kind.

Built from [PRD-31](../../docs/extensions/PRD-31-youtube-comment-digest.md). Scaffold,
build system and side-panel shape are ported from
[WebHighlighter](../WebHighlighter) (`storage.ts`/`metrics.ts` pattern, esbuild build/zip/icon
scripts, gate states). The DOM-reading discipline — every selector isolated in one file, every field
degrading independently, `parse.ts`'s null-not-throw contract — is ported from
[YouTubeProFilters](../YouTubeProFilters).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — parsing, sort, search, word-frequency, export, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/parse.ts` | String parsers (compact numbers, reply counts, relative dates) — pure, null on anything unparseable |
| `src/comment.ts` | Builds a normalized `Comment` from raw DOM strings; the one place field-level degradation happens |
| `src/selectors.ts` | Every YouTube comment DOM assumption, isolated — the one file to touch if YouTube's markup changes |
| `src/scan.ts` | DOM-bound: finds the comments section, walks mounted threads, triggers YouTube's own lazy-load |
| `src/sort.ts` | Client-side sort (top / most-liked / most-replies / newest) — null fields sort last, never to the top |
| `src/search.ts` | Keyword search across loaded comments |
| `src/wordfreq.ts` | Client-side word/phrase frequency, English stopwords filtered, per-comment count capped |
| `src/export.ts` | Markdown + CSV formatters and the filename builder |
| `src/content.ts` | Runs on YouTube pages; answers the panel's state queries, triggers load-more, watches for SPA navigation |
| `src/background.ts` | Thin service worker — opens the side panel, enables/disables it per tab |
| `src/panel.ts` | The side panel itself: list, search, sort, word-frequency, export, settings |

### Why comments are never persisted

This extension is a **mirror**, not an archive. Every comment shown is read live off the page each
time the panel asks; nothing is written to `chrome.storage.local` beyond your sort/export
preferences and anonymous local usage counters (see PRIVACY.md). Reload the video and the panel
starts over with whatever YouTube has (re-)rendered — that is the intended behaviour, not a bug: the
panel never claims to remember a comment section YouTube itself didn't keep loaded.

### Read-only, always

There is no code path anywhere in this extension that posts, likes, replies to, or otherwise writes
to YouTube on your behalf. "Load more comments" scrolls the page — exactly what your own scroll wheel
does — and nothing else. This is a permanent property of the product, not a V1 limitation.

## Required pre-ship spike (PRD §5)

This build could not verify `src/selectors.ts` against a live, populated YouTube comment section — no
network access to youtube.com in this environment. Before shipping, manually confirm on a real video
with a real comment section:

- [ ] Author name, comment text, like count, reply count and published-time text all read correctly
      for at least 20 comments across 3–4 different videos
- [ ] The pinned badge and the creator-heart badge each show up distinctly where they actually apply
      on the page (find a video with both, if possible)
- [ ] "Load more comments" actually scrolls YouTube's own comment section and the panel picks up the
      newly-mounted comments within a couple of seconds
- [ ] A video with comments turned off shows the panel's own "Comments are turned off" state, not a
      blank list or a false zero
- [ ] A video whose comment section hasn't been scrolled into view yet shows the "No comments loaded
      yet" state, and clicking "Load comments" successfully brings the first batch in
- [ ] Sort by most-liked / most-replies / newest all produce a sensible order once several comments
      are loaded
- [ ] Reload the same video, switch to a different one via YouTube's own recommendations (SPA
      navigation, no full page load) — the panel updates to the new video without needing a manual
      panel reopen

If any selector in `src/selectors.ts` needs updating after this check, that file is the only one that
should need touching — `comment.ts`, `sort.ts`, `search.ts`, `wordfreq.ts` and `export.ts` are DOM-free
and already covered by `scripts/selftest.mjs`.

## Known limits

- **English-only stopword filtering** in the word-frequency digest (PRD §7) — a non-English comment
  section will produce a noisier word list, since common function words in other languages aren't
  filtered out. Documented, not silently pretended away.
- **Flat replies.** A reply-count badge shows on a top-level comment; replies themselves are never
  fetched or expanded by this extension — open them in YouTube's own UI.
- **A mirror, not an archive.** Nothing is remembered across a reload beyond your sort/export
  preferences. There is no "my saved comments" list in this product.
- **No exact timestamps.** "3 days ago" is parsed to an approximate epoch (months = 30 days, years =
  365) for the "newest first" sort — good enough to order comments, not a precise clock.
