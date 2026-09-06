# Chrome Web Store listing — X Velocity Finder

## Name

`X Velocity Finder`

## Single-purpose sentence

Badges posts on X with engagement-per-hour and an outlier ratio against the author's own recent
median, so a live thread stands out from an old one — reading only what's already on the page, with
no account, no X API and no network requests.

## Short description (132 char max)

`See what's actually taking off on X right now — engagement per hour, not totals. No account, no API, no network requests.`

## Category

Productivity → Workflow & Planning (alt: Social & Communication)

## Detailed description

**X shows you totals. This shows you rate.**

400 likes in 40 minutes is a live event. The same 400 likes over three days is history — but on X's
own timeline they look identical. X Velocity Finder badges every post with engagement per hour since
it went up, plus how that compares to the author's own recent median:

```
⚡ 620/h · 3.4× · 2h old
```

The formula is stated, not hidden: **(likes + reposts + replies) ÷ hours since posting.** It's on
every badge's tooltip and in the filter bar.

**Filter the noise out, or just dim it**

A filter bar drops into the top of your timeline, search results, and profiles: minimum velocity,
minimum outlier ratio, and an age band (under 1h / 6h / 24h). Choose to dim the posts below your bar
or hide them outright — your call, because hiding things in your own timeline is a strong move.

**Sort a search by velocity**

X's own "Top" ranking is a black box. Sort any search result by velocity instead, and see what's
actually moving on your query right now.

**Take it with you**

Export the currently filtered set as CSV or Markdown — author, text, counts, velocity, ratio, age,
link. A file downloads to your machine. Nothing is uploaded anywhere.

**No account. No X API. No network requests.**

This reads only the rendered page you're already looking at. There is no server behind it, no key to
configure, and no cost to run — verify that yourself in devtools' Network tab in about ten seconds.

**Built for**

Creators spotting a live conversation early enough to add to it. Founders catching a thread about
their market while it's moving. Marketers finding the format and hook that's working this week.
Journalists and researchers telling a breaking thread apart from an old one resurfacing.

**Read-only, always**

This extension never posts, likes, reposts, replies or follows on your behalf. It only reads what's
already on the page.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Lets the popup ask the currently open tab for its live badge/filter status when the user opens the popup. |
| `storage` | Persisting author medians, filter settings and local usage counters — all on-device, none transmitted. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user explicitly requests. |
| `*://*.x.com/*`, `*://*.twitter.com/*` host access | The extension's core function is reading engagement counts and timestamps already rendered in the user's own X timeline, search results and profile pages, on both domains X currently resolves on. No other site is touched, and no network request is made to either domain — the extension only reads the DOM the browser already loaded. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted off-device.

## Screenshots (1280×800)

1. Home timeline with velocity badges visible on several posts
2. The filter bar open, showing minimum velocity/ratio/age controls and the dim/hide toggle
3. A search results page, sorted by velocity, with the "Sort by velocity" toggle highlighted
4. The export controls, with a downloaded CSV open beside the browser
5. The popup showing this tab's live status and the data-ownership controls

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
