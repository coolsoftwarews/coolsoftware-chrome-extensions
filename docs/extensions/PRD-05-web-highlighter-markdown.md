# PRD — Web Highlighter & Markdown Export

**Status:** Draft for build
**Build order:** #3 (slots ahead of Pro Filters — see §2)
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Backend:** None
**Accounts:** None

---

## 1. One-line proposition

Highlight what matters on any page, add your notes, export the whole thing as clean Markdown, PDF, TXT or HTML.

## 2. Where this sits in the portfolio

This is a strong candidate and I'd slot it **third**, ahead of [YouTube Pro Filters](PRD-03-youtube-pro-filters.md), for three reasons:

- It shares a spine with [Transcript Export](PRD-01-youtube-transcript-export.md) — content in, clean document out, four export formats. The Markdown/PDF/TXT export layer built for #1 is reused almost verbatim here. Build #1, then #5 costs materially less than it would standalone.
- It is not platform-locked. The two YouTube extensions live or die by YouTube's DOM; this one works everywhere and has no single point of failure.
- The competitive field (Weava, Liner, Glasp, MarkDownload) is crowded but every incumbent pushes an account and a cloud library. A genuinely local, no-signup version is a real position, not a thinner clone.

Estimated build: 1–1.5 weeks on top of #1's export layer.

## 3. Relationship to SavePosty — read this before building

SavePosty is a **cloud library with an account**: save, organize, search, sync, RAG over your collection. This extension is the opposite product on purpose:

| | SavePosty | This extension |
| :-- | :-- | :-- |
| Account | Required | None, ever |
| Storage | Server | `chrome.storage.local` only |
| Job | Build a searchable library over time | Get *this page* into a document, now |
| Exit | Search and revisit in the app | Export a file and leave |

If that boundary isn't real — if this ends up wanting sync, search across pages, and a library view — then it isn't a separate product, it's SavePosty's clipper and should ship inside SavePosty instead. **Revisit this question at the end of V1 scoping, not after launch.**

Reusable from SavePosty: content extraction and any existing HTML→Markdown work. Reusable from [PRD-01](PRD-01-youtube-transcript-export.md): the entire export/download layer.

## 4. Target user

| Segment | Job |
| :-- | :-- |
| Researchers / students | Pull quotes and sources out of a dozen articles into one note |
| Writers | Collect evidence while drafting |
| Knowledge workers (Obsidian/Notion/Logseq users) | Get web content into their vault as clean Markdown, not soup |
| AI users | Turn a page into clean text to paste into a model |
| Analysts / consultants | Read a report, mark the three paragraphs that matter, export |

The Obsidian/Logseq crowd is the sharpest wedge: they already want Markdown specifically, they're vocal, and they distribute tools to each other.

## 5. Scope — V1

### The two things this does

**A. Read & mark** — highlight text on a live page, attach a note to a highlight, and have those marks still be there tomorrow.

**B. Export** — turn the page (or just your marks) into a clean document in four formats.

Both matter. A highlighter with no export is a toy; an exporter with no highlighting is a hundred existing tools.

### In scope

**Highlighting**
- Select text → floating toolbar appears → pick a colour
- 4 colours, fixed (yellow / green / blue / pink). Not configurable in V1.
- Click an existing highlight → remove it, change colour, or attach a note
- Notes are plain text, attached to a highlight
- Highlights persist per URL and reappear on revisit
- A page-level note, not attached to any selection ("why I saved this")

**The panel** (side panel, opened from the toolbar icon)
- List of this page's highlights in document order, with their notes
- Click a highlight in the list → scroll the page to it
- Delete individual highlights
- Page metadata shown: title, URL, author, site, date captured

**Export** — four formats, two scopes

Scope selector: `Highlights only` / `Full page (cleaned)`

| Format | Output |
| :-- | :-- |
| Markdown | Front-matter block (title, URL, author, date), then content. Highlights as `>` blockquotes with notes beneath |
| Clean HTML | Reader-view HTML, self-contained, no scripts/ads/trackers, highlights preserved as `<mark>` |
| PDF | Rendered from the clean HTML |
| TXT | Plain text, no formatting |

Plus `Copy to clipboard` as Markdown — likely the single most-used action, since it feeds directly into Obsidian/Notion/an AI chat.

**Options (small, one row)**
- Include page metadata header ☐/☑
- Include notes alongside highlights ☐/☑
- Include source URL per highlight ☐/☑

**Filename convention**
`{site} - {page title}.{ext}` (sanitized, truncated to 120 chars)

**Data ownership**
- `Export all data` → one JSON file of every highlight and note across all pages
- `Import` the same file back
- `Clear all data`

Non-negotiable. It's the credibility cost of asking someone to store their research in local browser storage.

### Explicitly out of scope for V1

No accounts, no sync, no cloud, no backend. No AI or summarization. No cross-page search or library/dashboard view (that's SavePosty — see §3). No tags or folders. No sharing or public highlight pages. No PDF-file annotation (see §11). No direct Notion/Obsidian/Readwise integrations — export and clipboard cover it. No collaboration. No mobile.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Highlight applied → visible | < 100 ms, no page jump or reflow |
| Highlights restored on page load | < 500 ms, after content settles |
| Export generated | < 2 s for a long article |
| Permissions | `activeTab`, `scripting`, `storage`, `downloads`. `<all_urls>` host permission is unavoidable for a universal highlighter — say so plainly in the listing and pair it with the never-leaves-your-device claim |
| Page impact | Zero layout shift. Never break the host page's own JS or styling |
| Storage | Warn at 80% of `chrome.storage.local` quota, with a one-click export |
| Privacy | No network requests of any kind. This should be verifiable by a suspicious user in devtools — it is the whole positioning |

## 7. Technical risk — read before committing

The export layer is straightforward (Readability-style extraction → Turndown-style HTML→Markdown → print-to-PDF). **The hard part is highlight persistence**, and it decides whether this product feels solid or broken.

The problem: you're anchoring a mark to a range of text in a DOM that will not be identical next visit. Naive approaches — XPath, CSS selector + offset, DOM node index — break on ads reshuffling, A/B tests, lazy content, personalization, and any site rebuild.

Use **text-quote anchoring** (the W3C Web Annotation model): store the exact quoted text plus ~32 characters of prefix and suffix, and re-find it on load by text search with fuzzy fallback. Fall back to a position hint only as a tiebreaker when the quote appears more than once.

Requirements that follow from this:
- A highlight that can't be re-anchored is shown in the panel as "couldn't locate on page" **with its text and note intact** — never silently dropped. Losing someone's note is the one unrecoverable failure in this product.
- SPA and infinite-scroll pages: re-attempt anchoring on DOM mutation, not just once at load.
- Same page, different URL forms (tracking params, `#fragment`, `?utm_*`) must resolve to the same storage key — normalize the URL.

**Spike first, 1–2 days:** build anchoring alone and test restoration across ~20 real sites (news, docs, blogs, an SPA, a paywalled article, a site with heavy ads). Target: >90% restoration on revisit. Do not start the export layer until the anchoring number is known — if it comes in low, the product changes shape (it becomes an exporter with session-only highlights, which is a weaker but still shippable product).

## 8. Edge cases to handle

- Selection spanning multiple elements, or crossing block boundaries
- Selection inside a `<table>`, `<pre>`/code block, or list
- Text inside same-origin iframes (cross-origin: document the limit, don't half-support)
- Overlapping / nested highlights
- Dynamically loaded content appearing after highlights are restored
- Sites with aggressive CSP that block injected styles
- Dark-mode sites — highlight colours must stay legible on dark backgrounds
- Pages that are already Markdown-ish (GitHub, docs sites) — extraction shouldn't mangle code blocks
- Very long pages (10K+ words) → panel list must stay responsive
- Reader-mode extraction failing on an app-like page → fall back to full-body cleanup and say so
- Local files (`file://`) and `chrome://` pages → clear unsupported message

## 9. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| 7-day retention | 30% | 40% |
| Users who create ≥ 1 highlight | 60% | 70% |
| Users who export or copy ≥ 1 time | 40% | 55% |
| Highlights per active user / week | 5 | 12 |
| Store rating | ≥ 4.3 | ≥ 4.5 |

Retention is the metric that matters — this is a habit tool, not a one-shot utility.

**Instrumented events (local counters only, no PII, no network):** highlight created, note attached, highlight re-anchor success/failure rate, panel opened, export by format, export by scope, copy-as-markdown used, data exported.

The re-anchor failure rate is the health metric to watch above all others. If it climbs, the product is quietly rotting.

Signals worth acting on:
- Copy-as-Markdown dominates exports → the product is a *pipe into someone's notes app*; V2 is integrations, not more formats.
- `Full page` scope dominates `Highlights only` → people want a clipper, not a highlighter; simplify toward one-click page capture.
- High install, low highlight creation → the first-run experience failed to explain the product.

## 10. Monetization posture

None in V1. The honest paid surface here is sync across devices and a searchable library — which is precisely what §3 assigns to SavePosty. So the most likely good outcome isn't a subscription on this extension; it's that this extension becomes a free top-of-funnel that converts a slice of users into SavePosty accounts, **without** ever degrading the local-only promise for those who don't want one.

Decide that funnel question deliberately, after V1 has numbers. Bolting an upsell onto a tool sold as "no account, ever" will cost the reviews that make it work.

## 11. Kill criteria

Under 400 installs at 90 days, **or** highlight-creation rate under 35% of installs → stop investing. A low creation rate means people install it and never understand it, which is a positioning failure that more features won't fix.

## 12. Open questions

- **PDF annotation.** Highlighting PDFs in the browser is a genuinely different technical problem (canvas text layer, not DOM) and a common expectation. Out of scope for V1, but it is the most likely V2 feature and worth checking demand in reviews.
- **First-run experience.** This product needs to teach itself in one screen: select text on the install-success page and watch it highlight. Worth building properly — §11's kill criterion is mostly a first-run problem.
- **`<all_urls>` and store review.** Broad host permission raises both review friction and install hesitancy. Investigate whether `activeTab` + explicit per-site opt-in is workable; it's slower for the user but a much easier listing to trust.
- **Naming.** "Web Highlighter & Markdown Export" is descriptive and search-friendly, but sits in a crowded keyword space. Worth 30 minutes against the Web Store search results before the listing is written.
