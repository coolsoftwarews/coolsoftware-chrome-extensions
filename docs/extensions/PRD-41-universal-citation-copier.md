# PRD — Universal Citation & Link Copier

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Cross-platform (any website)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Press a shortcut, get this page as a Markdown link or a properly formatted APA/MLA/Chicago citation on your clipboard — no typing, no citation manager.

## 2. The hypothesis

The current top charts of the Chrome Web Store are not dominated by ambitious platforms — they're
dominated by tiny, single-purpose, zero-friction utilities: Dark Reader, Volume Master, Video
Download Helper. Each does exactly one small thing perfectly and needs no setup, no account, no
onboarding. You install it once and it quietly saves you a few seconds, many times a day, forever.

"Copy this page as a nicely formatted reference" is exactly that kind of need. It is small, it is
frequent, and it currently has no good zero-setup answer:

- **Manual copy-paste** — select the title, switch tabs, paste, retype the author and date by hand,
  get the punctuation wrong, do it again for the next source. This is the status quo for most people
  writing a paper, a blog post, or a note with a source link.
- **Citation managers (Zotero, Mendeley, EndNote)** — genuinely good tools, but they are a *library*:
  install a desktop app or browser connector, create a collection, manage a database of references
  that accumulates over a research project. For someone who needs *one* citation right now for the
  source they're reading, that's a lot of infrastructure for a ten-second job.

The hypothesis: there is real, frequent demand for the gap between those two — a one-shot,
zero-account, zero-setup "copy this page as a reference, right now" action — and it is exactly the
shape of product that wins in this store's chart: one job, done perfectly, no friction.

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Students / academic writers | Drop a properly punctuated APA/MLA/Chicago citation into a paper while reading the source, without opening a reference manager |
| Bloggers / content writers | Grab a clean Markdown link to a source while drafting, for a "further reading" list or an inline citation |
| Knowledge workers (Obsidian/Notion/Logseq users) | Paste `[Title](URL)` straight into a note instead of a bare pasted link |
| Researchers / analysts | Cite a report or article once, quickly, without starting a project in a citation manager for a single source |
| Anyone forwarding a link | Wants "Article Title — site.com" instead of a raw URL that says nothing out of context |

## 4. Scope — V1

### In scope

A keyboard shortcut and a toolbar popup that copy the current page as:

| Format | Example shape |
| :-- | :-- |
| Markdown link | `[Title of the Page](https://example.com/article)` |
| Plain URL | `https://example.com/article` |
| APA | `García, María. (2024, March 5). Title of the page. Example Site. https://example.com/article` |
| MLA | `García, María. "Title of the Page." Example Site, 5 Mar. 2024, https://example.com/article.` |
| Chicago | `García, María. "Title of the Page." Example Site. March 5, 2024. https://example.com/article.` |

All five are built **purely from on-page `<meta>` tags and standard page metadata already present in
the DOM** — Open Graph `title`/`site_name`, `article:author`, `article:published_time`, the `<title>`
element, `rel="canonical"` — with a defined fallback chain per field so the output always reads as a
correctly punctuated citation, never with a missing field showing as "undefined", an empty bracket,
or a dangling comma (see §5).

**The popup** shows a live preview of all five formats before anything is copied, with one click to
copy any of them. Whichever format was last copied (from either the popup or the shortcut) becomes
the default the keyboard shortcut copies immediately next time — no popup, no click, one shortcut
press and the citation is on the clipboard.

**Feedback:** the toolbar icon badge confirms success or failure of a shortcut-triggered copy (no
popup needed to know it worked); the popup shows an on-copy confirmation via an ARIA live region.

### Out of scope for V1

- **No citation library or manager.** No saving, organizing, tagging, or building a bibliography
  across many pages over time — that is a fundamentally different, heavier product (Zotero's job).
  This is a one-shot "copy this one now" tool; the moment it wants a "my citations" list, it has
  become a different product and should be scoped separately.
- **No PDF or non-HTML page support.** Reads DOM `<meta>` tags on a rendered HTML page only; PDF
  viewers, images, and other non-HTML content are unsupported and say so plainly.
- **No automatic bibliography generation** (a formatted, ordered reference list assembled from
  multiple citations). One page, one citation, one clipboard write.
- **No accounts, sync, cloud, or backend** — see §6 and the portfolio's hard constraints.
- **No editing the citation in-place** before copying (no "fix the author name" text box in V1) — if
  the metadata is wrong, the output is wrong, and that's a known V1 limit (see §10).

## 5. Where the data comes from — read before committing

Every field is read from the DOM already loaded in the tab — zero network calls, zero requests to any
citation-lookup service (Crossref, DOI resolvers, etc. are explicitly not used; that would require a
network call and a different privacy story). **The risk here is not access, it's metadata quality.**
Open Graph tags are inconsistently implemented across the web — many pages have no author tag, a
stale `site_name`, or no publish date at all. The extension has to look correct on a page with great
metadata *and* on a page with almost none.

Fallback chain per field, cheapest/most-authoritative source first:

| Field | Chain | If everything fails |
| :-- | :-- | :-- |
| **Title** | `og:title` → `<title>` → first visible `<h1>` text → | `"Untitled page"` — never empty, never `undefined` |
| **Site name** | `og:site_name` → | hostname (e.g. `example.com`) — always available, so this field is never actually missing |
| **Author** | `meta[property="article:author"]` / `meta[name="author"]` → `link[rel="author"]` (text, then `href`) → a visible byline heuristic (first element matching a class/rel hint like `author`/`byline`, trimmed, length-capped) → | omitted entirely — the citation reformats to start at the title, not with a stray "By ,\_" |
| **Published date** | `meta[property="article:published_time"]` → `meta[name="date"]` → `<time datetime>` → | omitted — APA/MLA drop the date segment cleanly; Chicago substitutes "Accessed {today}" per its own convention, never "n.d." dressed up as a real date |
| **URL** | `link[rel="canonical"]` → `location.href` | always available |

Two rules that follow directly from this table and are non-negotiable at build time:

1. **No missing field may ever produce a visible artifact** — no `undefined`, no `null`, no empty
   `()`, no double space, no leading/trailing stray punctuation (`. .`, `, ,`). Every formatter must
   be tested with every field individually missing (see §"Build verification" in the extension
   README).
2. Metadata is re-read **at copy time**, not cached from page load — see §7 (SPA titles).

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Permissions | `activeTab`, `scripting`, `storage`, `offscreen` (for clipboard access from the keyboard-shortcut path — see note below) + host permission `<all_urls>` (the extension must work on any page the user is reading, not an allowlist) |
| `downloads` permission | **Not requested.** The only output is a clipboard write, never a downloaded file — this is one permission fewer than the portfolio's other clipper-shaped extensions |
| Clipboard permission | Chrome MV3 has **no `clipboardWrite` manifest permission** — this was verified during build (see §"Manifest, verified" in the extension README). Clipboard writes use the standard Web `navigator.clipboard.writeText()` API, gated by document focus/user-activation rules, not by anything declared in `manifest.json` |
| Copy latency | Popup open → preview visible in < 150 ms; shortcut press → clipboard written in < 300 ms |
| Popup size / layout shift | Fixed popup dimensions, no reflow after data loads — a skeleton/loading row while metadata is being read, never a blank flash |
| Accessibility | Keyboard-operable end to end (shortcut needs no mouse at all); popup copy buttons are real `<button>` elements with visible focus states; a copy confirmation is announced via an ARIA live region for screen reader users |
| Privacy | Zero network requests — verifiable in devtools' Network tab and by inspecting the source for `fetch`/`XMLHttpRequest` |
| Storage | `chrome.storage.local` holds exactly one value: the last-used format id |

## 7. Edge cases

- **No title at all** — empty `<title>`, no `og:title`, no `<h1>` → falls back to `"Untitled page"`;
  the citation still reads as a grammatically complete sentence, just with a generic title.
- **Non-English author names and dates** — must not break citation-format punctuation regardless of
  script or language. `article:published_time` is ISO 8601 across locales, so date parsing is
  language-independent. Author-name inversion ("First Last" → "Last, First") is a Latin-space-token
  heuristic; names that don't fit the pattern (no spaces, already comma-formatted, organizational
  names) are left as-is rather than mangled — documented as a known best-effort limit, not silently
  "fixed" incorrectly.
- **SPA pages where the title changes after initial load** — metadata is re-read at the moment of
  copy (popup open, or shortcut press), never cached from the page's initial load. A single-page app
  that has navigated client-side to a new "page" since the tab was opened gets the current title, not
  the stale one.
- **Pages that are themselves citations or bibliographies** (a Wikipedia references list, a Zotero
  export page, a journal's citation-export view) — no special handling. The extension cites *that
  page* as a source like any other; it does not try to parse citations out of the page's content.
- **Unsupported pages** — `chrome://`, extension pages, PDF viewers, `file://` without granted
  access, and the new-tab page all fail extraction cleanly with a plain-language message, never a
  broken/partial citation.

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 300 | 3,000 |
| 7-day retention | 25% | 35% |
| Users who copy ≥ 1 citation | 65% | 75% |
| Copies per active user / week | 4 | 10 |
| Shortcut-copy share of all copies | — | ≥ 40% (signals the "remember last format" loop is working) |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local counters only, no PII, no network):** copy by format, copy via popup vs.
via shortcut, format-preview opened, extraction failure (unsupported page).

Format popularity is the signal worth watching: if Markdown link dominates, the audience skews
Obsidian/notes; if APA/MLA/Chicago dominate, it skews academic — either result should shape the Web
Store listing copy and keywords, not the feature set.

## 9. Kill criteria

Under 400 installs at 90 days, **or** copy rate under 40% of installs → stop investing. Given the
entire product is a single action with no setup, a low copy rate almost certainly means the first-run
experience (the popup, the icon, the shortcut hint) failed to make the action obvious — not that
demand doesn't exist.

## 10. Open questions

- **Author-name inversion quality.** The "First Last" → "Last, First" heuristic is best-effort and
  will occasionally mis-invert an organizational byline ("Associated Press Staff") or a name that
  doesn't follow Western given-name/family-name order. Worth watching reviews for complaints before
  investing in a more elaborate name parser — most of the value here is the punctuation and structure
  being right, not perfect name parsing on the long tail.
- **A fourth "just the title" copy mode?** Some users may only want the bare page title, no link and
  no citation formatting (e.g., for a manual reference list). Not in V1; add only if requested.
- **In-popup correction before copying.** If metadata quality turns out to be the actual limiter (per
  §5's risk), a lightweight "edit before copy" text field in the popup is the natural V2 — deliberately
  deferred so V1 stays a one-screen, zero-typing tool.
- **Keyboard shortcut default key.** `Ctrl+Shift+U` (`Cmd+Shift+U` on macOS) is a placeholder pending
  a check against Chrome's other reserved/commonly-used extension shortcuts before the listing ships.
