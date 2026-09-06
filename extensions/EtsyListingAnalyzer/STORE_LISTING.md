# Chrome Web Store listing — Etsy Listing Analyzer

## Name

`Etsy Listing Analyzer`

## Single purpose

Read the currently open Etsy listing page and display a structured breakdown of its title, tags,
photos, price, options, sales and shop stats, so a seller can compare it against other listings
they've opened.

## Short description (132 char max)

`See exactly how a competitor's Etsy listing is built — tags, title, price, photos — and compare up to 6 side by side. No account.`

## Category

Productivity → Workflow & Planning (alt: Shopping)

## Detailed description

**Open a competitor's listing. See exactly how it's built.**

Etsy scatters what makes a listing work — title, tags, photo count, price, shipping, options,
sales, shop stats — across three different parts of the page. This puts it in one legible block:

```
Title:      12 words · 118 chars · keyword front-loaded ✓
Tags:       13 of 13 used
Photos:     8  ·  video ✓
Price:      £24.00  ·  free shipping ✓
Options:    3 variations  ·  personalization ✓
Sales:      1,240  ·  ★4.9 (312 reviews)
Shop:       est. 2019 · 4,800 sales · UK
```

**Compare up to 6 side by side.** Add listings to the compare tray as you research a niche, and see
every field in one table — with the differences highlighted, so "why is theirs outranking mine" has
an actual answer.

**See which tags recur.** Once you've compared at least 4 listings, the tray shows which tags show
up across your competitors and how often — "5 of 6 use *personalized gift*, you don't."

**Save a teardown with a note, and see what changed.** Revisit a saved listing later and it shows
you the price, sales and tag changes since your last look.

**Export CSV or Markdown.** The comparison table as a spreadsheet, or a clean Markdown audit —
built for handing to a client, or dropping into your own notes.

**No account. No cloud. No Etsy API key.**

Everything this extension knows about a listing comes from the page you already have open — it
reads nothing else, crawls nothing, and sends nothing anywhere. Your compare tray and saved
teardowns live in your browser's local storage, verifiable in devtools in about ten seconds.

**Built for**

Etsy sellers reverse-engineering the listing that's outranking theirs. Print-on-demand sellers
copying a title/tag structure that works. New sellers learning what a good listing looks like.
Consultants producing a listing audit for a client.

**What this extension does not do**

No sales or revenue estimates — Etsy doesn't expose real sales figures and this doesn't guess at
them. No listing editing, no posting, no write action of any kind on your shop — strictly
read-only. No crawling of listings you haven't opened yourself.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `*://*.etsy.com/*` host access | The extension reads the Etsy listing page currently open to build the teardown. Scoped to Etsy only — no other site is accessed, and no data leaves the device. |
| `activeTab` | Lets the toolbar icon open the panel for the tab you're viewing. |
| `storage` | Persisting the compare tray, saved teardowns and usage counters locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. An Etsy listing page with the teardown panel open, showing the structured block
2. The compare tab with 4–6 listings side by side, differences highlighted
3. The tag recurrence list under a full compare tray
4. The Saved tab showing a note and a price/sales change since the last snapshot
5. A Markdown audit export open next to the panel

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
