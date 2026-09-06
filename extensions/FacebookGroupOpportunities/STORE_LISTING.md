# Chrome Web Store listing — Facebook Group Opportunity Finder

## Name

`Facebook Group Opportunity Finder`

## Short description (132 char max)

`Flags "looking for X" posts in your Facebook groups using your own rules. No account, no cloud, no automation.`

## Category

Productivity → Workflow & Planning

## Detailed description

**In the groups you're already in, catch the posts where someone is asking for exactly what you sell.**

Facebook groups are full of "can anyone recommend a bookkeeper" posts that convert — and nearly
impossible to catch reliably, because the feed is chronological chaos. This extension puts a keyword
lens over the groups you've already joined.

**Write a rule — or pick a starter pack.** A rule is two lists: a match phrase ("looking for", "can
anyone recommend") and a topic word ("bookkeeper", "web developer"). A post only counts when it has
both — that two-part check is what keeps the noise down. Four starter packs (agency, bookkeeping,
developer, photography) get you a working rule in one click.

**Scroll your feed as normal.** Matching posts get a small badge — 💡 opportunity — "looking for" +
"bookkeeper" — right in the feed. Nothing else changes, and nothing is clicked, liked, joined or
commented on for you.

**Everything lands in one panel.** Group, author, post text, date, comment count, a link back to the
post. Mark it new, replied or dismissed, add a note, and see "seen 3 similar posts this week" per
rule — the number that tells you whether a niche is actually live.

**Export CSV or Markdown, any time.**

**No account. No cloud. No automation.**

This extension makes no network requests at all — verify that in devtools in about ten seconds. It
never scans in the background, never joins a group, never posts, comments or messages on your behalf.
It only reads what Facebook already shows you, in groups you already belong to, while you're looking
at the tab. If you want alerts the moment someone posts, this isn't that product on purpose —
background scanning is automation, and automation is what gets accounts and extensions banned.

**Built for**

Service businesses and freelancers scanning niche groups for "looking for a…" posts. Agencies sourcing
inbound-shaped leads without cold outreach. Founders who want to hear the problem stated in a
customer's own words. Community managers spotting the questions worth answering.

**Why it needs access to Facebook**

The extension's entire function happens on facebook.com: reading post text in a group feed you're
already viewing, and nowhere else. That permission grants no ability to send anything anywhere —
there is no code in this extension that opens a network connection.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `*://*.facebook.com/*` | The extension's core function — reading group post text already rendered in the user's own tab and evaluating it against the user's local rules — happens only on facebook.com. No other site is accessed, and no data is transmitted off-device. |
| `activeTab` | Identifying the active tab so the panel can show that tab's group status. |
| `storage` | Persisting the user's rules, matched posts, triage status/notes and export preferences locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |
| `sidePanel` | The rules list, matched-post list and export controls are a side panel, shown beside the Facebook page rather than covering it. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.
**Single purpose:** Read post text in Facebook groups the user belongs to, flag posts that match the
user's own local intent+topic rules, and let the user review, triage and export those matches — with
no account, no server and no action taken on the user's behalf.

## Screenshots (1280×800)

1. A group feed with a matched post showing the reason-chip badge
2. Side panel with the rules list, a starter pack row, and per-rule weekly hit counts
3. The matched-posts list with status buttons (new / replied / dismissed) and a note
4. The rule editor, showing the match/topic/ignore fields
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
