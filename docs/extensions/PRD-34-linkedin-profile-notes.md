# PRD — LinkedIn Profile Notes (Local CRM-lite)

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** LinkedIn
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Remember who you're talking to on LinkedIn and why — a small, private note on any profile, with no CRM, no account, and no cloud.

## 2. The hypothesis

**Will people take a zero-account local tool over yet another SaaS capture funnel?** Look at the top-ranking LinkedIn extensions today: folk, Lusha, Dux-Soup, Lemlist, the Salesforce and HubSpot LinkedIn connectors, LeadLeaper. Every one of them requires signing up for an external CRM or sales platform before the extension is worth installing — the extension itself is not the product, it's the capture funnel into someone else's paid subscription. That's a reasonable business for them and a real cost for the user: an account to manage, a monthly fee eventually, and their relationship notes locked inside a platform they didn't choose.

The hypothesis is narrower and cheaper to test: a meaningful segment of people who just want **"remind me who this person is and why I care"** — recruiters doing light sourcing, job seekers tracking who they've messaged, freelancers keeping tabs on client contacts, or anyone doing ordinary networking — will prefer a tool with no sign-up, no cloud, and no subscription, even knowing it can't sync across devices or enrich a contact with anything beyond what's already on the screen. The trade being tested is *convenience of zero setup* against *durability of a real CRM* — and the bet is that for casual, low-volume relationship memory, the first one wins.

This product deliberately does **not** compete with folk/Lusha/Dux-Soup on their own ground (pipeline, sequencing, enrichment, team sharing). It competes on being the thing you'd actually install for a problem those tools are overkill for.

## 3. Target user

| Segment | Job | How this differs from the platform's other two LinkedIn extensions |
| :-- | :-- | :-- |
| Recruiters doing light sourcing | Remember which candidates they've already looked at and their read on them | [LinkedInCreatorWatchlist](../../extensions/LinkedInCreatorWatchlist) tracks specific creators' **posts** over time — it's a content feed, not a memory of people. This product has no concept of posts at all. |
| Job seekers | Track who they've reached out to during a search, and the context of that outreach | [LinkedInLeadFinder](../../extensions/LinkedInLeadFinder) only surfaces people who **engaged on a specific post** (commenters), and only from posts the user chose to collect from. This product works on *any* profile the user visits, whether or not that person has ever posted or commented on anything. |
| Freelancers / consultants | Keep light notes on client and prospect contacts without opening a CRM for a handful of relationships | Neither sibling stores a note keyed to an individual profile visited outside of their own collection flow (watching a creator, collecting from a post's thread). |
| Casual networkers | Jog their memory before a second conversation with someone they met once | This product's only trigger is "I visited this profile" — no watch action, no post collection, no engagement signal required. |

The one-sentence differentiator: **Watchlist is about their posts, Lead Finder is about their comments, Profile Notes is about your memory of them** — it works on every profile, including people who have never posted, commented, or done anything except exist on LinkedIn.

## 4. Scope — V1

### In scope

**The "+ Note" affordance.** Visiting any LinkedIn profile shows a small, unobtrusive control near the name:

```
+ Note   ·   last noted: 3 days ago
```

Clicking it opens a lightweight local note: free text, plus an optional one-line tag chosen from a short user-editable list (starter set: `met at conf`, `candidate`, `follow up`, `client`, `prospect`) or typed fresh. Saving is automatic on blur — no separate save button, no modal that blocks the page.

**Revisit indicator, no panel required.** Returning to a profile that already has a note shows the existing note text and a small relative-time indicator (`last noted: 3 days ago`) right on the page, so the extension is useful the moment you land on a profile — the side panel is for browsing the whole library, not a requirement for the core loop to pay off.

**Side panel — the library.** All noted profiles in one place:
- Searchable (name, headline, tag, note text)
- Sortable by recency (last noted) or alphabetically
- Filter by tag
- Click through to open the profile in a new tab
- Edit or delete a note from the list, without revisiting the profile

**Export:** CSV (name, headline, tag, note, profile URL, first noted, last noted) and JSON (full backup shape).

**Data ownership:** JSON export / JSON import (merge by profile key, never overwrite silently) / clear all; quota warning at 80% — matching every other product in this portfolio.

### Explicitly out of scope for V1 — and permanently for the items marked so

- **No email or phone extraction, ever (permanent).** This is the exact compliance-risk territory every competitor in §2 operates in — resolving a person to contact details is a different legal category (data broker territory), and it's the line that keeps this a note-taking tool rather than a lead-enrichment tool. Not a V1 gap; not a roadmap item.
- **No bulk profile visiting or scraping (permanent).** The extension never opens, queues, or iterates over profiles on the user's behalf. A note only ever gets created because the user is looking at that profile right now.
- **No CRM sync or integration (permanent for V1's premise — a paid "export to X" could be a fair V2 question, but native sync defeats the local-only proposition being tested).**
- **No connection-request automation, no auto-follow, no auto-message (permanent, matching every LinkedIn sibling in this portfolio).**
- No reminders, alerts, or notifications ("follow up in 3 days") — that needs a background scheduler this product doesn't have. If users ask for it, that's a signal, not a feature to sneak in.
- No tagging taxonomy beyond a single one-line tag — no multi-tag, no nested categories.
- No profile photo storage — an avatar URL may be shown for identification in the panel, exactly as the sibling extensions do, but nothing is downloaded or persisted as an image.

## 5. Where the data comes from — read before committing

This product reads **only** what's already rendered on the profile page the user is looking at: their displayed name, headline, and the page's own URL (to derive the vanity slug). That's it. Nothing about the profile beyond what's needed to (a) identify which profile a note belongs to and (b) show the user's own note back to them in a readable way is stored.

This is a materially smaller read surface than either LinkedIn sibling: `LinkedInCreatorWatchlist` reads post text, reaction/comment/repost counts, and post dates; `LinkedInLeadFinder` reads comment text and comment reaction counts. This product reads none of that — no engagement data, no post content, ever. The only content the user contributes is their own note, typed by hand.

Two rules carried over from both LinkedIn siblings, because they apply just as much here:

1. **Read-only, foreground-only.** The extension reads what's on the user's screen when they're on it. It never issues a request LinkedIn didn't already make, and never acts as the user.
2. **No volume.** Nothing here is faster than the user typing a note. If a feature would only be useful at scale (bulk import of contacts, bulk tagging), it doesn't belong in this product.

**Spike first, half a day:** confirm a profile's displayed name and headline are reliably readable on page load across a personal profile, a profile with no headline set, and a profile viewed in "you're viewing anonymously" mode (§7) — this is a much smaller spike than either sibling's because there is no engagement data to validate.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| "+ Note" control appears | < 300 ms after the profile page renders; no layout shift |
| Existing-note indicator on revisit | Shown on first paint of the control, no extra network or storage round-trip beyond one local read |
| Panel with 500 noted profiles | Opens < 500 ms; search < 150 ms |
| Permissions | `activeTab`, `storage`, `downloads`, `sidePanel` + host permission `*://*.linkedin.com/*` |
| Privacy | No network requests of any kind — verifiable in devtools' Network tab and by grepping the source for `fetch`/`XMLHttpRequest`/`sendBeacon` |
| Safety | Zero write actions against LinkedIn, enforced by having no such code path |

## 7. Edge cases

- **A profile's vanity URL changing over time.** The vanity slug is the primary storage key, but LinkedIn users do change it. A stale key means a returning visit looks like a brand-new profile with no note history. Mitigation: keep a fallback match on normalized name + headline, and if a profile has no note under its current URL but a close name+headline match exists elsewhere in storage, surface a soft prompt ("this looks like someone you've noted before as a different URL — merge?") rather than silently losing the note or silently merging.
- **The same person appearing under a company page vs. a personal profile.** These are different entity types with different URLs; the extension only ever operates on personal profile pages (`/in/...`), never on company pages, so this is a non-issue by scope rather than a case to detect at runtime.
- **Very large note libraries (hundreds of contacts) and search performance.** Search must stay responsive at the panel target above; if storage volume ever threatens that, paginate the list rather than degrading search input latency.
- **LinkedIn's "you're viewing anonymously" mode.** This mode hides the viewer's identity from the person being viewed — it does not hide the profile's own name/headline/URL from the page, so the note feature is unaffected and must not be blocked by it.
- **A profile with a blank or missing headline.** The note still saves keyed by URL; the panel shows the name alone rather than a broken layout.
- **Note text containing characters that break CSV or JSON** (quotes, commas, newlines) — export must escape correctly, matching the CSV-quoting convention already used by the sibling extensions.
- **LinkedIn DOM rewrites** — name/headline selectors may change; extraction must degrade to "show the control without a label" rather than throwing, matching both siblings' error-handling posture.

## 8. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 30% | 40% |
| Users with ≥ 5 notes | 35% | 50% |
| Panel opened ≥ 3 times | 30% | 40% |
| Export used ≥ once | 15% | 25% |
| Store rating | ≥ 4.2 | ≥ 4.4 |

## 9. Kill criteria

Under 250 installs at 90 days, **or** fewer than 20% of installs reaching 5 saved notes (a proxy for "this actually became a habit, not a one-time curiosity click"). Because the core loop requires no distribution-dependent trigger (unlike Watchlist's browsing-driven collection or Lead Finder's per-post collection), low adoption of the habit itself — not just low installs — is the clearer failure signal here.

## 10. Open questions

- **Is the on-page indicator enough, or does the panel need to be the primary surface?** The bet in §4 is that the on-page revisit indicator is what makes this "genuinely useful without opening a panel" — if usage data shows the panel is opened far more than the on-page control is used, that's a signal the product should lean panel-first (more like a lightweight CRM view) rather than in-context.
- **Does the fallback name+headline match (§7) create false merges often enough to be worse than a clean miss?** Worth instrumenting locally (a counter for "fallback match suggested" vs. "fallback match accepted") before deciding whether to keep, tighten, or drop it.
- **Where's the line before this becomes Watchlist or Lead Finder's job?** If users start asking for "show me this person's recent posts" inside a note, that's scope creep into a sibling's territory, not a feature to add here — the product's boundary is deliberately "your memory of them," not "their activity."
