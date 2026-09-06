# X Keyword Mute & Filter List

Chrome MV3 extension. Mutes keywords and phrases in your X (Twitter) timeline — with a whole-word or
substring toggle, an optional regex mode for power users, bundled starter filter packs (spoilers,
politics, crypto/NFT spam, engagement bait), and a hit count per rule. No account, no backend, no
network requests, no automation.

Built from [PRD-27](../../docs/extensions/PRD-27-x-keyword-mute.md). It reuses the
portfolio's Rules-engine shape (see [README](../../docs/extensions/README.md)'s
shared-modules table) in a deliberately simpler, single-signal form than Facebook Group Opportunity
Finder's two-part intent+topic rule — this product mutes on one value at a time, not a pair.

## Quick start

```bash
npm install
npm run icons          # regenerate src/icons/*.png (no image dependency)
npm run build          # dev build into dist/
npm run build:watch    # rebuild on change
npm run build:prod     # minified, production manifest name
npm test               # headless checks — matching engine, hashtags, starter packs
npm run typecheck
npm run zip            # production build + dist/ packed for the Web Store
```

Node 18+ is required. Load it: `chrome://extensions` → Developer mode → **Load unpacked** → select
`dist/`. Then open x.com and click the toolbar icon.

## How it works

| File | Job |
| :-- | :-- |
| `src/rules.ts` | The matching engine — compiles a rule to a matcher (substring/whole-word/regex), `matchPost`, the too-broad detector, hashtag extraction. Pure, fully tested. |
| `src/starter-packs.ts` | Four bundled starter packs — spoilers, politics, crypto/NFT spam, engagement bait — shipped as static data, never fetched |
| `src/extract.ts` | X DOM extraction (post text incl. quoted post, author name) + the article selector |
| `src/content.ts` | Scans the timeline, collapses a match to a placeholder, persists the hit count, watches for a too-broad rule |
| `src/storage.ts` | `chrome.storage.local` records for the rule list, backup export/import, quota |
| `src/metrics.ts` | Local-only usage counters — rules active, hit counts, posts hidden today |
| `src/popup.ts` | Toolbar popup: rule list, starter packs, data ownership, usage stats |

### The rule, which is the whole product

A rule is one keyword or phrase (or, in regex mode, a pattern), matched against a post's own text
(including an embedded quoted post's text when present — PRD §7), its author's display name, and its
hashtags:

```
Rule:  "crypto airdrop"     Mode: substring   Hits: 42
Rule:  \bNFTs?\b             Mode: regex       Hits: 11
Rule:  spoiler               Mode: whole word  Hits: 3
```

Matching is case-insensitive by default (a rule can opt into case-sensitive). Whole-word mode uses
Unicode-aware boundaries (`\p{L}`/`\p{N}`, not `\w`), so a rule in a non-English language, or one
containing an emoji, behaves sensibly instead of silently never matching (PRD §7). An invalid regex
never crashes the content script — `compileRule` returns `null` and the panel flags it before it's
saved.

### Hidden, never deleted

A matched post collapses to one line — `Hidden by filter: "crypto airdrop"` — right where it was in
the timeline, with a **Show anyway** button. The original DOM nodes are never removed or reparented:
the extension adds a `data-xkm-hidden` attribute plus one injected stylesheet rule that hides the
post's existing children, and appends one new placeholder node. That's deliberate — X's timeline is a
React tree, and moving or deleting nodes React still owns risks a reconciliation error on the next
re-render; adding an attribute and one sibling node is what the portfolio's other X extensions do too
(see `XVelocityFinder`'s badge approach) for the same reason.

### The too-broad warning

Every scanned post increments a session-only counter; every hit increments a per-rule session counter.
When a rule's hit ratio crosses a threshold over a large enough sample
(`isRuleTooBroad`, `src/rules.ts`), a one-time toast appears in the timeline and the popup shows a
dismissible banner (PRD §7: "a rule matching almost every post — should warn the user, not silently
hide their whole feed"). This is a session signal, not a persisted per-day breakdown per rule — see
Known limits.

## Permissions

`storage` (the rule list) plus host access to `*://*.x.com/*` and `*://*.twitter.com/*` — nothing
else. There is no `activeTab`, no `downloads`, no `sidePanel` permission:

- The UI is a **toolbar popup**, not a side panel, specifically so `sidePanel` isn't needed.
- Rule-list export uses a plain `<a download>` anchor + `URL.createObjectURL`, not
  `chrome.downloads.download`, specifically so `downloads` isn't needed.
- The popup reads the active tab via `chrome.tabs.query`, which returns a tab's `url` for hosts the
  extension already has `host_permissions` for — x.com and twitter.com — without needing `activeTab`.

## Privacy

No `fetch`, `XMLHttpRequest` or `sendBeacon` anywhere — verifiable with `grep -rn "fetch(" src/` and
in devtools' network tab. The rule list and usage counters live in `chrome.storage.local` and are
never transmitted. See [PRIVACY.md](PRIVACY.md).

## Manual test checklist

The DOM-bound half needs a real browser and a real X session.

- [ ] A rule with a common word, whole-word mode: matches on its own, not mid-word
- [ ] The same rule, substring mode: matches mid-word too
- [ ] A regex rule with a deliberately invalid pattern: the rule form shows an error, nothing saved
- [ ] A matching post collapses to the one-line placeholder; **Show anyway** reveals it
- [ ] Infinite scroll: scroll well past the initial page load, new posts still get evaluated
- [ ] A quote post whose *quoted* text (not the quoting user's own text) matches a rule still hides —
      and the README/PRIVACY language about this is accurate, not surprising
- [ ] Enable a starter pack, confirm every rule in it appears and is enabled
- [ ] A rule edited to match ~everything: the too-broad toast appears once, and the popup banner shows
- [ ] Toggle a rule off: previously hidden posts matching only that rule reappear without a reload
- [ ] Export rules → clear all → import → rules come back with hit counts intact
- [ ] Timeline virtualization: scroll a post out of view and back; it is not re-hidden twice or
      duplicated

## Known limits

- V1 matches a post's full rendered text, which includes an embedded quoted post's text — a rule can
  hide a post because of the *quoted* post's words, not the quoting user's own commentary. Disclosed,
  not hidden (PRD §7).
- No AI-based content classification, permanently — rules are literal strings or user regex, nothing
  more (PRD §4).
- No reporting or blocking of accounts, and no write action of any kind on X — this extension only
  ever hides rendered text locally (PRD §4).
- The too-broad warning is a session signal (resets on reload), not a persisted daily breakdown per
  rule — see PRD §10's open question about whether that's visible enough.
- X's DOM is actively hostile to scraping; extraction accuracy will drift with X's own redesigns and
  is not guaranteed. A parse failure disables filtering for that one post, never the whole timeline.
