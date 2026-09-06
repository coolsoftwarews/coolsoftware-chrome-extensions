# Chrome Web Store listing — X Keyword Mute & Filter List

## Name

`X Keyword Mute & Filter List`

## Short description (132 char max)

`Mute keywords, phrases and topics on X — regex, starter filter packs, and a hit count per rule. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Mute the words you never want to see on X again — with a visible reason on every hidden post, not a
silent void.**

X's own mute-word list is limited: no regex, no whole-word vs. substring control, no import/export, and
no way to see what it's actually hidden. This extension is a dedicated, more capable filter list, fully
local, built for anyone who actually cares about their feed's signal-to-noise.

**Write a rule — or enable a starter pack.** A rule is a single keyword or phrase, matched
case-insensitively by default. Choose **substring** (matches anywhere), **whole word** (won't match
inside a longer word), or a **regex** pattern for power users. Four starter packs — spoilers, politics,
crypto/NFT spam, engagement bait — get you a working filter list in one click. They're bundled with the
extension, not pulled from a server.

**Hidden, never deleted.** A matching post collapses to one line — `Hidden by filter: "crypto
airdrop"` — right where it was. Nothing vanishes silently, and a **Show anyway** click reveals it. No
keyword-matching tool is perfectly accurate; a visible placeholder is the honest way to handle that,
instead of pretending the matching is smarter than it is.

**Every rule shows its hit count** — all-time and today — so you can see whether a rule is doing
anything, or hiding far more than you expected. A rule that's clearly too broad gets flagged with a
one-time warning instead of quietly eating your feed.

**Export your whole rule list as JSON**, any time, and import it back on another machine.

**No account. No cloud. No automation.**

This extension makes no network requests at all — verify that in devtools in about ten seconds. It
never scans in the background, and it never likes, follows, replies to, reposts or messages on your
behalf. It only reads what X already shows you, in the tab you're looking at, and hides text locally
based on rules you wrote or picked.

**Built for**

Anyone fatigued by a specific topic — crypto spam, politics, a recurring drama cycle. Fans avoiding
spoilers during a show or game's release window. Founders and professionals keeping a work feed clean.
Power users who hit the ceiling of X's own mute-word list and wanted regex, whole-word matching, and a
list they can back up.

**Why it needs access to X**

The extension's entire function happens on x.com and twitter.com: reading post text already rendered
in your tab, and applying your own local rules to it. That permission grants no ability to send
anything anywhere — there is no code in this extension that opens a network connection.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `*://*.x.com/*`, `*://*.twitter.com/*` | The extension's core function — reading post text already rendered in the user's own tab and evaluating it against the user's local rules — happens only on these two hosts. No other site is accessed, and no data is transmitted off-device. |
| `storage` | Persisting the user's rule list and per-rule hit counts locally. |

No `activeTab`, `downloads` or `sidePanel` permission is requested. The toolbar UI is a standard popup;
rule-list export uses an in-page download link rather than the downloads API.

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.
**Single purpose:** Read post text on X, hide posts that match the user's own local keyword/phrase
rules behind a visible, dismissible placeholder, and let the user review and export those rules — with
no account, no server and no action taken on the user's behalf.

## Screenshots (1280×800)

1. A timeline with a matched post collapsed to its "Hidden by filter" placeholder, plus a "Show
   anyway" affordance
2. The popup's rule list, showing match mode chips and per-rule hit counts
3. The rule editor, showing the substring/whole-word/regex mode choice and case-sensitivity toggle
4. The starter packs row (spoilers, politics, crypto/NFT spam, engagement bait)
5. The "Data" sheet — export / import / clear, with the local-only message

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
