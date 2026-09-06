# Reddit Voice-of-Customer Saver

Chrome MV3 extension. Select text in a Reddit post or comment, save it with its thread, subreddit,
author and your note, organize it into themes, and export the collection as Markdown, CSV or JSON.
No account, no backend, no network requests.

Built from
[PRD-23](../../docs/extensions/PRD-23-reddit-voice-of-customer.md). Same product family as
[Web Highlighter](../WebHighlighter) — select text, save it with context, export Markdown — aimed at
one platform and one job: research, not general reading.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — dedupe, exports, filenames, import merge
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/dedupe.ts` | Pure quote-list logic: save/dedupe (PRD §7), theme/note/author edits |
| `src/backup.ts` | Backup shape + merge-by-id import logic — pure |
| `src/formatters.ts` | Markdown/CSV/JSON export + filenames + theme/subreddit stats — pure |
| `src/storage.ts` | The only file that touches `chrome.storage.local`; wraps the pure modules |
| `src/reddit-extract.ts` | DOM-bound: reads old.reddit.com and www.reddit.com's `shreddit-*` markup |
| `src/content.ts` | Selection → "+ Save quote" control, capture, save, one-click theme toast |
| `src/panel.ts` | Side panel: the research library — search, groups, export, data ownership |
| `src/background.ts` | One line: makes the toolbar icon open the side panel |

### Why this is simpler than a highlighter

The Web Highlighter's panel shows *this page's* marks and has to re-anchor them into the DOM on every
visit. This product doesn't: a save is a one-shot capture of the quote, its context and its citation
metadata into a flat list, not a mark painted onto the live page. That means:

- No anchoring/restoring machinery — the whole content script is selection detection + one popover.
- The panel never talks to the content script. Both read and write `chrome.storage.local` directly,
  and the panel listens to `chrome.storage.onChanged` to stay live — no messaging layer, no per-tab
  gating of the side panel, and no `activeTab`/`tabs`/`scripting` permission (see PRIVACY.md).

### Dedupe (PRD §7)

"Quotes from the same comment saved twice" are matched by permalink, then by substring: an identical
or shorter re-save is dropped as a duplicate; a longer re-save **replaces** the stored quote while
keeping its id, note, theme and original save date — re-selecting a wider span must never lose a note.
See `src/dedupe.ts` and the `dedupe` section of `scripts/selftest.mjs`.

### Reddit DOM extraction

`src/reddit-extract.ts` supports both front ends named in PRD §5:

- **old.reddit.com** — `.thing.comment` / `.thing.link`, `data-author`, `data-permalink`,
  `.usertext-body .md`, `time[datetime]`.
- **www.reddit.com (redesign)** — `<shreddit-comment>` / `<shreddit-post>` web components and their
  `author`/`permalink`/`score`/`subreddit-prefixed-name` attributes, `faceplate-timeago[ts]` for dates.

Reddit changes this markup without notice, and it cannot be exercised by `scripts/selftest.mjs`
(no browser). Every read degrades to an honest empty value instead of throwing — a capture with a
blank score is still useful, one that crashes the content script is not. **Verify this file against
live Reddit before shipping** — see the manual checklist below.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Quotes, notes and usage counters live in `chrome.storage.local` and are never
transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half (`reddit-extract.ts`, `content.ts`) needs a real browser:

- [ ] A comment on **old.reddit.com**: select mid-comment text, "+ Save quote" appears within one
      selection change, saving captures author/subreddit/thread title/permalink/score/date correctly
- [ ] A comment on **www.reddit.com**: same, against the `shreddit-comment` markup
- [ ] A self-post body on both front ends
- [ ] A selection that spans two sibling comments — no control appears (refused, not guessed)
- [ ] A collapsed comment thread — nothing selectable, nothing crashes
- [ ] Save the same sentence twice from the same comment — second save is reported as a duplicate
- [ ] Save a wider selection covering an already-saved quote — the saved card is replaced, its note
      and theme survive
- [ ] A comment whose author has since deleted their account/comment — the saved copy still reads
      fine in the panel (nothing here re-fetches the page)
- [ ] Toggle "Save new quotes without usernames" — the next save has no author, "Hide author" not
      offered on it; an older save with an author still offers "Hide author"
- [ ] Search across quote text, note, subreddit and author
- [ ] Rename a default theme, add a custom one, delete a theme with quotes in it (they move to
      Uncategorized)
- [ ] Export .md, .csv, .json; re-import the .json into a second profile and confirm nothing doubles
- [ ] Storage warning appears once local storage crosses 80% (shrink `QUOTA_BYTES` temporarily to test)

## Known limits

- Reddit's redesign changes its DOM without notice; the `shreddit-*` selectors in
  `reddit-extract.ts` may need updating after a Reddit release. A capture with a missing field
  (blank score, blank date) degrades gracefully rather than failing.
- No AI clustering or summarizing of quotes, no automated collection, no account — all deliberately
  out of scope per PRD §4.
