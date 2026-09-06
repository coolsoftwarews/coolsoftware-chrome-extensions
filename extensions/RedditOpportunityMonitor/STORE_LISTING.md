# Chrome Web Store listing — Reddit Opportunity Lens

## Name

`Reddit Opportunity Lens`

PRD §10 explicitly warns against "Monitor" in the name — it implies background watching this
extension deliberately never does, and would earn one-star reviews from people who wanted alerts.
"Lens" keeps the promise honest: it's something you look through while you browse, not something that
watches for you. Alternates considered: *Reddit Opportunity Radar* (still implies scanning you
didn't ask for), *Reddit Lead Finder* (undersells the market-read angle in PRD §4).

## Short description (132 char max)

`Flags "looking for X" threads in the subreddits you already read, using your own rules. No account, no alerts, no cloud.`

## Category

Productivity → Workflow & Planning

## Single purpose

> Scan posts already rendered in a Reddit tab the user is browsing against user-defined intent+topic
> rules, mark matching threads in the feed, and collect them in a local panel with export to CSV or
> Markdown.

## Detailed description

**Reddit is where people state a problem and ask for a solution, in plain language. This finds those
threads in the subreddits you're already in.**

Write a rule as two parts — an **intent** phrase ("looking for", "any alternative to", "how do you
handle") and a **topic** word ("invoicing", "time tracking", your category) — and every matching post
gets a small chip right in the feed:

```
💡 "looking for" + "invoicing" · r/freelance · 34 comments
```

No idea what to write? Start from a pack — SaaS founder, freelancer/agency, marketer, indie hacker —
and edit it from there.

**The panel** collects every matched thread as you browse: subreddit, title, snippet, score, comment
count, a link back to the source. Mark one `replied` or `dismissed`, leave yourself a note, filter by
subreddit, rule or status. A running count of how often each topic word has fired in the last 30 days
is the real signal — a live market read, not just a pile of links.

**For the subreddit you're currently reading**, a small summary from what's loaded: post volume,
median score, the intent phrases that come up most — enough to judge whether a community is worth
being in, without leaving the tab.

**Export:** CSV or Markdown, whenever you want.

**No account. No cloud. No alerts.**

This is a lens, not a monitor. It only reads what you've already scrolled past — no Reddit API, no
background polling, no notifications. That's a deliberate limit, not a missing feature: alerts would
mean background crawling, which this extension will never do. It never votes, comments, follows,
joins, or posts anything — read-only on Reddit, permanently.

Everything lives in your browser's local storage. Export every rule and every matched thread as one
JSON file, import it back, or wipe everything with one click.

**Built for**

SaaS founders looking for the exact words people use to describe the problem they solve. Freelancers
and agencies catching "can anyone recommend a…" threads. Marketers tracking how a category actually
talks about itself. Indie hackers validating a problem before building it.

**Comments are not read in this version** — only posts. That's a stated limit, not a bug.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `*://*.reddit.com/*` host access | The extension's core function is reading posts already rendered on Reddit pages the user visits, to check them against the user's own rules and mark matches. No data is transmitted off-device — no code in this extension opens a network connection. |
| `activeTab` | Identifying which Reddit tab is currently active, so the panel's "subreddit read" reflects the tab the user is actually looking at. |
| `storage` | Persisting the user's rules, matched threads, statuses/notes and local usage counters. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A subreddit feed with a matched-thread chip visible on a post
2. The panel's opportunity list, with the signals sidebar showing topic hit counts
3. The rules editor with a starter pack applied
4. The "Subreddit read" summary for a subreddit
5. The Data sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
