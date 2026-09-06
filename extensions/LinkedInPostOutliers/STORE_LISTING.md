# Chrome Web Store listing — LinkedIn Post Outlier Finder

## Name

`LinkedIn Post Outlier Finder`

## Single purpose

> Badge each post on a LinkedIn profile's history, hashtag page or content search result with how
> many times it outperforms that specific author's own recent median engagement, so a breakout post
> is obvious instead of buried in a scroll.

## Short description (132 char max)

`See which LinkedIn posts are outliers — badged vs. that author's own median. No login, no cloud, read-only, no tracking.`

## Category

Productivity → Workflow & Planning (or Social & Communication, whichever the dashboard's live
category list offers closest at submission time)

## Detailed description

**Every existing LinkedIn extension in this category is a sales-automation tool. This one isn't.**

No auto-connect, no auto-message, no lead scraping — just a straightforward question every LinkedIn
creator and marketer already has: *which of these posts actually broke out, and by how much?*

Absolute reaction counts are noise across authors with different-sized audiences. The signal is the
outlier ratio — this post's engagement (reactions + comments) ÷ **that specific author's own** recent
median:

```
Recent median: 38 engagements

🔥 6.0×   —  a post that broke out
🔥 2.5×   —  well above their normal
—  pending  —  not enough of their posts visible yet to compare
```

**Works on three page shapes, no setup:**
- A profile's post history — the strongest case, since a whole author's visible history is on screen
- A hashtag page
- A content search result set

Each post is scored against **its own author's** median, not a single account you're viewing — so a
hashtag page with fifty different authors still tells you which specific posts, by which specific
people, are outliers.

**Filter and sort** — show only posts above 2× or 5×, the last 30/90 days or everything loaded, sort
by outlier ratio, date or raw engagement. One row, no settings page.

**Export what you're looking at** — the visible set as `.csv` or `.md`: author, post URL, type, date,
reactions, comments, reposts, engagement, ratio. A file on your machine, never a service.

**Honest about its own limits.** Below 5 of an author's own posts visible (or cached from a previous
profile visit), the badge shows a plain "pending" chip rather than a false ratio. A single runaway
post never gets to define its own author's baseline — it's excluded from the median calculation
itself, not just the display. Reposts are attributed to the original author and marked as such, never
folded into the resharer's own numbers.

**No account. No cloud. No network. No tracking of anyone over time.**

This extension makes no network requests at all — it reads only what's already rendered in your own
logged-in LinkedIn tab. Your filter preference and a small per-author cache of computed medians live
in your browser's local storage, verifiable in devtools in about ten seconds. Nothing is ever tracked
about a person over time — a cached median is a point-in-time convenience, refreshed whenever you
revisit that profile, not a history.

**Built for**

Creators asking which of their posts actually worked. Content marketers scouting proven formats from
a hashtag or search result set before writing. Agencies running a competitive teardown of a
prospect's LinkedIn history in minutes, not an afternoon. Founders sanity-checking whether a launch
post really outperformed their own baseline.

**Read-only, always.** No posting, reacting, commenting, following or connecting — this extension
never takes an action on LinkedIn on your behalf. There is no code path anywhere in it capable of
writing to the page.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access `*://*.linkedin.com/*` | The extension's entire function — reading a page's post nodes and their reaction/comment counts, and badging them — happens on linkedin.com. No other site is accessed, and no data is transmitted off-device. |
| `activeTab` | Lets the toolbar popup detect whether the active tab is LinkedIn, so it can show the right message, without requesting the broader "tabs" permission. |
| `storage` | Persisting the user's last-used filter and a small per-author median cache locally. |
| `downloads` | Writing the exported `.csv`/`.md` file and the JSON backup the user requests from the popup. |

**Remote code:** none. All code is bundled in the package; no `eval`, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A profile's post history with the header strip ("Recent median: 38 engagements") and several
   badged posts
2. A hashtag page showing a mix of reliable badges and "pending" chips, illustrating the honesty rule
3. The filter row open, with `> 5×` active and the page narrowed to match
4. The export row, with a downloaded `.csv` open in a spreadsheet beside it
5. The toolbar popup: local usage counters and the export/import/clear-all controls

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page

## Test instructions for the reviewer

> Sign in to LinkedIn first (a personal account is fine). Open any profile's post history
> (`/in/<handle>/recent-activity/all/`) with at least a handful of posts — a header strip and badges
> appear automatically, no toolbar click needed. Try a hashtag page (`/feed/hashtag/<tag>/`) or a
> content search result set to see the mixed-author view. Use the filter row above the results to
> narrow by ratio or date window, and the Export buttons to save the visible set as `.csv` or `.md`.
> Click the toolbar icon to see local usage counters and the data export/import/clear controls. No
> account or sign-up with this extension is required at any point.
