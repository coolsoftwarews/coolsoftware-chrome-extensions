# Chrome Web Store listing — Universal Table/List → CSV Scraper

## Name

`Universal Table/List → CSV Scraper`

## Short description (132 char max)

`Click a table or a list of cards on any page, preview it, export CSV or JSON. No account, no cloud — nothing leaves your device.`

## Category

Productivity → Tools

## Detailed description

**Stop copy-pasting tables into Excel and fighting the formatting.**

Click the extension icon, then **Pick a table or list**. Hover the page — a green outline shows what
you're about to select. Click it, and a preview of the rows and columns appears in the corner of the
page. Export **CSV** or **JSON**. That's the whole product.

**Works on real `<table>`s — and on grids of cards that aren't tables at all.**

Most table exporters stop at `<table>`. A lot of the data people actually want off a page today —
product grids, search results, directory listings — is built from `<div>`s, not `<table>`s. This
extension detects repeated card/list structures too, and lines them up into columns the same way.
That part is inherently best-effort (there's no `<table>`/`<tr>`/`<td>` to lean on), so when it isn't
confident, it says so plainly instead of exporting garbage rows.

**Handles merged cells properly.** `colspan`/`rowspan` cells are duplicated into every column they
visually cover, so your columns never silently drift out of alignment under a merged header.

**No account. No cloud. No network.**

This extension makes no network requests at all — verifiable in devtools in about ten seconds. The
table you're exporting is parsed entirely on your device and saved straight to a file. Nothing about
what you scrape is ever transmitted or stored beyond the export itself.

**Built for**

Analysts pulling a data table off a report or dashboard. Sales and lead-gen people grabbing a list of
companies or listings off a directory page. Ecommerce researchers exporting a competitor's product
grid. Students and journalists getting a table out of a reference site. Anyone who just watched Excel
mangle a pasted HTML table for the third time.

**What this is not**

No multi-page crawling or pagination-following — one visible page at a time. No scheduled or automatic
re-scraping. No data cleaning beyond basic whitespace trimming. It's a click-to-export tool, not a
scraper bot.

**Why it needs access to all sites**

A table exporter that only works on an approved list of sites isn't one. That permission is what lets
the extension read a table or list on whatever page you're looking at — and it grants no ability to
send anything anywhere, because there is no code in this extension that opens a network connection.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `<all_urls>` host access | The extension's core function is reading a user-selected table or list from arbitrary web pages. This is not possible with a site allowlist. No data is transmitted off-device. |
| `storage` | Persisting local usage counters and an export-format preference. |
| `downloads` | Writing the exported `.csv`/`.json` file the user requests. |
| `activeTab` / `scripting` | Identifying the active page and injecting the picking/preview UI into it. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. Hovering a `<table>` on a real page, green outline visible
2. The on-page preview panel showing a parsed rows/columns grid next to the source table
3. A product-card grid with the preview panel showing inferred columns
4. The "first row is headers" toggle changing the preview live
5. The low-confidence refusal state — "This doesn't look like a structured list"

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
