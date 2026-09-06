# Chrome Web Store listing — LinkedIn Job Application Tracker (read-only)

## Single purpose

Track job postings you're viewing on LinkedIn through a local pipeline — Saved, Applied,
Interviewing, Offer, Rejected, Withdrawn — with notes and export, so nothing leaves your account and
nothing leaves your device.

## Name

`LinkedIn Job Application Tracker`

## Short description (132 char max)

`Track LinkedIn jobs through a local pipeline — Saved to Offer — with notes. CSV/Markdown/JSON export. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Every LinkedIn extension out there is built for the person hiring. This one is built for the
person applying.**

Open any job posting on LinkedIn and click **+ Track this job**. It's saved instantly to your local
pipeline — title, company, location, posted date and salary range (when LinkedIn shows one), and a
direct link back to the posting.

**A real pipeline, not a bookmark list**

Move a tracked job through six stages — Saved · Applied · Interviewing · Offer · Rejected ·
Withdrawn — right from the confirmation card or the panel. Attach a note to any job (an interview
date, a recruiter's name, anything you want to remember) and see a plain "Updated 12 days ago" line
on every card, so nothing quietly goes stale without you noticing.

**Honest about what it can and can't know**

This extension never guesses whether you actually applied — moving a job to "Applied" is always your
own click, never an automatic detection of an Easy Apply flow it can't reliably verify. If a posting
you're tracking closes, it gets flagged the next time you revisit it — your notes and stage stay
exactly as you left them.

**Get it out whenever you want**

- **CSV** — one row per tracked job, every field, straight into a spreadsheet
- **Markdown** — grouped by stage, ready for Notion or Obsidian
- **JSON** — a full backup you can re-import later, on this machine or another one

**No account. No cloud. No network. No write actions on LinkedIn, ever.**

This extension makes no network requests at all — verify that in devtools in about ten seconds. It
never applies, connects, follows or messages on your behalf; the only thing it ever adds to a
LinkedIn page is its own Track button. Your pipeline lives in your browser's local storage — **Export
→ Import → Clear all** are one click away in the panel.

**Built for**

Active job seekers juggling more applications than a memory (or a messy spreadsheet) can track.
Career changers running parallel searches across very different roles. New grads starting a first job
search with no existing system. Anyone tired of losing track of what stage a posting is actually at.

**Why it only asks for access to LinkedIn**

The track button and everything it reads only exist on linkedin.com. This extension has no reason to
run anywhere else, and it doesn't ask to.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `*.linkedin.com` | The extension's entire function is capturing job postings the user is already viewing on LinkedIn. Scoped to this one site; no broader host access is requested. |
| `activeTab` | Identifying the active LinkedIn tab so a track action applies to the posting the user is looking at. |
| `storage` | Persisting the tracked-job pipeline, stages, notes and export preferences locally. |
| `downloads` | Writing the exported .csv/.md/.json file the user explicitly requests. |
| `sidePanel` | The job tracker — pipeline, notes, export — is a side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** no data is collected or transmitted off-device; none of the Chrome Web
Store data-usage categories apply.

## Screenshots (1280×800)

1. A LinkedIn job posting with the "+ Track this job" button
2. The confirmation card — stage dropdown and inline note field
3. Side panel: jobs grouped by stage, with the "days since last update" line visible
4. A stale-flagged card next to an active one
5. The "Data" sheet — CSV/Markdown/JSON export, import and clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
