# PRD — YouTube Subscriptions

**Status:** Draft — **gated behind a discovery step, do not build yet**
**Build order:** #4 (last)
**Owner:** Gabriel
**Date:** 2026-08-15
**Type:** Chrome extension (MV3), standalone Web Store listing
**Backend:** None in V1
**Accounts:** None in V1

**Reference product:** [PocketTube: YouTube Subscription Manager](https://chromewebstore.google.com/detail/pockettube-youtube-subscr/kdmnjgijlmjgmimahnillepgcgeemffb)

---

## 1. One-line proposition

Make a 400-channel subscription feed usable again — group your channels, and watch one group at a time.

## 2. Why this one is last, and conditional

PocketTube validates the category *strongly* — which cuts both ways. Demand clearly exists, and an incumbent already serves it well with years of feature depth and a large install base. Shipping a thinner clone into that listing page is the weakest of the four bets.

**This PRD does not authorize a build.** It authorizes a 1-day discovery step (§4). Build only proceeds if that step identifies a specific, articulable gap. If it doesn't, this candidate is shelved and a new one takes its slot.

## 3. Target user

Heavy YouTube users with 100+ subscriptions whose feed has become unusable — a real and chronic pain, but one with low willingness to pay and no professional budget behind it. Note this is the only one of the four candidates with no business buyer.

## 4. Gate: the discovery step (do this before anything else)

One day, timeboxed. Produce a short findings note in this folder answering:

1. **Read PocketTube's 1★ and 2★ reviews** (and its competitors'). What do people actually complain about? Common candidates worth verifying: performance with large feeds, sync reliability, UI clutter, aggressive upsell, privacy concerns about account access.
2. **What does PocketTube require that users resent?** Account/OAuth? Cloud sync? A Pro tier for basics?
3. **Is there a "no account, purely local, fast" version of this** that a meaningful slice would switch to?
4. **How big is the switching cost?** Someone who has already grouped 300 channels will not redo it. Is import from PocketTube's export even possible?

**Proceed criteria:** a gap that can be stated in one sentence a user would recognize as their own complaint. Anything vaguer than that = shelve.

## 5. Provisional scope — V1 (only if the gate passes)

Written as a placeholder; the discovery step rewrites this section.

### In scope

- **Groups/collections** — assign subscribed channels to user-defined groups, drag-and-drop or checkbox assignment
- **Filtered feed** — view the subscription feed for one group at a time
- **Local-only storage** — groups live in `chrome.storage.local`, no account, no server
- **Manual export / import** — JSON file, so the user's grouping work is portable and never hostage to the extension
- **Fast** — must stay responsive at 500+ subscriptions; this is the most likely wedge against the incumbent

### Explicitly out of scope for V1

Cross-device sync, accounts, watch-later management, filtering by keyword, Shorts blocking, notification management, playback features, mobile.

## 6. Non-functional requirements

| Requirement | Target |
| :-- | :-- |
| Group switch → feed rendered | < 500 ms at 500 subscriptions |
| Initial subscription list load | < 3 s |
| Permissions | `storage`, `*://*.youtube.com/*` only. **No OAuth, no Google account access** — this is the positioning |
| Data | Never leaves the device |

## 7. Edge cases to handle

- 500+ subscriptions (performance is the wedge — treat it as a requirement, not a nice-to-have)
- Channels unsubscribed after grouping → orphaned entries need cleanup
- Channel renames / handle changes → key groups by channel ID, never by name
- SPA navigation and YouTube's virtualized feed lists
- YouTube's own feed DOM changes → isolated selector layer, fail soft to unmodified YouTube
- User has zero subscriptions → useful empty state

## 8. Success metrics (30 / 90 day)

| Metric | 30d checkpoint | 90d "keep investing" bar |
| :-- | :-- | :-- |
| Installs | 100 | 1,000 |
| 7-day retention | 35% | 45% |
| Users who create ≥ 1 group | 50% | 65% |
| Users who create ≥ 3 groups | 25% | 40% |

Group creation is the activation event. An install that never creates a group is a failed install.

## 9. Monetization posture

Weakest of the four. Consumer utility, incumbent gives away the basics, no business buyer. Assume zero revenue and justify the build purely as audience/learning — or don't build it.

## 10. Kill criteria

Fails the §4 gate → shelved immediately, slot goes to the next candidate from research.
Passes the gate but under 200 installs or under 25% 7-day retention at 90 days → stop.

## 11. Open questions

- Is there a lighter adjacent product hiding here — e.g. "hide Shorts + hide watched from the subscription feed" — that solves a sharper pain in a tenth of the code? The discovery step should look for this explicitly. It may be the better product.
