# Chrome Web Store listing — Amazon Review Intelligence

## Name

`Amazon Review Intelligence`

## Short description (132 char max)

`Cluster the recurring complaints and praise in an Amazon product's reviews, with evidence one click away. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Reading 300 reviews to find the three recurring complaints is the most valuable hour in product
research — and the one nobody has time for.**

Open any Amazon product's reviews and this extension counts what actually recurs: the complaints that
show up again and again in the 1–2★ reviews, and the praise that shows up again and again in the 4–5★
ones. Every theme expands to the reviews behind it — the count is never just an assertion.

```
214 reviews read · 47 negative (1–2★)

Recurring themes in negative reviews
  battery / charge / dies        18 mentions
  strap / broke / snapped        12
  instructions / manual / unclear 9
  sizing / too small              7

Recurring praise
  easy to set up                 31
```

**Filter** by star band, verified purchase, keyword or date range. **Save** an analysis per product and
come back later to see what changed — "battery mentions up from 18 to 31." **Export** a CSV (theme,
count, star band, example review) for a spreadsheet, or a Markdown teardown to paste straight into a
product brief.

**No sentiment AI. No LLM. Just counting.**

Themes are frequent term clusters — normalized words and short phrases that recur across reviews,
grouped by how often they show up together. Not an AI guessing at sentiment: countable, explainable, and
either obviously right or visibly wrong. That also means nothing is ever sent to a server — the
clustering runs in your browser, on the reviews already loaded on the page you opened.

**What it doesn't do, on purpose**

It never clicks "next page" for you. It reads what's rendered — scroll or open another review page and
it accumulates on top of what it already read, keyed to the product. Auto-paginating through hundreds of
review pages would risk your Amazon session; this extension would rather tell you honestly how many
reviews it read than pretend to read them all. No account. No fake-review detection (a serious claim
this tool has no data to back). No action is ever taken on your Amazon account — reading only.

**Built for**

Sellers sourcing what to fix in a competitor's product. Product developers pulling requirements from real
complaints. Copywriters finding the objection their bullet points need to answer. Ecommerce operators
checking whether a supplier's product has a known flaw before they list it.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to Amazon storefronts (`*://*.amazon.com/*`, `.co.uk`, `.de` and other major locales) | The extension's entire function is reading the review markup already rendered on an Amazon product page the user opened, and merging it with what they've already read for that product. Not possible without host access to those pages; scoped to Amazon only, not a site allowlist workaround like `<all_urls>`. No data is transmitted off-device. |
| `activeTab` | Identifying the tab whose reviews the popup should display when the user clicks the toolbar icon. |
| `storage` | Persisting the reviews read, notes, filters and local usage counters, all on-device. |
| `downloads` | Writing the exported .csv or .md file the user requests. |

**Remote code:** none. All code is bundled by esbuild into the package; no `eval`, no CDN scripts, no
model API calls of any kind.

**Data usage disclosures:** none of the categories apply — no data is collected or transmitted. Review
text is read from the page and processed entirely on-device.

## Screenshots (1280×800)

1. A product's negative reviews with the panel open, showing 3–4 ranked themes and mention counts
2. A theme expanded, showing the evidence reviews behind it (rating, verified badge, date, text)
3. The filters row — star band, verified only, keyword, date range — narrowing the same product
4. The CSV export open in a spreadsheet next to the panel
5. The "not enough reviews yet" state on a product with under 20 reviews

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
