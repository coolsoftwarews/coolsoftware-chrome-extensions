# Chrome Web Store listing — Instagram Outlier Finder

## Name

`Instagram Outlier Finder`

PRD §10 flags "outlier" as insider vocabulary worth testing against "breakout posts" in live Web
Store search before publishing. Alternates: *Instagram Breakout Post Finder*, *IG Content Outliers —
find what worked*.

## Single purpose

> Badge each post on an Instagram profile grid with how many times it outperforms that account's own
> recent median, so a marketer or creator can spot breakout content at a glance instead of scrolling
> and guessing.

## Short description (132 char max)

`See which Instagram posts are outliers — badged with their multiple vs. that account's own median. No login, no cloud, read-only.`

## Category

Productivity → Workflow & Planning (or Social & Communication, whichever the dashboard's live
category list offers closest at submission time)

## Detailed description

**Absolute view counts are noise across accounts of different sizes. The signal is the outlier
ratio.**

A 157K-view Reel on an account whose median is 18K is an 8.7× outlier — that's a finding. A 2M-view
post from an account that always does 2M is not. This extension computes that ratio for every post
in a profile's grid, right where you're already looking:

```
Recent median: 18K views

🔥 8.7×   157K
🔥 5.1×    92K
↑  2.4×    43K
—  0.9×    16K
```

**Filter and sort** — show only posts above 2× or 5×, Reels or Posts only, the last 30/90 days or
everything loaded, and sort by outlier ratio, views or date. One row, no settings page.

**Export what you're looking at** — the visible set as `.csv` or `.md`: URL, type, date, views,
likes, comments, ratio. A file on your machine, never a service.

**Honest about its own limits.** Below 12 loaded posts the median is shown greyed out rather than
presented as a baseline. Pinned posts are excluded from the median but still badged. When a post
only has a like count, its badge says so (`8.7× likes`) rather than quietly mixing two different
kinds of numbers.

**No account. No cloud. No network.**

This extension makes no network requests at all — it reads only what's already rendered in your own
logged-in Instagram tab. Your filter preference and a small per-profile cache of computed medians
live in your browser's local storage, verifiable in devtools in about ten seconds.

**Built for**

Creators asking which of their ideas worked unusually well. Content marketers scouting proven
angles in a niche before scripting. Agencies running a competitive teardown in ten minutes instead
of an afternoon. Social strategists who need evidence for a content recommendation, not a hunch.

**Read-only, always.** No posting, liking, following or commenting — this extension never takes an
action on Instagram on your behalf.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access `*://*.instagram.com/*` | The extension's entire function — reading a profile grid's post nodes and their view/like counts, and badging them — happens on instagram.com. No other site is accessed, and no data is transmitted off-device. |
| `activeTab` | Lets the toolbar popup detect whether the active tab is Instagram, so it can show the right message, without requesting the broader "tabs" permission. |
| `storage` | Persisting the user's last-used filter and a small per-profile median cache locally. |
| `downloads` | Writing the exported `.csv`/`.md` file and the JSON backup the user requests from the popup. |

**Remote code:** none. All code is bundled in the package; no `eval`, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A profile grid with the header strip ("Recent median: 18K views") and several badged tiles
2. The filter row open, with `> 5×` and "Reels" active and the grid narrowed to match
3. The export row, with a downloaded `.csv` open in a spreadsheet beside it
4. A small-sample profile showing the greyed "keep scrolling for a reliable median" state
5. The toolbar popup: local usage counters and the export/import/clear-all controls

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page

## Test instructions for the reviewer

> Sign in to Instagram first (a personal account is fine). Open any profile with at least a dozen
> posts and scroll its grid — a header strip and badges appear automatically, no toolbar click
> needed. Use the filter row above the grid to narrow by ratio, type or date window, and the Export
> buttons to save the visible set as `.csv` or `.md`. Click the toolbar icon to see local usage
> counters and the data export/import/clear controls. No account or sign-up with this extension is
> required at any point.
