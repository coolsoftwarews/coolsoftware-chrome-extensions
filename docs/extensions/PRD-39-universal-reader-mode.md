# PRD — Universal Reader Mode & Export

**Status:** Draft for build
**Owner:** Gabriel
**Date:** 2026-09-02
**Type:** Chrome extension (MV3), standalone Web Store listing
**Platform:** Cross-platform (any website)
**Backend:** None · **Accounts:** None · **Payments:** None

---

## 1. One-line proposition

Strip any article down to a clean, distraction-free reading view — then keep it, as Markdown, PDF or TXT, instead of just reading it more comfortably in the moment.

## 2. The hypothesis

Reader-mode tools have a long, well-established track record of real demand: Safari and Firefox both ship a built-in reader view, Pocket-style read-later tools have millions of users, and Mercury Reader (before it was discontinued) had a devoted following purely as a bookmarklet. Nobody has to be convinced people want a cleaner way to read the web — that part isn't the hypothesis.

The hypothesis here is narrower and specific: pairing a clean reading view with **local export** (Markdown / PDF / TXT, reusing this portfolio's existing dependency-free PDF writer — see [PRD-05](PRD-05-web-highlighter-markdown.md)) serves a distinct job from either incumbent shape.

- The browser's own built-in reader mode (Safari, Firefox, Edge) gives you the clean view but **no export** — close the tab and it's gone.
- Pocket-style save-for-later tools give you persistence, but that almost always means **an account and cloud sync** — the read-it-later queue is the product, not the reading experience.

This extension's bet is that "I want to actually *keep* this article, as a real file, on my machine, right now, without signing up for anything" is a real and underserved job, sitting in the gap between those two shapes. If it turns out nobody wants a file — if what people actually want is the queue-and-sync experience — the hypothesis is wrong and this product should not chase it (see §9).

## 3. Target user

| Segment | Job |
| :-- | :-- |
| Researchers / students | Turn a long article into a clean Markdown or PDF file to read offline or file into notes |
| Writers / knowledge workers | Get a page into their vault (Obsidian, Notion, Logseq) as one clean document, not a screenshot or a messy copy-paste |
| AI users | Turn a cluttered page into clean plain text to paste into a model, without ads/nav/comments polluting the context |
| Print-and-read people | Want a genuinely readable PDF of an article, not the ad-covered, cookie-banner-covered live page |
| Accessibility-minded readers | Want adjustable font size/family, line width and a low-glare theme for long-form reading, independent of what the site itself offers |

## 4. Scope — V1

### In scope

- **Trigger**: one click on the toolbar icon, or a keyboard shortcut, opens the reader overlay on the current page.
- **Extraction**: a Readability-style pass finds the page's main article content and strips navigation, ads, sidebars, comments and other furniture (see §5 for how, and its limits).
- **Reading view**: the cleaned content rendered in a full-viewport overlay with:
  - Adjustable font size and font family (a small fixed set — serif / sans / mono)
  - Adjustable line width (narrow / medium / wide)
  - Light / dark / sepia theme
  - These preferences persist locally (`chrome.storage.local`) and apply to the next article opened
- **Reading-time estimate**: a small word-count-based estimate ("~6 min read") shown at the top of the view.
- **Export**: the cleaned content as Markdown, PDF or TXT — same filename convention and PDF writer as [PRD-05](PRD-05-web-highlighter-markdown.md)/[WebHighlighter](../../extensions/WebHighlighter).
- **Works on**: article-shaped pages — blog posts, news articles, long-form essays, documentation pages.
- **Honesty on failure**: if the page doesn't look like an article (see §5), the extension says so plainly instead of producing a garbled export.

### Out of scope for V1

- **No read-it-later queue or cross-device sync.** That's a fundamentally different product — it needs an account. Explicitly not V1, and not a "V1.1"; see §2's whole point.
- **No annotation or highlighting.** That's [WebHighlighter](../../extensions/WebHighlighter)'s job. This product does not mark up a page — it strips it down and hands you a copy. Don't let the two drift toward each other.
- **No full-page (non-article) content extraction.** If a page isn't article-shaped (a dashboard, an app shell, a search results page), the correct behavior is an honest "this doesn't look like an article" message, never a best-effort mangled dump of the whole DOM.
- No cloud/library/search-across-saved-articles view.
- No AI summarization.
- No accounts, sync, sharing or collaboration.

## 5. Where the data comes from — read before committing

Extraction heuristics — find the largest contiguous text block, strip known boilerplate selectors (`nav`, `footer`, `aside`, ad containers), prefer `<article>` or schema.org `Article` markup when present — are **inherently imperfect** across the enormous variety of real-world page structures. This is the core technical risk of the whole product, and it should be treated with the same honesty as [PRD-05 §7](PRD-05-web-highlighter-markdown.md) treats highlight anchoring.

What follows from that:

- This needs testing across a deliberately varied set of real sites before shipping — news sites, blogs, documentation platforms, long-form essay sites, and at least a couple of sites known to be structurally awkward (heavy ads, unusual layout frameworks). A build with no live network access to test against real pages must say so plainly rather than presenting untested selectors as verified (same rule the rest of this portfolio's memory log has followed for every DOM-hostile platform build).
- **The failure mode must be honest, not silent.** Extraction should produce a confidence signal, not just a blob of HTML. When confidence is low — the "winning" content block is thin, mostly links, or barely bigger than the runner-up — tell the user plainly ("This page doesn't look like an article — reader mode works best on articles and long-form posts") rather than rendering a mangled, half-stripped result and letting them export garbage.
- Prefer structural signals that are more redesign-resistant than CSS class names: an actual `<article>` element, schema.org `Article`/`NewsArticle` JSON-LD, `<main>`/`[role="main"]`, before falling back to a scored-candidate heuristic. This mirrors the "JSON-LD first, CSS selectors as fallback" lesson already learned building `EtsyListingAnalyzer` in this portfolio.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Reader overlay opens | < 300 ms from click/shortcut to a rendered view (or an honest "not an article" message) |
| Export generated | < 2 s for a long article |
| Permissions | `activeTab`, `scripting`, `storage`, `downloads`. `<all_urls>` host permission is unavoidable for a universal reader tool — same justification as [WebHighlighter](../../extensions/WebHighlighter)'s: it buys the ability to run reader extraction on whatever the user is currently reading, nothing more, and there is no network code anywhere in the extension |
| Page impact | Zero layout shift on the host page. The overlay is fixed/full-viewport and never modifies the live page's own DOM in a way that persists past closing it |
| Storage | Only reading preferences (font, theme, line width) and local usage counters — no page content is stored |
| Privacy | No network requests of any kind, verifiable in devtools — the whole positioning depends on this being true and checkable |

## 7. Edge cases

- **Paywalled articles**: only ever extract what is actually rendered in the DOM the user can already see. Never attempt to bypass, unlock, or fetch content behind a paywall — that would be a different, dishonest product.
- **Single-page apps** where content loads after the initial DOM is ready: re-attempt extraction after a short settle delay / on relevant DOM mutation, not just once at trigger time, so clicking the toolbar icon on a still-hydrating page doesn't produce an empty result.
- **Image-heavy articles**: keep image references and alt text in the export (a Markdown `![alt](src)`, a TXT-friendly `[image: alt text]` note); never try to embed every image inline — that's out of scope and would bloat exports without a clear benefit.
- **Non-English / RTL text**: reading view must not assume LTR layout or Latin-only fonts; PDF export inherits the shared PDF writer's WinAnsi-only limitation (per PRD-05/WebHighlighter) and should flag unsupported characters and steer the user to Markdown/TXT instead, exactly as WebHighlighter already does.
- **Extremely short pages that aren't really "articles" at all** (a landing page, a single tweet embed, a product page): this is the central "say so, don't guess" case from §5 — low extraction confidence must produce the honest empty/error state, not a one-paragraph "article."

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 250 | 2,500 |
| Users who open reader mode ≥ 1 time | 60% | 70% |
| Users who export ≥ 1 time | 30% | 45% |
| Extraction "not an article" rate (of all opens) | tracked, no target yet | < 15% |
| Store rating | ≥ 4.3 | ≥ 4.5 |

**Instrumented events (local counters only, no PII, no network):** reader opened, extraction succeeded / low-confidence-rejected, export by format, preference changed (font/theme/width), theme distribution.

The extraction rejection rate is this product's version of WebHighlighter's re-anchor rate: the health metric to watch above all others. If it climbs, the extraction heuristics are quietly failing more of the pages people actually try it on.

## 9. Kill criteria

Under 400 installs at 90 days, **or** reader-open rate under 35% of installs, **or** extraction rejection rate sitting above 25% with no improvement across two iterations → stop investing. A high rejection rate specifically means the core technical bet (§5) isn't holding up on real-world pages, which is a different and more fundamental failure than a positioning problem.

## 10. Open questions

- **PDF is standard-font-only (WinAnsi).** Same limitation WebHighlighter already ships with and documents. Worth revisiting only if non-Latin-script export demand shows up in reviews — not worth solving speculatively in V1.
- **Reading-time estimate accuracy.** A flat words-per-minute constant is a reasonable V1 approximation; worth checking against real feedback before tuning further.
- **Font/theme preference scope**: global (applies to every article) vs. per-site. V1 assumption is global — simpler, and matches how the browser's own reader modes behave. Revisit only if users ask for per-site memory.
- **Naming.** "Universal Reader Mode & Export" is descriptive but sits near the built-in-reader-mode keyword space; worth a quick pass against Web Store search results before publishing, same as PRD-05's own open question about its own name.
