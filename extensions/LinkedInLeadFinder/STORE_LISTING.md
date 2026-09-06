# Chrome Web Store listing — LinkedIn Engagement Lead Finder

## Name

`LinkedIn Engagement Lead Finder`

## Short description (132 char max)

`Collect commenters on a LinkedIn post, qualify them with your own keyword rules, export to CSV. No account, no cloud, read-only.`

## Category

Productivity → Workflow & Planning (alt: Business Tools)

## Detailed description

**The people commenting on posts in your market are already raising their hand.**

A title filter tells you who someone is. Engagement tells you what they're thinking about this week.
Someone who commented thoughtfully on a post about the exact problem you solve is a better prospect
than a matching job title who has never expressed the need.

Open any post's comment thread and a control appears:

**Collect commenters (34 visible)**

One click captures, per person, exactly what's already on the screen: name, headline, profile URL,
their comment, its reaction count, which post it came from, and the date. Nothing is scrolled,
expanded, or fetched for you — it only reads what you're already looking at.

**Qualify locally, see everything**

Add keyword rules — `founder`, `head of`, `hiring`, `looking for`, or your own — and matching leads
get a star. Rules never hide anything: you always see everyone you collected, starred or not.

**Built for repeat engagement**

The same person commenting on a second post you collect from doesn't create a duplicate — it merges
into one lead and shows **seen on 2 posts**. Repeat engagers are the strongest signal in the list.

**Search, filter, export**

Search by name, headline or comment text. Filter by status (new / shortlist / contacted / dismissed)
or qualified-only. Group by the post a lead came from. When you're ready, export to **CSV** — the
format that goes straight into a CRM or a sequence tool — or a readable **Markdown** list.

**No account. No cloud. No automation.**

This extension makes no network requests at all, and never will — verify that yourself in ten seconds
in devtools. It also never posts, likes, follows, connects with, or messages anyone on your behalf.
That's not a limitation we plan to remove; it's the boundary that keeps your LinkedIn account safe and
this extension in the Chrome Web Store. If you're looking for outreach automation or email
enrichment, this deliberately isn't it — see the README for why.

**Built for**

Founders selling B2B who want to find people already raising their hand. SDRs and sales reps building
a warm list without a Sales Navigator seat. Agencies sourcing prospects from a competitor's audience.
Recruiters finding people engaging with a role-relevant topic.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Identifying the active LinkedIn tab so the panel shows the leads collected and can refresh when a new collection happens. |
| `storage` | Persisting leads, qualification rules, statuses, notes and export preferences locally. |
| `downloads` | Writing the exported .csv/.md file and the JSON backup the user requests. |
| `sidePanel` | The lead list, search, filters, rules editor and export controls are a side panel. |
| Host access to `*://*.linkedin.com/*` | The extension's entire function happens on linkedin.com: adding a "Collect commenters" control under a post's visible comment thread and reading the comments already rendered there. No other site is accessed, and no data leaves the device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted off the
device. Everything read from linkedin.com is stored only in `chrome.storage.local`.

## Screenshots (1280×800)

1. A LinkedIn post's comment thread with the "Collect commenters (N visible)" control
2. The side panel: a lead list with star badges, status pills and a "seen on N posts" tag
3. The qualification rules editor
4. CSV export open in a spreadsheet, showing the deliverable columns
5. "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
