# Chrome Web Store listing — Pinterest Opportunity Finder

## Name

`Pinterest Opportunity Finder`

## Single purpose

> Badge the pins in a Pinterest search that are pulling far above the median engagement of the
> loaded results, and surface the keywords, domains and image formats those outlier pins share, as a
> read-only research overlay with CSV/Markdown export.

## Short description (132 char max)

`See which Pinterest pins outperform the median for a search, and what keywords, domains and formats they share. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Find the pins that are outperforming — and what they have in common.**

Run a search on Pinterest. This extension reads the results already on the page and badges each pin
with an outlier ratio against the median of the loaded set:

🔥 4.2× · 1.2K saves · domain.com

Open the keyword panel and see, across the top-performing pins only:

• **Words and phrases** over-represented in outlier titles and descriptions, with the sample size —
never advice, just counts
• **Which domains recur** among the outliers — who already owns this query
• **The formats that dominate** — image shape and text-on-image vs. plain

Filter by minimum ratio, domain, text overlay, or the last N results loaded. Export the pins with
their metrics, and the keyword table, as CSV or Markdown.

**Honest about what Pinterest actually shows.**

Save counts don't appear on every pin, and this extension never fakes one. When too few pins in a
search expose a readable number, badges fall back to Pinterest's own result order instead — clearly
labelled as a rank, never presented as a save count. Promoted pins and idea pins are excluded from
the median and labelled separately, because they aren't comparable to a standard pin.

**No account. No cloud. No network.**

Everything happens by reading the page already in your tab. Your filters and a small cache of past
search medians live in your browser's local storage — nothing is ever sent anywhere, and you can
verify that in devtools in about ten seconds. Export everything as one JSON file, or wipe it with one
click.

**Built for**

Bloggers finding the angle that gets saved in their niche. Ecommerce and Etsy/Shopify sellers reading
demand phrasing before writing a listing. Pinterest marketers building a pin strategy from evidence
instead of guesswork.

**What this extension will never do:** sign in to Pinterest on your behalf, pin, like, follow, or
post anything, download images in bulk, or estimate search volume Pinterest doesn't expose.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the toolbar popup ask the active tab's content script for the currently loaded search results, only while the popup is open. No access to any other tab. |
| `storage` | Persisting the user's filter preferences, a cached median per search query, and local usage counters — all on-device. |
| `downloads` | Writing the exported `.csv` (pins, keywords) and `.md` (full report) files the user explicitly requests. |
| Host access — `pinterest.com` and its regional ccTLD domains (`.co.uk`, `.de`, `.fr`, `.ca`, and others) | The extension's core function is reading the pin cards Pinterest already rendered on a search results page, for whichever Pinterest domain the user's locale routes them to. No data is transmitted off-device; the extension makes no network requests of its own. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A Pinterest search with 🔥 ratio badges on several pins
2. The popup's Pins tab, with a filter applied and a save-count-unreliable search shown honestly
3. The Keywords tab: phrase table, domain table and format breakdown
4. A Markdown export open in a text editor, showing the pins table and keyword table
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
