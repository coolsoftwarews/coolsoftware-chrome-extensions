# LinkedIn Feed Focus & Algorithm Control

Chrome MV3 extension. Hides what LinkedIn's feed algorithm inserts — promoted posts, suggestion
modules, trending news, algorithmically-suggested posts, and (optionally) reaction counts — behind
six independent toggles in one toolbar popup. No account, no backend, no network requests. Built
from [`docs/extensions/PRD-37-linkedin-feed-focus.md`](../../docs/extensions/PRD-37-linkedin-feed-focus.md).

## What this is, in one sentence

The same proven "hide what the feed inserts" pattern as X's Control Panel/Minimal Theme extensions
and YouTube's Unhook, applied to LinkedIn — a platform where, as of this writing, no dedicated
feed-declutter extension exists at all (every LinkedIn extension in the current rankings is a
sales/CRM/writing tool). See the PRD's §2 for the full research basis.

## What this extension will never do

- **No write actions against LinkedIn, ever.** There is no code path anywhere in this extension
  that posts, likes, follows, connects, comments or messages. The only DOM mutation it performs is
  setting `display: none` on nodes LinkedIn already rendered, and adding one `<style>` element for
  focus mode. That is a permanent design constraint, not a V1 limit — see `PRIVACY.md`.
- **No reading or storing of post content.** `content.ts` reads short label strings (a heading, a
  timestamp annotation) purely to decide whether to hide the node they came from. Nothing extracted
  is ever written to storage, logged, or transmitted.
- **No network requests, anywhere.** Enforced by `scripts/selftest.mjs`, which greps every file in
  `src/` for `fetch(`, `XMLHttpRequest(`, `.sendBeacon(` and `new WebSocket(` and fails the build if
  any appear.

## Architecture

- `src/classify.ts` — **pure logic, no DOM.** Given a short label string and the current six-toggle
  state, decides whether the node that label came from should be hidden. This is the "should this
  node be hidden" decision point every hide operation in `content.ts` goes through, and the only
  module `scripts/selftest.mjs` exercises headlessly.
- `src/content.ts` — **DOM traversal, all of it best-effort.** Finds post containers (`[data-urn]`
  matching LinkedIn's activity/share/ugcPost URN pattern, the same technique
  `LinkedInCreatorWatchlist` uses), suggestion/trending module headings, and reaction-count elements;
  reads the minimal text needed from each; calls `classify.ts` to decide; hides via `display: none`.
  Every extraction/hide step is wrapped so one failing selector can never break the rest of the page
  or the other five features (PRD §5, §6). A `MutationObserver` re-scans on feed updates/infinite
  scroll; a `setInterval` watches `location.href` for LinkedIn's SPA navigation.
- `src/background.ts` — minimal. Writes the six default toggle values to storage once, on install,
  so `content.ts` and `popup.ts` both find a real record rather than each guessing at defaults
  independently. No fetch, no alarms, nothing else.
- `src/popup.ts` / `popup.html` / `popup.css` — the entire UI: six toggle rows, a status line, a
  reset-to-defaults button. Reads/writes `chrome.storage.local` directly; no messaging to the content
  script at all — `content.ts` picks up a change via `chrome.storage.onChanged` on any open LinkedIn
  tab, same "captured state is just data" shape the portfolio's other storage-only extensions use.

## Why there is no export/import/clear-all here

The portfolio-wide rule (`docs/extensions/README.md`) is "everything the user creates is
theirs — export all / import / clear all, in every product that stores anything." This product's
only stored data is six booleans, and the task that commissioned this build explicitly scoped
permissions to `storage` + the LinkedIn host permission only — no `downloads`. A file-based export
would need `chrome.downloads`, which is a broader permission than six toggle values justify. Instead:

- **"Reset to defaults"** in the popup does the "clear" job — it always works, needs no permission,
  and there is nothing else to lose (no saved posts, no notes, no history).
- There is no "import" because there is nothing meaningfully portable between installs beyond six
  checkbox states a user can set again in seconds.

If a future version of this product grows real per-user data (e.g. a per-toggle usage count), revisit
this and add `downloads` + the standard export/import/clear-all layer at that point — don't add the
permission preemptively for six booleans.

## Manual test checklist — required before every release

Nothing in `src/content.ts` is unit-testable in the normal sense; it depends on a live, logged-in
LinkedIn session, and this build environment has no network access to linkedin.com to verify these
selectors against the real DOM. **Treat every claim below as unverified until run against a live
account**, and re-run this checklist whenever LinkedIn visibly changes its feed layout, not just
before a release:

1. **Promoted posts** — with "Hide promoted posts" on, scroll the home feed until at least one
   sponsored post appears (LinkedIn ads may take several scrolls to show up); confirm it disappears
   and nothing else nearby is affected. Turn the toggle off; confirm it reappears immediately.
2. **Suggestion modules** — with "Hide 'People you may know'" on, confirm any "People you may know",
   "Add to your feed" or similar module in the feed or right rail is fully removed (no empty
   card/shell left behind), on both a new-ish account (more suggestion modules) and an established
   one (fewer).
3. **Trending module** — with "Hide trending news" on, confirm the "LinkedIn News" / trending-now
   module in the right rail is removed.
4. **Suggested/algorithmic posts** — this is the least certain of the six (PRD §5, §10: LinkedIn
   exposes no explicit, documented flag the way it does for "Promoted"). Confirm whether any posts in
   the feed carry a visible "Suggested" or "Because you follow X" annotation near the timestamp; if
   none do on your test account, the toggle is a safe no-op (per the degrade-to-nothing rule) but its
   popup copy should be checked against what it can actually verify.
5. **Reaction counts** — with "Hide reaction counts" on, confirm the like/reaction tally under a post
   is hidden, but the comment count, repost count, and every action button (Like, Comment, Repost,
   Send) remain fully visible and clickable. This is the highest-risk selector in the extension
   because it sits inside the same bar as interactive controls — check carefully that nothing
   clickable became unclickable or visually broken.
6. **Focus mode** — toggle on/off; confirm the reading column widens/narrows instantly with no flash
   of unstyled content, and the side rail hides/reappears cleanly with no layout jump.
7. **Toggle independence** — turn on only one of the six toggles at a time and confirm only that
   feature's effect appears; turn on all six and confirm they compose without interfering.
8. **Mobile-responsive layout leaking through** — resize the browser window narrow enough to trigger
   LinkedIn's responsive layout; confirm each toggle either still works or does nothing (never
   mis-hides unrelated content).
9. **SPA navigation** — navigate from the feed to a profile and back without a full page reload;
   confirm toggles keep applying (the `setInterval` navigation watcher in `content.ts` re-scans on
   every URL change).
10. **A/B layout variants** — LinkedIn runs its own UI experiments; if any toggle appears to do
    nothing on a given account, that is the expected degrade-to-nothing failure mode (PRD §6), not a
    crash — check devtools for errors regardless, since a thrown error would indicate a real bug, not
    just an unmatched selector.

## Build

```
npm install
npm run icons       # generates src/icons/icon-{16,32,48,128}.png
npm run typecheck
npm run build        # dev build → dist/
npm run build:prod   # minified build → dist/
npm test             # scripts/selftest.mjs — classify.ts + the privacy grep
npm run zip           # production build + dist/ → linkedin-feed-focus.zip
```

Load `dist/` as an unpacked extension in `chrome://extensions` (Developer mode) to test locally.
