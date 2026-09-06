# Chrome Web Store listing — Meta Ad Winner

## Name

`Meta Ad Winner — Ad Library longevity & swipe file`

## Short description (132 char max)

`See which Facebook/Instagram ads have run longest and in the most variants — the ones that are almost certainly working.`

## Category

Productivity → Workflow & Planning (or: Business tools, if the store separates it)

## Detailed description

**The Ad Library already tells you which ads are winning. It just doesn't say so.**

Meta's Ad Library shows every advertiser's ads and the date each one started running — but it
doesn't rank by duration, count how many versions of the same creative are live, or let you filter
to "still running after 60 days." Those three things are the entire idea: nobody pays to keep
losing money on an ad for three months. An ad still running after 90 days, in nine variants, is a
winner.

**What it adds to every search**

- A badge on every ad: **🏆 127 days running · 9 variants · still active**
- Filters for minimum days running, active-only, minimum variant count, and format
- Sort by days running, variant count, or start date
- A swipe file: save an ad's advertiser, copy, landing domain, dates, format and a note; organize
  saved ads into collections
- Export the filtered results or your whole swipe file as CSV or Markdown

**No account. No cloud. No network.**

Everything runs against the page you're already looking at. Your swipe file lives in your browser's
local storage and is never transmitted anywhere — verifiable in devtools in about ten seconds.

**Built for**

Media buyers scouting proven creative angles before spending a dollar. Agencies building a
competitive teardown for a pitch. Ecommerce operators checking what's working in their category
right now. Copywriters building a swipe file of ads that survived contact with the market.

**What this is not**

No ad spend or performance numbers — nobody outside Meta can see those, and a tool that claims to
show them is guessing. This shows what the Library actually publishes: how long an ad has run, and
how many versions of it exist. That is a genuinely strong signal on its own.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the popup find the active Ad Library tab so it can talk to that page's content script; granted only for the tab the user is actively viewing. |
| `storage` | Persisting the user's swipe file, collections and export preferences locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |
| Host access to `*://*.facebook.com/*` | The extension's entire function — badges, filters, sort, and the "+ Save ad" button — runs only on `facebook.com/ads/library`, a public transparency page that requires no sign-in for most regions. No other page on the domain is touched, and no data is transmitted off-device. |

**Remote code:** none. All code is bundled by esbuild into the zip: no `eval`, no CDN scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. Ad Library search results with longevity badges on several ads
2. The filter/sort bar with "≥ 90 days" and "Sort: days running" selected
3. The popup showing a swipe file with two collections
4. A saved ad card with a note attached
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
