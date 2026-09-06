# LinkedIn Post Draft Bank & Formatting Checker

Chrome MV3 extension. Write LinkedIn posts inside LinkedIn's own composer with a live "see more"
cutoff marker, and keep a searchable local library of your own drafts, reusable templates and
archived published posts. No account, no backend, no AI, no network requests, and no action taken on
your behalf beyond inserting text you already wrote into a composer you already opened.

Built from
[PRD-35](../../docs/extensions/PRD-35-linkedin-post-draft-bank.md). Sibling to
[LinkedIn Creator Watchlist](../LinkedInCreatorWatchlist) (content workflow) and
[LinkedIn Engagement Lead Finder](../LinkedInLeadFinder) (sales intelligence) — this one tests a third
problem class on the same platform: a mechanical, platform-specific writing aid plus a personal swipe
file, distinct from both. The storage/backup/export shape follows
[WebHighlighter](../WebHighlighter) and [LinkedInLeadFinder](../LinkedInLeadFinder).

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — truncation math, search, CSV/Markdown, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/truncation.ts` | The "see more" cutoff estimate — pure, fully tested (see honesty note below) |
| `src/text.ts` | Pure string cleanup — line-break-preserving vs. flattened, snippet truncation |
| `src/search.ts` | Search/filter across drafts, templates and published posts; tag parsing |
| `src/exporters.ts` | CSV and Markdown export, filenames — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` items, backup export/import, quota |
| `src/metrics.ts` | Local-only usage counters |
| `src/linkedin-dom.ts` | Finds the post composer, the signed-in user's own profile, own posts |
| `src/content.ts` | The overlay, draft auto-save, template insertion, published-post archiving |
| `src/background.ts` | Opens the side panel, disables it off linkedin.com |
| `src/panel.ts` | The library: search, filters, insert-into-composer, export, data ownership |

### The truncation overlay

While a "Start a post" composer is open, a small floating card shows a live character count and a
progress bar toward the point LinkedIn's own "…see more" link tends to appear. **This is a documented
approximation, not a measured fact** — see "Known limits" below and PRD-35 §5. The overlay's own copy
always says "approximate" for exactly this reason; if you're relying on this to hit an exact hook
length, treat it as a strong hint, not a guarantee.

### Drafts, templates, and LinkedIn's own autosave

Every 1.2 seconds of typing pauses, the composer's text is silently saved into the extension's own
library as a `draft` row, labelled **Auto-saved** in the panel. This is a *separate* system from
whatever LinkedIn itself autosaves — it never touches LinkedIn's own draft storage, and the panel is
explicit about the distinction so a user never confuses "saved in this extension" with "saved by
LinkedIn" (PRD §7). Clicking **Save draft** in the overlay marks the same row as explicitly saved;
**Save as template** creates a separate, taggable row meant for reuse.

### Inserting a template

Clicking **Insert into composer** in the panel sends the template's text to the currently open
composer on the active LinkedIn tab. This is the **only** place in this codebase that ever writes into
LinkedIn's own page, and it only ever inserts text the user explicitly saved and chose to reuse — it
never generates new text and never clicks "Post" on the user's behalf.

### Archiving your own published posts

On your own profile's activity feed (`/in/<you>/recent-activity/...`), posts are archived into the
library automatically, keyed by the post's own stable URN so editing a live post updates the archived
copy in place rather than creating a near-duplicate. This only ever runs when the page's vanity URL
matches the signed-in user's own profile link in LinkedIn's nav — see `isOwnActivityPage()` in
`src/linkedin-dom.ts`. It will never read another person's posts, by construction, not just by intent.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon`, no `WebSocket` anywhere in this extension —
enforced by `scripts/selftest.mjs` (which greps every source file for these) and verifiable yourself
with `grep -rn "fetch(" src/` or in devtools' Network tab. Drafts, templates, archived posts and usage
counters live in `chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## What this extension will never do

No AI writing, rewriting, or suggestions — that would need a backend LLM API, which is against this
portfolio's hard constraint (no backend, no keys, no server). No scheduling or publish automation — it
never clicks "Post" and never queues anything. The only write action anywhere in this codebase is
described above (inserting the user's own saved text into a composer they opened). This is a permanent
product boundary, not a V1 limit.

## Manual test checklist

The DOM-bound half (`src/linkedin-dom.ts`, `src/content.ts`) needs a real, logged-in LinkedIn session
and could not be verified against a live page in this build environment (no network access to
linkedin.com). LinkedIn's class names are unstable and the composer's exact markup was not confirmed —
before shipping, walk this by hand (this **is** PRD-35 §5's required 1-day spike):

- [ ] Open "Start a post" — the overlay appears within ~300ms, tracks the character count live
- [ ] Confirm empirically where "…see more" actually appears at a few post lengths and viewport
      widths; adjust `DESKTOP_LIMITS`/`MOBILE_LIMITS` in `src/truncation.ts` if the real cutoff differs
      from the documented ~210/~140 estimate
- [ ] A post with several intentional line breaks near the estimated cutoff — does the marker move
      earlier the way `lineBreakWeight` predicts, or does the real behavior differ?
- [ ] Attach an image, then a document, then a poll — confirm the "less reliable" note appears
- [ ] Type, pause, resume — confirm exactly one autosave draft row is created and updated in place,
      never duplicated
- [ ] Close the composer without posting — the last autosaved text survives as a draft
- [ ] Save a template with tags, then click "Insert into composer" — text lands correctly and the
      cursor/selection state afterward is sane
- [ ] Visit your own `/recent-activity` tab — your own posts get archived; visit someone else's
      profile and confirm nothing is captured
- [ ] Edit and republish one of your own posts — the archived copy updates in place, no duplicate
- [ ] Panel: search, kind filter, tag filter, export CSV/Markdown, Data → export/import/clear
- [ ] Resize the browser narrow enough to approximate a mobile viewport — sanity-check the mobile
      character budget

If LinkedIn changes its composer or feed markup and the overlay stops appearing, update the selector
lists at the top of `src/linkedin-dom.ts` — nothing else in the extension needs to change.

## Known limits

- **The "see more" cutoff is a documented approximation, not a measured fact** (PRD-35 §5). Public
  research consistently lands in the 200–220 character range on desktop and 140–150 on mobile, but
  LinkedIn varies the real number by device, viewport width and app version, and changes it without
  announcing it. Every place this number reaches the UI says "approximate" for this reason.
- Line-break weighting toward the cutoff is a conservative, undocumented-by-LinkedIn adjustment
  (`lineBreakWeight` in `src/truncation.ts`), not an independently confirmed constant.
- Composer/profile selectors are best-effort against LinkedIn's general markup conventions and were
  not verified live in this build environment — see the manual checklist above.
- Media detection (image/document/poll) is a heuristic based on nearby element classes and "Remove"
  buttons, not a guaranteed-accurate read of what's attached.
