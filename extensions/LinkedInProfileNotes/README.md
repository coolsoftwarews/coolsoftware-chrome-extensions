# LinkedIn Profile Notes (Local CRM-lite)

Chrome MV3 extension. A private note on any LinkedIn profile you visit — free text plus an
optional one-line tag, keyed by the profile itself. No account, no backend, no network requests,
and no action taken on your behalf — it only reads the name and headline already rendered on the
profile page you're looking at.

Built from
[PRD-34](../../docs/extensions/PRD-34-linkedin-profile-notes.md). Sibling to
[LinkedIn Creator Watchlist](../LinkedInCreatorWatchlist) (tracks a watched creator's **posts**)
and [LinkedIn Engagement Lead Finder](../LinkedInLeadFinder) (collects a post's **commenters**) —
this product tracks neither posts nor comments. It works on *any* profile the user visits,
whether or not that person has ever posted or commented on anything; the only trigger is "I
visited this profile." The storage/backup/export shape follows [WebHighlighter](../WebHighlighter)
and [YouTubeTranscription](../YouTubeTranscription), and the build tooling mirrors both LinkedIn
siblings exactly.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build           # dev build into dist/
npm run build:watch     # rebuild on change
npm run build:prod      # minified, production manifest name
npm test                # headless checks — text parsing, fuzzy matching, CSV, filenames
npm run typecheck
npm run zip              # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** →
select `dist/`.

## How it works

| File | Job |
| :-- | :-- |
| `src/text.ts` | Pure string helpers — profile URL normalization, fuzzy name+headline key, relative-time formatting |
| `src/export.ts` | CSV export, filenames — pure, fully tested |
| `src/storage.ts` | `chrome.storage.local` notes, fuzzy-match lookup, backup export/import, quota |
| `src/metrics.ts` | Local-only usage counters |
| `src/content.ts` | Injects "+ Note" on a profile page, reads the profile's name/headline, persists the note |
| `src/background.ts` | Opens the side panel |
| `src/panel.ts` | The note library: search, sort, tag filter, inline editing, CSV/JSON export, data ownership |

### The note

On any personal profile page (`/in/...`), a small "+ Note" control appears near the name. Click it
to open a lightweight editor: free text plus an optional one-line tag (a short starter set —
`met at conf`, `candidate`, `follow up`, `client`, `prospect` — or type your own). Saving happens
automatically, debounced while typing and immediately on blur — no separate save button.

Revisiting a profile with an existing note shows it inline, with a small "last noted: 3 days ago"
indicator, so the extension pays off the moment you land on a profile you've noted before —
opening the side panel is for browsing the whole library, not a requirement for the core loop
(PRD §4).

There is exactly one note record per profile, keyed by the profile's normalized URL. Editing an
existing note updates it in place; there is no separate "add another note" concept.

### The fallback match

LinkedIn vanity URLs change (PRD §7). If the extension finds no note under the current URL but a
name+headline match exists under a different stored id, it offers a one-click "bring that note
here" suggestion rather than silently losing the old note or silently merging it. The match is a
loose, punctuation- and case-insensitive comparison (`src/text.ts#fuzzyKey`) — a false positive is
possible for two different people who happen to share a name and headline exactly; the suggestion
is always opt-in.

### The panel

All noted profiles in one place: search by name, headline, tag or note text; sort by recency or
alphabetically; filter by tag; edit or delete a note without revisiting the profile; open the
profile in a new tab.

### Export

**CSV** — name, headline, tag, note, profile URL, first noted, last noted — the deliverable if you
just want a spreadsheet. **JSON** — the full backup shape, used for export/import/clear under
"Data" in the panel footer, matching every other product in this portfolio.

## Privacy

No `fetch`, no `XMLHttpRequest`, no `sendBeacon` anywhere in this extension — verifiable with
`grep -rn "fetch(" src/` and in devtools' network tab. Notes and usage counters live in
`chrome.storage.local` and are never transmitted. See [PRIVACY.md](PRIVACY.md).

## What this extension will never do

No email or phone extraction, ever — resolving a person to contact details is a different legal
category (data broker territory) and the exact compliance-risk ground every folk/Lusha/Dux-Soup/
Lemlist-style competitor operates on (PRD §2). Not a V1 gap, not a roadmap item. No bulk profile
visiting or scraping — a note only ever gets created because the user is looking at that profile
right now; the extension never opens, queues, or iterates over profiles on its own. No CRM sync or
integration. No connection-request automation, no auto-follow, no auto-message — this is a
permanent product boundary shared with both LinkedIn siblings, not a V1 limit. If you're looking
for outreach automation or contact enrichment, this deliberately isn't it.

## Manual test checklist

The DOM-bound half (`src/content.ts`) needs a real, logged-in LinkedIn session and cannot be unit
tested — LinkedIn's class names are unstable. Before shipping, walk this by hand:

- [ ] A personal profile with both a name and a headline — control appears, no layout shift
- [ ] A profile with no headline set — control still appears, panel doesn't break
- [ ] Typing a note and tabbing away — note saves, "last noted" indicator updates
- [ ] Revisiting a noted profile in a new tab — existing note and indicator show correctly
- [ ] Viewing a profile in "you're viewing anonymously" mode — control still works (PRD §7)
- [ ] A profile visited under two different vanity URLs with the same name+headline — fallback
      match suggestion appears and "bring that note here" merges correctly
- [ ] Panel: search across name/headline/tag/note text, sort, tag filter, inline edit, delete
- [ ] Export CSV, open it in a spreadsheet, confirm columns/quoting including a note with a comma
      and a newline
- [ ] Data → export all → clear all → import → everything comes back, including tags
- [ ] Importing the same JSON backup twice does not duplicate or lose a note
- [ ] SPA navigation between profiles (LinkedIn client-side routes) — control re-injects correctly
      each time without stacking duplicate controls

If LinkedIn changes its markup and the control stops appearing, update the selector lists in
`src/content.ts` — nothing else in the extension needs to change.

## Known limits

- Selectors are best-effort against LinkedIn's current markup and will need periodic maintenance
  (PRD §7, "LinkedIn DOM rewrites") — this is inherent to reading someone else's page, not a bug.
- The fallback name+headline match is intentionally loose; two different people who happen to
  share both fields exactly would be offered as a match. It is always a one-click suggestion, never
  an automatic merge.
- No cross-device sync — storage is local and per-device by design (PRD §2, the whole hypothesis
  under test). Export a JSON backup before uninstalling or clearing browser data if you want to
  keep your notes, and import it into another install.
- No reminders or alerts. If a note needs a "follow up in 3 days" nudge, that's outside this
  product's scope — see PRD §4, "Explicitly out of scope."
