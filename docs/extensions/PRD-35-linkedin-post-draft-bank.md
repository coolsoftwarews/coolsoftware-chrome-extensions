# PRD — LinkedIn Post Draft Bank & Formatting Checker

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Write LinkedIn posts inside LinkedIn's own composer with a live "see more" cutoff marker and your own searchable library of past drafts and published posts to reuse — no AI, no account, nothing leaves the browser.

## 2. The hypothesis

**Will people who write LinkedIn posts regularly install a narrow, LinkedIn-specific drafting tool alongside — or instead of — Grammarly?** Grammarly is the one universally-liked, account-optional writing helper that shows up in every "best LinkedIn extensions" roundup, and for good reason: it's free to start, works everywhere, and nobody resents it. But it is a generic grammar/tone checker with zero LinkedIn-specific knowledge. It has no idea that LinkedIn truncates a post to roughly 200–220 visible characters on desktop (about 140–150 on mobile) behind a "…see more" link — a fact every serious LinkedIn writer optimizes their hook around — and it has no concept of a personal swipe file of a creator's own past hooks, formats and published posts.

The hypothesis: a LinkedIn-specific, fully local drafting companion — showing exactly where the "see more" cut lands as the user types, plus a searchable local library of their own past drafts and posts as reusable templates — serves a real, underserved need that a generic writing assistant structurally cannot serve, without requiring Grammarly's cloud-based AI, an account, or a subscription. This tests the "workflow tool that piggybacks on a platform-specific mechanical fact" problem class, distinct from PRD-10's "curated reading list" workflow test.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| B2B founders/executives who post regularly | Land the hook before the cutoff, reuse what worked before |
| LinkedIn creators / ghostwriters | Keep a personal swipe file of their own hooks and formats without a separate notes app |
| Marketers who write on behalf of a company page | Draft offline from a template library, paste in when ready |
| Anyone who has ever lost a half-written LinkedIn post to a closed tab | Local drafts that survive a browser crash |

## 4. Scope — V1

### In scope

**Truncation overlay while composing.** While the user is writing a post in LinkedIn's own post editor (the "Start a post" modal), a small overlay shows:
- A live character count
- A visual marker at the point in the text where the "…see more" cut would land (see §5 for the exact number and its honesty caveat)
- A one-line note when the post is long enough that the hook above the fold is what most viewers will ever read

**Local draft/template library.**
- Save the current composer text as a draft or a reusable template, tagged by topic
- Search across the whole library (drafts, templates, and archived published posts — see below) by text and tag
- "Insert template" — quick-pastes a saved template's text into the currently open composer. This is the one and only write action this extension ever performs against LinkedIn's own UI, and it only ever inserts text the user already wrote and explicitly chose to reuse — it never generates new text and never submits anything.

**Auto-archive of the user's own published posts.** Captured only from the user's own profile's activity feed (never any other user's posts — pulling other people's published posts into a personal library would be scraping, which is out of scope permanently, not just for V1). Gives the user a growing personal reference of what they've actually posted, without needing to separately screenshot or copy-paste it themselves.

**Export.** CSV and Markdown, across the whole library or a filtered/searched subset.

**Data ownership.** Export all / import / clear all; quota warning at 80% (`chrome.storage.local` is 10 MB).

### Explicitly out of scope for V1

- **No AI writing, rewriting, or suggestions of any kind.** That needs a backend LLM API, which is against this portfolio's hard constraint (no backend, no keys, no server — see README). If a future version wants AI assistance, it is a different product with a different cost structure, not a V1.1 toggle on this one.
- **No scheduling or publish automation.** The extension never clicks "Post" and never queues a post to publish later. The only write action anywhere in this codebase is inserting the user's own saved text into the composer, described above — nothing beyond what the user typed into LinkedIn's own composer themselves, whether they typed it just now or saved it last month.
- **No team or shared libraries.** Everything is local to one browser profile. No sync, no invite links, no shared workspace.
- **No engagement/analytics tracking on published posts** (reaction counts, etc.) — that's a different problem class (see PRD-10's outlier badge), and mixing it in here would blur this PRD's own proposition.

## 5. Where the data comes from — read before committing

**The exact "see more" cutoff is a real product detail, and it is not a fixed, documented number.** Public write-ups researching this consistently land in the same range — roughly 200–220 visible characters on desktop, roughly 140–150 on mobile — but every source agrees the number is not fixed: it shifts with device, window width, LinkedIn's own app version, and LinkedIn changes it without announcement. Line breaks count as characters and the feed also limits visible *lines*, so a post with several short lines can truncate well before the character-based estimate.

**This PRD's required 1-day spike, same discipline as every other PRD in this portfolio:** before shipping, open LinkedIn's own composer and post preview at a few realistic viewport widths (desktop feed width, and — if testable — the mobile web view) with posts of varying line-break density, and confirm empirically where "…see more" actually appears. Record the observed cutoff(s) and whether line-wrapping behavior matches the character-count model or needs a line-based adjustment.

**Fallback if the exact number can't be confirmed for a given context:** ship a conservative, clearly-labelled estimate rather than presenting it as exact. The overlay's copy must say "approximate — LinkedIn changes this without notice" rather than implying a guaranteed cutoff, and the shipped default should be documented in the README as `desktop: ~210 characters, mobile: ~140 characters` sourced from public research, not a live LinkedIn measurement, until the spike confirms otherwise. Never let the UI claim certainty this feature cannot deliver — an overconfident marker that's wrong is worse than an honestly-labelled approximate one.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Truncation overlay appears | < 300 ms after the composer opens; updates on every keystroke with no visible input lag |
| No layout shift | Overlay never pushes LinkedIn's own composer content; it floats, it doesn't insert into flow |
| Library with 500 drafts/templates/posts | Panel opens < 600 ms, search returns < 100 ms |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel` + host permission `*://*.linkedin.com/*` |
| Privacy | No network requests anywhere in the codebase — everything is `chrome.storage.local` |
| Safety | The only DOM write against LinkedIn's own page is inserting the user's own saved text into an open composer on explicit click; no other write path exists in the codebase |

## 7. Edge cases

- **Posts with an image, document, or poll attached.** These change the truncation math (LinkedIn reserves feed space differently around attached media) — the overlay must say when a post has attached media that the character-based estimate is less reliable, rather than silently showing a marker calibrated for text-only posts.
- **Draft auto-save racing LinkedIn's own composer auto-save.** LinkedIn already autosaves an in-progress post as one of its own drafts. This extension's own auto-save must be clearly a *separate*, extension-owned draft (its own list, its own "saved locally at HH:MM" label) rather than presented as if it were LinkedIn's draft — conflating the two would have a user think a post is safe in one system when it's only in the other.
- **Multi-line posts with intentional line breaks near the truncation point.** A line break the user placed on purpose (e.g., for a poem-style post or a numbered list) can move the actual "see more" point earlier than a naive character count would predict; document this as a known limitation of the character-based marker, and if the spike confirms it's a common case, treat line breaks as extra "weight" toward the cutoff rather than ignoring them.
- **Editing a previously-published post.** LinkedIn allows light edits to a post after it's live. Re-archiving on every edit would create duplicate/near-duplicate library entries; the archive should detect the same post (stable post identifier from the activity feed, not text content) and update the existing archived copy in place rather than adding a new one.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,200 |
| 7-day retention | 25% | 35% |
| Users with ≥ 1 saved draft or template | 50% | 60% |
| Users who used "Insert template" ≥ once | 20% | 30% |
| Overlay shown on ≥ 3 separate composer sessions | 35% | 45% |
| Export used ≥ once | 10% | 20% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 200 installs at 90 days, **or** fewer than 20% of installs saving at least one draft/template by day 30. A truncation marker alone is a nice-to-have people will screenshot once and forget; if the library half of the product isn't getting used, the "workflow" hypothesis specifically (not just this product) has failed to find a foothold here, distinct from PRD-10's own kill criteria on the "curated reading" hypothesis.

## 10. Open questions

- **Is the truncation marker even the draw, or is it the library?** If 90-day data shows heavy composer-overlay usage but light library usage (or vice versa), that's a signal about which half of this PRD's combined hypothesis is actually true — worth splitting into two separate, more focused products in a future iteration rather than assuming both halves are equally load-bearing forever.
- **Does auto-archiving the user's own published posts feel like a feature or a mild surprise?** It's opt-in in spirit (the user has to open the panel and notice it happening) but not opt-in by an explicit toggle in V1. If early reviews read it as unexpected rather than convenient, add an explicit on/off switch — cheap to add, not worth gating V1 on speculatively.
- **Mobile web LinkedIn.** The spike in §5 should say whether the truncation overlay is worth attempting on LinkedIn's mobile web view at all, given a content script's more limited ability to reliably detect that composer's DOM, or whether V1 should scope the overlay to desktop LinkedIn only and say so plainly in the listing.
