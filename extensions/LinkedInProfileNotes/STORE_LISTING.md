# Chrome Web Store listing — LinkedIn Profile Notes

## Name

`LinkedIn Profile Notes — Local CRM-lite`

## Short description (132 char max)

`A private note on any LinkedIn profile you visit. No account, no CRM, no cloud — just your own memory of who's who.`

## Category

Productivity → Workflow & Planning (alt: Business Tools)

## Detailed description

**Every LinkedIn extension worth installing wants you to sign up for something else first.**

folk, Lusha, Dux-Soup, Lemlist, the Salesforce and HubSpot connectors — install any of them and
the extension itself isn't the product. It's a capture funnel into a CRM or sales platform you now
have to pay for and manage. That's a fine business for them. It's a real cost if all you wanted was
to remember who you're talking to and why.

**LinkedIn Profile Notes does one thing: it remembers.**

Visit any profile and a small **+ Note** control appears next to their name. Click it, write
whatever you'd actually want to remember — "met at the SaaS conference, following up in a month,"
"strong candidate, weak on SQL" — add an optional one-line tag if you want one, and it saves
itself. No save button. No modal blocking the page.

**Come back later and it's right there.**

Revisit a profile you've noted and your note is already showing, with a quiet "last noted: 3 days
ago" line so you don't have to open anything to remember why this person matters. The side panel
is there when you want to browse everyone you've noted — search, sort by recency or name, filter
by tag — but the extension pays off before you ever open it.

**Zero setup, on purpose.**

No account. No sign-in. No CRM to configure. No monthly fee. Everything lives in your browser, on
your device, and nowhere else — verify that yourself in ten seconds in devtools' Network tab; there
are no requests to see.

**When you're ready to leave, take your notes with you.**

Export everything to CSV for a spreadsheet, or a full JSON backup you can import into another
install. Clear everything in one click, any time.

**What this deliberately isn't.**

It never resolves an email address or phone number — that's a different legal category, and the
exact ground every enrichment tool operates on. It never visits, scrapes, or notes a profile you
didn't open yourself. It never posts, likes, follows, connects with, or messages anyone on your
behalf. If you're looking for outreach automation or a real CRM with pipeline and sequencing, this
isn't it, on purpose — this is the tool for everyone that overkill was built for.

**Built for**

Recruiters doing light sourcing who need to remember which candidates they've already looked at.
Job seekers tracking who they've reached out to during a search. Freelancers and consultants
keeping light notes on client contacts without opening a CRM for a handful of relationships. Anyone
who's ever met someone once on LinkedIn and wished they'd written down why it mattered.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| `activeTab` | Identifying the active LinkedIn profile tab so the note control attaches to the right profile. |
| `storage` | Persisting notes, tags and export preferences locally. |
| `downloads` | Writing the exported .csv file and the JSON backup the user requests. |
| `sidePanel` | The note library — search, sort, tag filter and export controls — is a side panel. |
| Host access to `*://*.linkedin.com/*` | The extension's entire function happens on linkedin.com: reading a profile's own displayed name and headline, and adding the "+ Note" control near it. No other site is accessed, and no data leaves the device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted off
the device. Everything read from linkedin.com is stored only in `chrome.storage.local`.

## Screenshots (1280×800)

1. A LinkedIn profile with the "+ Note" control and an open note editor
2. A revisited profile showing an existing note and the "last noted: 3 days ago" indicator
3. The side panel: searchable, taggable note library
4. CSV export open in a spreadsheet, showing the deliverable columns
5. "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
