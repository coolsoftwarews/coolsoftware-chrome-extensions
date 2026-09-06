# Chrome Web Store listing — Etsy Niche Opportunity Finder

## Name

`Etsy Niche Opportunity Finder`

## Short description (132 char max)

`See the shape of an Etsy niche on the search page — seller moat, shop concentration, freshness. No account, no API, no cloud.`

## Category

Productivity → Workflow & Planning (or Shopping, if Etsy-specific tools are better discovered there)

## Detailed description

**Is this niche open, or is it locked up? Read it off the search page in one glance.**

Search Etsy for anything and a strip appears at the top of the page:

> Niche read: 64 listings · 23 shops · median 340 sales · median price £24
> Concentration: top 3 shops hold 41% of page one
> Price band: £12–£58 (middle 50%)

Every listing gets a small badge — price, sales or reviews (labelled, never mixed together), shop
name, and whether it's a promoted ad. Ads are shown but excluded from the stats above them, so the
numbers reflect real competition, not who paid for placement.

**Filter to the beatable listings.** Cap sales, set a price band, isolate one shop, or hide ads —
right on the page, no dialog, no reload.

**See the real words, not a made-up volume number.** The tag view aggregates the words actually
appearing in the top listings' titles, with counts and the sample size shown. It is not a
search-volume estimate — nobody selling one has real data either, and Etsy doesn't publish it.

**Save a niche, come back later, see what changed.** "+ Save niche" stores today's numbers locally.
Return to the same search next week and the strip shows the delta — more sales, more shops, a wider
price band — automatically.

**Export the whole read** — summary, listings, tag table — as CSV or Markdown, whenever you want it.

**No account. No cloud. No Etsy API.**

Every paid competitor in this space (eRank, Marmalead, Alura) asks for a signup before showing
anything. This extension doesn't, because it can't: it makes no network requests at all, reads only
the page you already have open, and never estimates a number it can't show you the source for. Your
saved niches and settings live in your browser's local storage, verifiable in devtools in about ten
seconds.

That cuts both ways, so the tools to own your data are built in: export every saved niche as one
JSON file, import it back on another machine, or wipe everything with one click.

**Built for**

New Etsy sellers checking whether they can get into a niche. Established sellers scanning adjacent
categories for expansion. Print-on-demand sellers triaging many niches quickly. Craft businesses
checking pricing norms before they launch a product.

**Why it needs access to etsy.com**

The extension's entire function happens on Etsy's own search and category pages — reading the
listing cards Etsy already rendered for you. It touches no other site, and nothing is transmitted off
your device.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host `*://*.etsy.com/*` | The extension's core function — reading listing cards on Etsy search and category result pages — is not possible without it. No other site is accessed and no data is transmitted off-device. |
| `activeTab` | Identifying and messaging the active Etsy tab when the user opens the toolbar popup, so the popup can show that page's niche read. |
| `storage` | Persisting user-triggered niche snapshots, filter preferences and local usage counters. Nothing is sent anywhere. |
| `downloads` | Writing the exported .csv/.md file the user requests. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. The strip on an Etsy search results page, with per-listing badges visible
2. The filters panel open, with an "Ad" badge and organic listings visible
3. The tag table, showing word counts and the sample size
4. A saved-niche delta ("median sales +40 since 12 Aug") in the strip
5. The popup: saved-niche library and the "Data" export/import/clear panel

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
