# PRD — YouTube Comment Digest & Best-Comments Finder

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** YouTube
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

A side panel that turns YouTube's comment section into something you can sort, search and skim — surfacing the comments that actually answer "does this work?" without endless manual scrolling.

## 2. The hypothesis

The current top-ranking, no-signup YouTube extensions — SponsorBlock, Unhook, Return YouTube Dislike, Enhancer for YouTube, DeArrow — all focus on the **video** experience: skip the sponsor read, hide distractions, restore a number, add a control, fix a thumbnail. None of them focus on **comments**, despite comments often being where the most useful information on the page actually lives: does a tutorial's method really work? Did a product review hold up after six months? What does the audience actually think, once you get past the pinned comment and the first three replies?

The hypothesis: a compact, sortable/searchable comment-reading panel — surfacing what YouTube has already loaded into the page, with no API and no signup — is unclaimed territory on this platform, with real demand from three distinct groups: researchers deciding whether to trust a claim, buyers deciding whether to trust a review, and creators checking their own audience's actual reaction without scrolling past hundreds of low-signal replies.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Researchers / students | "Does this tutorial actually work, according to people who tried it?" |
| Buyers-before-they-buy | "Did this product review hold up? What do owners say six months later?" |
| Creators | "What is my audience actually reacting to, without reading every reply?" |
| Journalists / analysts | Skim community sentiment on a video quickly, without manual scrolling |

## 4. Scope — V1

### In scope

- **A side panel that mirrors the comment section already rendering in the page.** No new data is fetched — everything shown is already loaded into YouTube's own DOM. The panel reads it, structures it, and gives the user better tools than YouTube's own list.
- **Sort**, matching YouTube's own order by default ("Top comments", as the user has it set on the page) or switched client-side to: most-liked, most-replies, newest-first — computed entirely from what has already loaded, parsed from the DOM (no API).
- **Keyword search** across every loaded comment (author + body), live-filtering the panel list as the user types.
- **A "Load more" trigger** that programmatically scrolls YouTube's native comment section to bring more comments into view (exactly what a manual scroll would do), then re-indexes whatever newly mounted.
- **Export** the currently visible/filtered comment set as **Markdown** or **CSV** — a download, not an upload, per the portfolio's hard constraints.
- **A word-frequency mini-summary** — the most-repeated words and short phrases across the loaded comments, with common stopwords filtered out, computed **entirely client-side**. This is explicitly **not** an AI summary: no model, no API call, no interpretation — just counts, labelled as counts.

### Explicitly out of scope for V1

- No sentiment AI, no LLM-generated summary of "what people think" — the word-frequency panel is the ceiling of "digest" for V1.
- No reply/posting to comments. **Read-only, always** — this extension never writes to YouTube on the user's behalf.
- No cross-video comment search or history. Every session is scoped to the video currently open in the tab.

## 5. Where the data comes from — read before committing

This extension reads only the comment DOM YouTube has already rendered and loaded for the current video, in the current tab, right now. There is no API call, no backend, and no attempt to fetch comments YouTube itself hasn't already sent to the browser.

Two structural risks follow directly from that:

1. **Comments are heavily lazy-loaded.** YouTube renders none of the comment section until the user scrolls near it, and loads more in batches as the user scrolls further or clicks "Show more". The panel can only ever show what has been mounted into the DOM at the moment it reads — it is a mirror, not a fetch, and the UI must say so plainly (a visible "N loaded" count, never presented as "all comments").
2. **YouTube's comment component structure has changed before**, and will again — component tag names, class names and even the mechanism for reading a like count or reply count are not a stable public contract. The extraction layer must therefore **degrade field-by-field**: a comment whose like-count cannot be parsed still shows in the panel, just without a like badge, rather than the whole comment (or the whole panel) failing to render. No single unparseable field is allowed to break another field, another comment, or the extension as a whole.

**Required pre-ship spike:** before this ships, someone needs to open a real YouTube video with a real, populated comment section and manually confirm, against the live DOM: (a) the current selectors for author, text, like count, reply count, published time, pinned badge and creator-heart badge all resolve; (b) scrolling the comments container actually triggers YouTube's own lazy-load, and the panel's re-scan picks up the new comments; (c) the "comments are turned off" state is detected correctly. This build could not verify any of that against a live page — it is implemented with multiple selector fallbacks and graceful per-field degradation on the assumption that some of them are wrong, and the README below carries this as an explicit pre-ship checklist item, not a silent guess presented as fact.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel` |
| Host permission | `*://*.youtube.com/*` |
| Zero-config | Works on install; no signup, no API key, no onboarding flow required to get value |
| Degradation | A field that fails to parse degrades to "not shown" for that one field — never breaks the comment, the list, or the panel |
| Foreground only | No polling, no background crawling; the panel only reads what is on screen when asked |
| Read-only | No code path capable of posting, liking, replying to, or otherwise modifying anything on YouTube |
| Local storage only | Sort/export preferences persist locally; no comment content is ever written to storage — the panel is a live mirror of the current page, not an archive |
| Panel responsiveness | Re-sorting or filtering an already-loaded comment set updates the visible list in well under 300 ms |

## 7. Edge cases

- **Comments disabled on a video.** YouTube shows its own "Comments are turned off" message in place of the comment list — the panel must detect this and show its own explicit empty state, not a blank list or a false "0 comments loaded" reading.
- **Pinned and creator-heart comments** are common signal (a creator confirming or pushing back on a claim) and must be **marked distinctly** from ordinary comments — a pinned badge and a hearted badge, not merged into one generic "special" marker, since they mean different things.
- **Reply threads.** V1 stays **flat**: a top-level comment shows a reply-count badge, but replies are never recursively expanded or fetched — expanding a thread is left to YouTube's own UI. This keeps the panel's list a predictable, flat set matching what "top-level comments" means everywhere else in the product (sort, search, export all operate on the same flat set).
- **Non-English comments and stopword filtering are English-only in V1.** The word-frequency panel's stopword list only understands English function words, so a non-English comment section will produce a noisier, less useful word list (common non-English function words will not be filtered out). This is a known, documented V1 limitation, not silently pretended away — proper multi-language stopword handling is a V2 candidate if the feature proves used.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| 7-day retention | 25% | 35% |
| Sessions with search or sort used | 40% | 55% |
| Export used (md or csv) | 10% of users | 20% of users |
| Store rating | ≥ 4.0 | ≥ 4.4 |

**Instrumented events (local only):** panel opened, sort changed, search used, load-more triggered, word-frequency panel opened, export by format. No comment text, no video id, no query string ever leaves the device — counters only.

## 9. Kill criteria

Under 250 installs **or** under 15% 7-day retention at 90 days → stop investing further. This is a narrow, single-surface product; if the panel isn't earning repeat use, a bigger comment feature set won't fix that — the next YouTube slot experiment should ship instead.

## 10. Open questions

- **Does "Top comments" as YouTube ranks it, read client-side, actually correlate with what a researcher or buyer wants to see first**, or does the most-liked sort end up doing more of the real work? Worth watching which sort mode gets used most once there is usage data, rather than assuming either is the default users will prefer.
- **Is the word-frequency mini-summary actually useful, or does it read as noise** compared to just skimming the top few most-liked comments? If usage data shows it's rarely opened, cut it in favor of a sharper V1 rather than iterating on stopword lists for a feature nobody opens.
- Should the panel eventually let a user pin a search term across return visits to the same video (e.g. "battery" for a review), given comments are never persisted? Left open for V2 — V1's storage stays limited to sort/export preferences, not per-video state, on purpose.
