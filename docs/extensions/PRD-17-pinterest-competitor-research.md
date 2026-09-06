# PRD — Pinterest Competitor Pin Research

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Pinterest
**Backend:** None · **Accounts:** None · **Payments:** None
**Pair:** [Pinterest Opportunity Finder](PRD-16-pinterest-opportunity-finder.md) — that one tests intelligence, this one tests workflow.

---

## 1. One-line proposition

Save competitor pins into a research file with their title, description, domain and your notes — and get it out as a CSV you can plan from.

## 2. The hypothesis

**Will Pinterest marketers pay for a research workflow?** Saving to a secret board is what people do today; it keeps the image and loses everything that matters — the description, the destination, the numbers, and why you saved it. The claim is that structured capture plus export beats a secret board.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Pinterest marketers | Build a competitor reference before a campaign |
| Bloggers | Collect title/description patterns that work |
| Ecommerce sellers | Track how competitors frame the same product |
| Agencies | Assemble a client-ready research deck |

## 4. Scope — V1

### In scope

**Save control** on any pin (grid hover and pin detail):

```
+ Save to research
```

Captures: image thumbnail, title, full description, destination domain and URL, board/creator, saves count where visible, pin URL, date seen, and a note.

The **full description and destination URL** are the two fields a secret board throws away, and they're the reason this product exists — make them prominent in the card.

**Collections.** Defaults, renameable: `Competitors` · `Title patterns` · `Product framing` · `Design ideas`.

**Research panel** (side panel)
- Cards by collection, search across title/description/domain/note
- Group by domain — "who keeps showing up" is a finding in itself
- Edit note, move, delete, click through

**Export**
- **CSV** — the primary artifact: title, description, domain, URL, saves, collection, note. This goes into a planning spreadsheet
- **Markdown** — a readable digest with thumbnails
- **JSON** — full backup, re-importable

**Data ownership:** export all / import / clear all; quota warning at 80%. Thumbnails capped in size, same approach as [PRD-07](PRD-07-instagram-research-saver.md).

### Explicitly out of scope for V1

No account, no backend, no Pinterest API. No saving to Pinterest boards, no posting, no following — no write actions. No pin scheduling. No AI rewriting of titles or descriptions. No cross-platform saving (that's SavePosty). No automated collection of pins the user didn't click to save.

## 5. Relationship to SavePosty

Same boundary as the other savers in this portfolio: local, single-platform, exits through a file. If V1 scoping starts wanting sync, cross-platform capture, or a searchable long-term library, this is SavePosty's Pinterest clipper and belongs there instead. Decide at the end of V1 scoping, not after launch.

## 6. Where the data comes from

Only what Pinterest renders in the user's tab at the moment they click save. No API, no crawling, no automation.

One design consequence worth stating: pin **descriptions are often truncated in the grid**. Capturing from the grid may give a partial description; capturing from the pin detail gives the full one. Either capture from detail only, or record `description truncated` on the card — a research file full of half-descriptions is worse than a smaller complete one.

## 7. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Save → confirmation | < 200 ms, no navigation |
| Panel with 1,000 pins | Opens < 600 ms; search < 150 ms |
| Permissions | `activeTab`, `storage`, `downloads` + `*://*.pinterest.*/*` |
| Storage | Thumbnails capped; warn at 80% quota |
| Privacy | No network requests |

## 8. Edge cases

- Idea pins (multi-page, no single destination URL)
- Pins whose destination is a redirect or an affiliate link (store what's shown, don't resolve it — resolving means a network request)
- Promoted pins
- Pins with no description
- Saving the same pin twice (update, don't duplicate)
- Regional domains
- Deleted pins in an old collection (the card stands; the link may not)
- Storage full mid-save — fail loudly with an export prompt

## 9. Success metrics (30 / 90 day)

| Metric | 30d | 90d |
| :-- | :-- | :-- |
| Installs | 150 | 1,500 |
| 7-day retention | 25% | 35% |
| Users who save ≥ 3 pins | 45% | 60% |
| Users who export | 30% | 45% |
| Median saves per active user / week | 5 | 12 |
| Store rating | ≥ 4.2 | ≥ 4.4 |

Export rate is the proof of value: this product's whole claim is "gets your research out". If people save and never export, a secret board would have done.

## 10. Kill criteria

Under 250 installs at 90 days, **or** export used by under 20% of active users at 90 days.

## 11. Open questions

- **Grid capture or detail-only?** Detail-only guarantees full descriptions but adds a click per pin. Grid capture is fast and lossy. Test both with real users before committing — this single decision defines the product's feel.
- **Is the domain grouping the hidden product?** "These 40 pins come from 6 domains" is a competitive finding. If people use that view most, lead with it.
- **Shared saver module.** This is the third save/collection/export product in the portfolio ([PRD-07](PRD-07-instagram-research-saver.md), [PRD-13](PRD-13-x-conversation-saver.md), here). Build the module once, or pay three times and maintain three bugs.
