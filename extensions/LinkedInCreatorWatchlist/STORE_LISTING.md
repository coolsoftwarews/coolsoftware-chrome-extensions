# Chrome Web Store listing — LinkedIn Creator Watchlist

## Name

`LinkedIn Creator Watchlist`

## Single purpose

> Let a user watch specific LinkedIn creators and collect the posts from them the user encounters
> while browsing LinkedIn, into a side-panel list with engagement stats, sorting, filtering, notes and
> CSV/Markdown export.

## Short description (132 char max)

`Watch specific LinkedIn creators and see their best posts in one place — collected as you browse. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Stop hoping the feed shows you the right people.**

LinkedIn's feed is optimised for LinkedIn, not for the dozen people you actually want to read. Pick
the creators, founders or voices in your niche worth learning from, click **+ Watch** on their
profile or next to their name in any post, and their posts start collecting in a side panel as you
browse — the feed, their profile, search results.

Each post shows its reactions, comments, reposts, date and a link back to it, plus an outlier badge
when a post clearly beat that person's usual numbers. Sort by recency or by outlier ratio. Filter to
one person, or to outliers only. Add a note to a person ("good at carousels, weak hooks") or to a
specific post.

**Nothing happens automatically.** This is not a crawler: posts are only collected from people
already on your watchlist, and only when you actually see them. There is no polling, no scraping of
profiles you haven't opened, and no notification the moment someone new posts.

**Zero write actions, guaranteed by having no such code.** This extension never posts, likes,
comments, follows, connects with or messages anyone. It is a read-only window onto your own feed.

**No account. No cloud. No network.** Everything — your watchlist, the posts collected, your notes —
lives in your browser's local storage. There is no server behind this product and no LinkedIn API
integration; it reads what your own logged-in session already renders. Export it all as JSON, CSV or
a readable Markdown digest whenever you want, or clear it with one click.

**Built for**

Founders keeping up with a dozen specific voices without the feed. Creators studying the people ahead
of them in their niche. Content marketers building a hook/format reference from B2B posts.
Consultants watching what resonates in a client's industry.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access `*://*.linkedin.com/*` | The extension's entire function is reading posts and profile information the user's own LinkedIn session has already rendered, on linkedin.com only, and adding a "+ Watch" button next to author names. No other site is accessed, no data is fetched from a server, and no data is transmitted off-device. |
| `activeTab` | Identifying the active tab so the panel and the content script agree on context, without standing access to every open tab. |
| `storage` | Persisting the user's watchlist, the posts collected for each watched person, and their notes, locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |
| `sidePanel` | The watchlist, sort/filter controls and export live in a side panel next to the LinkedIn page. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted off the
user's device.

## Screenshots (1280×800)

1. A LinkedIn profile with the "+ Watch" / "Watching ✓" button visible near the name
2. The side panel listing watched people as chips, with the collected-posts summary line
3. A post card showing an outlier badge, reactions/comments/reposts, and a note
4. Sort and filter controls (Recency / Outlier ratio, ">2× outliers only")
5. The "Data" sheet — export CSV/Markdown/JSON, import, clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
