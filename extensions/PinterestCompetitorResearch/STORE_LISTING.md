# Chrome Web Store listing — Pinterest Competitor Pin Research

## Name

`Pinterest Competitor Pin Research`

## Single-purpose description

This extension lets a user save Pinterest pins they choose into a local research library — with the
title, full description, destination link and their own note — and export that library as a file.
Nothing else.

## Short description (132 char max)

`Save competitor pins with title, full description & destination — organize into collections, export as CSV/Markdown/JSON.`

## Category

Productivity → Workflow & Planning

## Detailed description

**A secret board keeps the image. This keeps everything else.**

Saving a competitor's pin to a secret board is what most Pinterest marketers do today — and it throws
away the two things that actually matter: the full description and where the pin sends traffic. This
extension captures both, plus the board, the creator, the saves count and your own note on why you
saved it, right where you're already browsing.

**+ Save to research** — on any pin in a grid, or on a pin's own page. One click, no leaving the page.

**Collections.** Ships with four — Competitors, Title patterns, Product framing, Design ideas — all
renameable, plus add your own.

**Research panel** (side panel)

• Search across title, description, domain and note
• Group by collection, or **group by domain** — "these 40 pins come from 6 domains" is a competitive
finding on its own
• Edit notes, move between collections, click through to the original pin

**Export**

• **CSV** — the primary artifact: title, description, domain, destination URL, saves, collection,
note. Goes straight into a planning spreadsheet.
• **Markdown** — a readable digest with thumbnails, grouped by collection
• **JSON** — full backup, re-importable

**No account. No cloud. No network.**

This extension makes no network requests at all — verifiable in devtools in about ten seconds. Your
research library lives in your browser's local storage. Export it as a JSON backup any time, import
it on another machine, or clear it with one click.

**Built for**

Pinterest marketers building a competitor reference before a campaign. Bloggers collecting title and
description patterns that work. Ecommerce sellers tracking how competitors frame the same product.
Agencies assembling a client-ready research deck.

**What it never does**

No pinning, liking, following or posting on your behalf, ever. It only reads what's already on the
page when you click save — never a background crawler, never an API call.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `*://*.pinterest.com/*` host access | The extension's core function is reading pins the user chooses to save on Pinterest and injecting the save control into the page. This also covers Pinterest's regional locale subdomains, since their legacy country-code domains redirect to subdomains of pinterest.com. No data is transmitted off-device. |
| `storage` | Persisting saved pins, collections and notes locally. |
| `downloads` | Writing the exported .csv/.md/.json file the user requests. |
| `sidePanel` | The research library, search and export controls are a side panel. |
| `activeTab` | Letting the toolbar icon open the side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. Pinterest grid with the "+ Save to research" button visible on hover
2. A pin's detail page with the floating save button, description in full view
3. Side panel: cards grouped by collection, with thumbnails, notes and domain badges
4. The "By domain" view — pins grouped by destination, showing a repeat competitor
5. The CSV export open in a spreadsheet next to the extension

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
