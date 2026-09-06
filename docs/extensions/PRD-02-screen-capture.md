# PRD — Screen Capture

**Status:** Draft for build (repackage of existing product)
**Build order:** #2
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Backend:** None in V1 (existing `api/` and `SPA/` — a separate, private project; not part of this repo — stay dark)
**Accounts:** None in V1

---

## 1. One-line proposition

Capture → annotate → share. A full-page screenshot tool that stays out of your way.

## 2. Why this one second

It is already built. The work here is **subtraction and packaging**, not development. The existing product is feature-rich to the point of being hard to explain — the release job is to pick the 20% that defines the product, hide or remove the rest, and get a listing live. Estimated effort: 3–5 days, mostly store assets, onboarding copy and cutting scope.

Reference: `specs.md`, `extension/` — the pre-trim source in the private project this was repackaged from, not part of this repo.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Marketers | Grab a competitor page or ad for a deck |
| QA / support | Capture a bug with an annotation and hand it over |
| Founders / PMs | Screenshot a flow, circle the problem, paste in Slack |
| Designers | Full-page reference captures |

Narrower than transcript export, but materially higher intent — this is the category where people already pay (GoFullPage, Awesome Screenshot, Nimbus).

## 4. Scope — V1

### In scope

**Capture modes**
- Full page (the headline feature)
- Visible area
- Selected region

**Result experience**
- Capture opens a results tab with a preview
- `Download PNG` / `Download JPEG` / `Download PDF`
- `Copy to clipboard`

**Editor — four tools only**
- Crop
- Rectangle highlight / arrow
- Blur box (privacy — this is the one that wins support/QA users)
- Text (one font, three sizes)

**UX**
- Keyboard shortcut (`Alt+Shift+P`) for full page
- Works on complex pages: sticky headers, lazy-loaded images, inner scroll containers
- Capture progress indicator for long pages

### Explicitly out of scope for V1

Video/GIF recording, cloud upload and share links, accounts, teams, OCR, scheduled captures, integrations (Slack/Jira/Notion), automation hooks. **Anything currently built that falls in this list gets feature-flagged off, not shipped and explained.**

### The subtraction pass (do this first)

1. Inventory every feature currently in `extension/src` (the private pre-trim source).
2. Sort into KEEP (list above) / HIDE (flag off) / CUT (delete).
3. Anything in HIDE must not appear in UI, permissions, or the store description.
4. Re-audit the manifest afterwards — every permission that no longer has a KEEP feature behind it gets removed. Permission count is a conversion lever on the Web Store.

## 5. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Full-page capture, typical article | < 3 s |
| Full-page capture, 20,000px page | < 12 s, with progress feedback |
| Permissions | `activeTab`, `scripting`, `downloads`, `storage`. No broad `<all_urls>` if avoidable |
| Failure mode | Sticky-header artifacts must be de-duplicated, not shipped as visible seams |
| Privacy stance | Stated plainly in the listing: captures never leave the device in V1 |

## 6. Edge cases to handle

- Sticky/fixed headers repeating down a full-page stitch
- Lazy-loaded images below the fold (scroll-and-settle before each frame)
- Inner scrollable containers (capture viewport, not the phantom full height)
- Cross-origin iframes (document the limitation rather than half-working)
- `chrome://`, Web Store and PDF viewer pages → clear "can't capture this page" message
- Pages taller than the canvas limit (~32,767px) → chunk or cap with a warning
- Retina / devicePixelRatio scaling

## 7. Positioning

The market leader is GoFullPage. Do not out-feature it. Differentiate on **one** axis and say it in the first line of the listing. Recommended axis: *privacy + no account, ever* — no upload, no sign-in, no watermark. That is a real and defensible difference against tools that push cloud accounts.

Listing title: `Screen Capture — Full Page Screenshot, Annotate, Blur`

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 200 | 2,000 |
| 7-day retention | 25% | 35% |
| Captures per active user / week | 3 | 6 |
| Annotation usage | 20% of captures | 30% of captures |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local only):** capture by mode, editor tool used, export by format, copy used, capture failure by reason.

If annotation usage is near zero → the product is a *capture* tool and the editor should be de-emphasized, not expanded.

## 9. Monetization posture

The most credible paid path in this category is cloud share links and team libraries — which is exactly what V1 excludes. Revisit only above ~5,000 active users, and note it would reverse the "never leaves your device" positioning, so it would need to be an opt-in Pro tier rather than a change to the free product.

## 10. Kill criteria

Under 400 installs at 90 days → leave published (zero maintenance cost) but stop investing.

## 11. Open questions

- Is the existing editor good enough to ship as-is, or does it need a visual pass? Decide by opening it cold and trying to annotate a bug in 15 seconds.
- Firefox/Edge builds: defer until Chrome numbers exist.
