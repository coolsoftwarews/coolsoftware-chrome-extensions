# Universal Tab Stash & Reading-List Export

Chrome MV3 extension. Stash a set of tabs — all of them, or just the ones you pick — into a named,
timestamped collection, optionally closing them after. Restore the whole stash or one tab at a time.
Search across every stashed tab. Export any stash, or everything, as a Markdown reading list or CSV.
No account, no backend, no network requests.

Built from [PRD-43](../../docs/extensions/PRD-43-universal-tab-stash.md). This is one of
the simplest, lowest-risk builds in the portfolio: `chrome.tabs` is a stable first-party API, not a
page's markup, so there is no DOM to scrape and no site redesign that can break it.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — stash creation, search, exports, merge-by-id
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required.

Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/stash.ts` | All the pure logic: create a stash, filter pinned tabs, search, plan a restore (batching + confirmation), merge an imported backup by id. No `chrome.*` anywhere in this file. |
| `src/formatters.ts` | Markdown reading-list and CSV writers, plus filenames — pure, fully tested |
| `src/tabs.ts` | The one file that calls `chrome.tabs.*` — query the current window, close tabs, open tabs. Makes no decisions itself; it only acts on what `stash.ts` planned. |
| `src/storage.ts` | `chrome.storage.local` records, backup export/import (wraps `stash.ts`'s pure `mergeBackup`), quota status |
| `src/metrics.ts` | Local-only usage counters — same contract as the rest of the portfolio |
| `src/background.ts` | Thin service worker: opens the side panel, shows the welcome page on install |
| `src/panel.ts` | The whole UI: tab picker, stash list, search, restore, export, data ownership |

### Why the pure/impure split matters here

Unlike the DOM-scraping extensions in this portfolio, there's no anchoring risk and no fragile
selector logic — but there's still a strong reason to keep `chrome.tabs` calls out of the decision
logic: it's the only way `scripts/selftest.mjs` can test stash creation, search, restore-batch
planning and backup merging without spinning up a browser. Every one of those is a pure function over
plain `OpenTab` / `Stash` / `StashedTab` objects; `tabs.ts` and `storage.ts` are the thin, untested-by-
selftest edges that turn those decisions into real browser actions.

### Pinned tabs (PRD §7)

"Stash all tabs" excludes pinned tabs by default — they're usually a persistent utility (email,
calendar) the user didn't mean to sweep up and close. They stay individually selectable in the tab
picker for anyone who wants to include one.

### Restoring a large stash (PRD §7)

Tabs open in batches of 8, with a short pause between batches, so the browser stays responsive.
Restoring more than 15 tabs at once asks for confirmation first ("This opens 47 tabs — continue?");
below that, restore happens immediately.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` — verifiable with `grep -rn "fetch(" src/` and in
devtools' network tab. Stashes and usage counters live in `chrome.storage.local` and are never
transmitted. See [PRIVACY.md](PRIVACY.md).

## Permissions

`tabs`, `storage`, `downloads`, `sidePanel` — nothing else. No `activeTab`, no `scripting`, no
`host_permissions` at all. This extension never injects into a page; it only reads/opens/closes tabs
through the browser's own tab-management API. Confirm this yourself in `dist/manifest.json`.

## Manual test checklist

The pure logic is covered by `npm test`; this list is for the parts that need a real browser:

- [ ] Stash all tabs in a window with 1, 5 and 50+ tabs; confirm pinned tabs are excluded by default
- [ ] Stash a hand-picked subset via the tab picker's checkboxes
- [ ] "Close tabs after stashing" actually closes exactly the stashed tabs, nothing else
- [ ] Restore all (small stash: immediate; 20+ tab stash: confirmation dialog first)
- [ ] Restore a single tab from within a stash's expanded view
- [ ] Search across two+ stashes by a word that only appears in one tab's title, and one that only
      appears in a URL
- [ ] Export a single stash as .md and .csv; export "all stashes" as .md and .csv
- [ ] Data → Export all data → Clear all data → Import the same file → everything comes back
- [ ] Import the same backup file twice — no duplicate stashes or tabs
- [ ] A tab still loading when stashed (no title yet) still stashes with a usable placeholder
- [ ] A stashed URL that now 404s restores anyway, no warning
- [ ] Storage-quota warning appears once local storage crosses 80% (can be forced by importing a large
      synthetic backup)

## Known limits

- No cross-device sync — export/import is the only cross-device path, by design (see PRD §2).
- No automatic or scheduled stashing — every stash is a deliberate action.
- No duplicate-tab detection across browsing history — only within what's explicitly stashed.
