# PRD — Universal Sticky Notes

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Cross-platform (any website)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Drop a sticky note anywhere on any page, come back and it's still there.

## 2. The hypothesis

"Note anywhere on a page" tools are an evergreen, long-running category of browser extension with a
consistently large install base historically, because the job is dead simple and universally
relatable: leave yourself a reminder tied to a specific page you'll come back to. Everyone who has
ever bookmarked something with a mental "I'll remember why" and then didn't, is the market.

The hypothesis: keeping this deliberately simple — no accounts, no sync, no rich-text editor, no
folders-within-folders — out-competes heavier "web annotation" tools for the pure sticky-note use
case, the same way this portfolio's own [WebHighlighter](../../extensions/WebHighlighter)
deliberately stays out of this simpler note's territory. WebHighlighter's job is marking up existing
text and exporting a document; this product's job is dropping a freestanding visual reminder
anywhere on a page, independent of any text selection at all. A user reaching for "highlight this
sentence and export my research" wants WebHighlighter. A user reaching for "stick a note on this page
saying come back and finish the checkout" wants this.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Anyone mid-task on a form, dashboard or admin panel | "Remember to fix this field" pinned right next to the field |
| Researchers browsing many tabs/pages over days | A visual marker on where a thought happened, without breaking flow to write it elsewhere |
| Freelancers / contractors reviewing client sites | Leave visible notes for themselves before a call, without touching the client's page |
| QA testers / bug hunters | Pin a note at the exact spot a bug was noticed, come back to file it properly |
| Anyone who currently uses browser bookmarks as a todo list | A lighter, more specific alternative — the note, not just the URL |

The common thread: the job is spatial ("here, on this page") not archival. If the user wanted a
searchable knowledge base they'd reach for a different tool — this one is closer to a real sticky
note than a notes app.

## 4. Scope — V1

### In scope

- A toolbar action and a keyboard shortcut both drop a new note onto the current page, at a default
  position (near where the toolbar/shortcut was triggered, falling back to a sensible on-screen
  default).
- Each note is a small, **draggable, resizable, colored box** containing plain text. Drag by its
  header; resize from its corner handle, same as a native window.
- A color picker offers a handful of preset colors (yellow, pink, blue, green, purple — fixed, not a
  full picker, matching WebHighlighter's "4 fixed colors, not configurable" precedent for keeping V1
  narrow).
- Notes persist **per-URL**, keyed by the same normalized-URL approach as WebHighlighter's `url.ts`
  (strip tracking params and fragment, lowercase host, drop `www.`, sort remaining query params) so
  the same article reached two different ways shares its notes instead of losing them.
- Notes reappear in the same **relative position** on revisit. Position is stored as a **percentage
  of the viewport/document**, not raw pixels, specifically so it survives reasonable layout shifts —
  see §5.
- A **side panel** lists every note across every page the user has left one on: searchable by note
  text or page title/URL, click a result to jump to that page (opens/activates the tab and scrolls
  toward the note's stored position).
- **Export all notes as Markdown** — one file, grouped by page, each note as a line with its color,
  text and source URL.
- **JSON export**, **JSON import (merge, not replace)**, and **clear all** — the same data-ownership
  triad as WebHighlighter, non-negotiable per the portfolio README.

### Out of scope for V1

- No rich text or images inside a note — plain text only.
- No real-time collaboration or sharing a note with another person.
- No cloud sync across devices.
- No text-anchoring to page content (that is WebHighlighter's job, not this one — a sticky note is
  independent of any selection, by design).
- No folders, tags, or nested organization beyond the flat searchable list in the side panel.
- No reminders/alerts/notifications tied to notes (foreground-only, per the portfolio's hard
  constraints — no background polling).

## 5. Where the data comes from — read before committing

Nothing is read from the host page beyond its normalized URL, used purely as the storage key.
Content is never scraped, and the note overlay is the extension's own DOM (a shadow root), never a
modification of the page's actual markup — same read-only posture as WebHighlighter and the
portfolio's hard constraints.

The one real technical risk is **position drift**: a page's layout can change between visits (ads
loading, an A/B test, a responsive breakpoint the user didn't hit last time, content reflowing as a
site is redesigned), and a note anchored to a fixed pixel coordinate would end up somewhere
nonsensical — floating over unrelated content, or off the visible page entirely.

**Mitigation:** store position as a **percentage of the document's scrollable width/height at save
time** (`left%`, `top%` relative to `document.documentElement.scrollWidth/scrollHeight`), not raw
pixels. On load, the note is placed at that same percentage of the *current* document's dimensions.
This keeps the note "in the same neighborhood" through ordinary reflow (a banner appearing, a
sidebar resizing) far better than fixed pixels would, without needing any content-anchoring logic at
all.

**Accepted limitation, stated plainly in the product itself:** a dramatic layout change (a full site
redesign, a page that's now a completely different length) can still misplace an old note relative
to the content the user cares about. That is acceptable — the position is a best-effort convenience,
not a promise. What is *not* acceptable is ever losing the note's **text**. A note is never deleted
or silently dropped because its position looks wrong; worst case it reappears in an odd spot, fully
readable and draggable back to wherever makes sense. This mirrors WebHighlighter's own non-negotiable
(§7 of PRD-05): losing a user's note is the one unrecoverable failure in this class of product.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Note dropped → visible and draggable | < 100 ms, no page jank or reflow of host content |
| Notes restored on page load | < 500 ms after content settles |
| Dragging / resizing | 60fps-feeling, no visible lag under normal note counts (<50/page) |
| Permissions | `activeTab`, `scripting`, `storage`, `downloads`, `sidePanel`. `<all_urls>` host permission is unavoidable for a universal sticky-note tool — same justification as WebHighlighter: say so plainly in the listing, paired with the never-leaves-your-device claim |
| Page impact | Zero layout shift on the host page. The note overlay lives in a shadow root and never touches the page's own DOM or styles |
| Storage | Warn at 80% of `chrome.storage.local` quota, with a one-click export, matching WebHighlighter's pattern |
| Privacy | No network requests of any kind, ever — verifiable in devtools |
| Accessibility | Notes are keyboard-movable (arrow keys with focus) and keyboard-deletable, not drag-only; color picker and side-panel list are fully keyboard navigable |

## 7. Edge cases

- **A note dropped or dragged near the very edge of the viewport** must stay reachable — it can
  never end up permanently off-screen (drag handle always keeps at least a corner of the note
  clamped within the visible/document bounds, and the side panel's "jump to page" scrolls it into
  view regardless of its stored percentage).
- **Many notes on one page** creates visual clutter. Provide a "hide all notes on this page" toggle
  (per-page, persisted) so a heavily-annotated page can be decluttered without deleting anything.
- **A page URL with tracking parameters that change between visits** (`?utm_source=...`, session
  IDs, etc.) must resolve to the same storage key — reuse WebHighlighter's normalization logic
  pattern directly rather than reinventing it.
- **Notes on `chrome://` pages, the Chrome Web Store, or other extension pages** — content scripts
  cannot run there. The toolbar action and keyboard shortcut must gracefully do nothing (or show a
  brief "can't add a note here" state), never error.
- **SPA navigation** (URL changes without a full page load) must be detected so the note set swaps
  to match the new normalized URL, mirroring WebHighlighter's `watchUrl()` polling approach.
- **A note resized down to near-zero, or dragged fully behind other page content via z-index quirks
  on exotic sites** — the shadow-root overlay sits at `z-index: 2147483647` so it always renders
  above host content, and a minimum note size (e.g. 120×80px) prevents a note from being shrunk into
  unusability.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 30% | 40% |
| Users who create ≥ 1 note | 65% | 75% |
| Notes per active user / week | 3 | 8 |
| Users who open the side panel ≥ 1 time | 40% | 55% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local counters only, no PII, no network):** note created, note deleted, note
recolored, note dragged, panel opened, panel search used, page jumped-to from panel, export used,
import used, data cleared. The note-creation rate is the health metric — this is meant to be a
one-click reflex, and a low creation rate signals the first-run experience failed to teach the
product.

## 9. Kill criteria

Under 400 installs at 90 days, **or** note-creation rate under 40% of installs → stop investing. This
category has essentially no learning curve, so a low creation rate is a positioning or first-run
failure, not a product-complexity one — more features will not fix it.

## 10. Open questions

- **Default note position on toolbar click (vs. keyboard shortcut).** Toolbar click has no
  "location" to anchor to the way a text selection would for WebHighlighter — worth deciding between
  viewport-center, cursor-last-seen-position, or a cascading offset from the most recently placed
  note on that page.
- **`<all_urls>` and store review friction.** Same open question as WebHighlighter's PRD — worth
  revisiting once one of the two `<all_urls>` extensions in this portfolio has real store-review
  data.
- **Naming.** "Universal Sticky Notes" is plain and searchable but sits in a crowded keyword field
  (Sticky Notes, Note Anywhere, Fireshot-adjacent tools already occupy this space). Worth a quick
  pass against live Web Store search before publishing, same as PRD-05 §12 flags for its own name.
- **Hide-all-on-this-page toggle default.** Whether newly created notes should respect an
  already-active "hidden" state on that page (so a new note doesn't suddenly appear when the user
  thought notes were hidden) needs a decision before build — current lean is yes, respect it.
