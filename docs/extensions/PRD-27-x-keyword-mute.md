# PRD — X Keyword Mute & Filter List

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** X (Twitter)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Mute the words, phrases and topics you never want to see on X again — with a visible reason on every hidden post, not a silent void.

## 2. The hypothesis

**Does a dedicated, more capable keyword-mute tool beat X's own?** X ships a native mute-word feature, and it is genuinely limited: no regex, no whole-word vs. substring control, no import/export of a filter list, no per-rule visibility into what has actually been hidden and why. Anyone who has tried to build a serious muted-words list on X has hit that ceiling.

The demand signal is already on the shelf: "Control Panel for Twitter" — a free, no-signup extension with no account requirement — ranks near the top of feed-control tools for X precisely because it gives users more say over what they see. That is proof people install extensions for exactly this class of control, not proof this specific product wins, but it is enough to justify a cheap, focused bet.

The claim: a fully local keyword/phrase muting tool — regex for power users, importable **community filter packs** (spoilers, politics, crypto spam — shipped as static JSON bundled in the extension, never fetched from a server) for everyone else, and a hit-count per rule so the tool proves its own value — out-performs X's native mute list for anyone who actually cares about their feed's signal-to-noise.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Heavy X users fatigued by a specific topic | Mute crypto spam, politics, or a recurring drama cycle without muting accounts one by one |
| Fans avoiding spoilers | Mute a show/game/season's spoiler terms during a release window |
| Founders / professionals | Cut noise (engagement-bait phrasing, low-signal keywords) from a feed used for work |
| Power users who tried X's native mute list and hit its limits | Get regex, whole-word matching, and a list they can back up |

## 4. Scope — V1

### In scope

**Rules list.** User-defined, stored locally:

```
Rule:  "crypto airdrop"     Mode: substring   Hits: 42
Rule:  \bNFTs?\b             Mode: regex       Hits: 11
Rule:  spoiler               Mode: whole word  Hits: 3
```

Each rule is a single keyword or phrase, case-insensitive by default, with a **whole-word or substring** matching toggle, and an **optional simple regex mode** for power users. Rules apply to a post's own text, the author's display name, and its hashtags, as posts render in the timeline.

**Visible hiding, never silent removal.** A post that matches a rule collapses to a one-line placeholder:

```
Hidden by filter: "crypto airdrop"  ·  Show anyway
```

The post is never deleted from the DOM and never vanishes without a trace — a click on "Show anyway" reveals it for that session. Silent removal is explicitly rejected: it is what makes a feed-control tool feel untrustworthy, and it is what hides the tool's own mistakes from the user.

**Hit count per rule.** Every rule shows how many times it has fired, all-time and today, in the panel — the number that tells someone whether a rule is doing anything at all, or hiding far more than expected.

**Starter filter packs.** A handful of bundled, static packs the user can enable with one click — e.g. "Spoilers (general)", "Politics", "Crypto & NFT spam". Shipped as JSON inside the extension package. **Never fetched from a server, never updated over the network** — a new pack ships in a new extension version, like any other bundled asset.

**Import/export of the rule list as JSON.** The whole rule list, one file, portable between machines and back-up-able.

### Explicitly out of scope for V1 — and permanently

**No AI-based content classification.** Rules are literal strings or user-supplied regex — no model, no "detect spoilers automatically," no server-side or on-device classifier. That is a different, much larger product with a much larger trust burden.

**No reporting or blocking of accounts.** No X write actions of any kind — no mute-account, no block, no report, no follow/unfollow. This extension only ever hides rendered text locally; it never touches the user's X account.

**No sharing rule lists between users via any server.** Starter packs are the only "shared" content, and they are static and bundled — there is no upload, no community submission pipeline, no server-hosted pack registry. If that becomes wanted later, it is a different product with a different trust and privacy posture, not a V1 patch.

## 5. Where the data comes from — read before committing

This extension reads only the text X has already rendered in a post as it appears in the DOM — the post's own text, the author's display name, and its hashtags — in the tab the user is actively looking at. It never fetches anything, never reads a post the user hasn't scrolled to, and never runs in the background.

**The failure mode, stated plainly:** a rule that matches too broadly can hide legitimate content the user actually wanted to see. This is not a hypothetical edge case — it is the central risk of any keyword-mute tool, and no amount of matching cleverness eliminates it. The product's answer is not "get the matching perfectly accurate" — that is not achievable with literal string/regex matching — the answer is:

- **The hit-count per rule** makes an overly broad rule visible instead of invisible. A rule with 400 hits in a day is a rule worth checking.
- **The visible placeholder, never silent removal**, means a hidden post is one click from being un-hidden — the user is never fully cut off from what the tool decided to hide.

These are a safety net, not an accuracy guarantee. The listing and onboarding must say so, not imply the tool "understands" content.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Placeholder applied | < 250 ms after a post renders; no layout shift in the timeline |
| Rule evaluation | < 5 ms per post at 100 rules |
| Panel open (any rule-list size within reason) | < 400 ms |
| Permissions | `storage` + host permissions `*://*.x.com/*`, `*://*.twitter.com/*`. No `downloads` or `activeTab` in V1 — rule-list export uses a direct-download anchor, not the `chrome.downloads` API, so the permission is not requested. If a later version needs `chrome.downloads` (e.g. programmatic save-as), add `downloads` at that point, not before. |
| Privacy | No network requests anywhere in the extension |
| Resilience | A parse failure disables filtering for that post quietly; the timeline must never break |

## 7. Edge cases

- **A rule matching almost every post.** Should warn the user in the panel rather than silently hiding their whole feed — track hits against posts scanned per rule and flag a rule whose hit ratio crosses a threshold over a meaningful sample.
- **Unicode and emoji in rules.** Whole-word matching must treat non-ASCII letters as word characters (not just `[a-zA-Z0-9_]`), so a rule in a non-English language or a rule containing emoji behaves sensibly rather than silently never matching or over-matching.
- **Retweets/quoted content vs. the quoting user's own text.** V1 matches against the full rendered text of a post, which includes an embedded quoted post's text when present. A rule can therefore hide a post because of text in the *quoted* post, not the quoting user's own commentary — this is a deliberate, disclosed simplification (matching the whole rendered surface), not an attempt to parse quote structure precisely.
- **Performance with 100+ rules against a fast-scrolling feed.** Must stay inside the < 5 ms/post budget; rules are evaluated as plain string/regex tests, no heavier matching strategy.
- **Regex rules that are invalid or catastrophically slow.** An invalid pattern must be caught and flagged in the UI as an error, never crash the content script; regex complexity is the user's own risk but a compile failure must never break the timeline.
- **A rule with an empty or whitespace-only value.** Never usable, never evaluated.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 30% | 40% |
| Users who create ≥ 1 rule (own or starter pack) | 60% | 75% |
| Users who enable ≥ 1 starter pack | 35% | 50% |
| Users with ≥ 1 hidden post | 50% | 65% |
| Export used ≥ once | 10% | 20% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 300 installs at 90 days, **or** under 35% of users ever seeing a hidden post. The latter means either onboarding fails to get someone to a working rule fast enough, or X's own native mute list is "good enough" for most people and this tool's edge (regex, packs, hit counts, visibility) doesn't matter to the market — either way, the fix is not more matching features.

## 10. Open questions

- **Do starter packs actually get used, or does everyone write their own rules?** If packs go unused, the product is really "a better version of X's native mute list" for power users only, and the addressable market shrinks accordingly — worth knowing early.
- **Is "Show anyway" a per-post, per-session action, or should it persist an allowlist entry?** V1 treats it as session-only, to avoid a second whole feature (exceptions) before the first one has proven demand. If reviews ask for it repeatedly, that is a V1.1 candidate.
- **How much does the too-broad-rule warning actually get looked at?** If nobody opens the panel to check a flagged rule, the warning belongs somewhere more visible (a toast, not just a panel badge) — decide with usage data, not guesswork.
