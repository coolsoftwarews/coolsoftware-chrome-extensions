# Privacy Policy — Pinterest Competitor Pin Research

**Last updated:** 2026-09-02

## The short version

This extension makes no network requests. Nothing you save, note or export is ever sent anywhere,
because there is nowhere for it to be sent — there is no server, no account and no analytics service
behind this product.

## What is stored, and where

Everything is stored in your browser's own local storage (`chrome.storage.local`) on this device:

| Data | Why |
| :-- | :-- |
| The pin's title, description, destination domain/URL, board, creator and saves count, as shown on the page when you saved it | The research card itself |
| A size-capped thumbnail (re-encoded locally via canvas), or the remote image URL when re-encoding wasn't possible | Shown in the panel and in the Markdown export |
| The note you write on a card, and which collection it's in | It's your research |
| Anonymous usage counters (e.g. "export_csv: 4") | So the developer can see which features are used |

The usage counters contain no pin URLs, no titles, no descriptions and no identifiers — only totals
and the dates the extension was used. They stay on your device like everything else, and you can read
them in the panel under **Usage** and reset them there at any time.

## What is never collected

No account, email address or name. No Pinterest login state or credentials. No browsing history
beyond the pins you explicitly choose to save. No advertising or tracking identifiers. Nothing is
sold, shared or transmitted, because nothing is transmitted at all.

## What this extension never does on Pinterest

It never pins, likes, follows, comments, messages or posts anything on your behalf. It only reads
what Pinterest has already rendered in your tab at the moment you click **+ Save to research** — no
API calls, no background crawling, no polling for new pins while you're not looking.

## Permissions, and what each is for

| Permission | Why it is needed |
| :-- | :-- |
| `*://*.pinterest.com/*` (host access) | Reading pins you choose to save and injecting the save button. This also covers Pinterest's regional subdomains (`de.pinterest.com`, `uk.pinterest.com`, …) — their older country-code domains (`pinterest.de`, `pinterest.co.uk`) redirect here automatically. No network capability is granted by this permission; it only lets the extension read the page. |
| `storage` | Saving your research cards, collections and notes locally |
| `downloads` | Saving the file when you export CSV, Markdown or JSON |
| `sidePanel` | The research panel — your library, search, export controls |
| `activeTab` | Letting the toolbar icon open the side panel |

## Your data is yours

**Menu → Export all data** writes every saved pin and collection to a single JSON file. **Import**
reads it back, on this machine or another one — pins are matched by id, so importing the same file
twice never duplicates a card. **Clear all data** deletes everything immediately and permanently.

Because storage is local and per-device, uninstalling the extension or clearing your browser data
removes your research library. Export a backup first if you want to keep it.

## Verifying this yourself

Open devtools on Pinterest with the extension active and watch the Network tab — you will see no
requests from the extension. The source is auditable: no `fetch`, `XMLHttpRequest`, `WebSocket` or
`sendBeacon` call exists anywhere in it.

## Contact

Questions about this policy: raise an issue on the extension's support page.
