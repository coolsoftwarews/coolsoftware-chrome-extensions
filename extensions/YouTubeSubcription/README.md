# Subscription Groups & Stats for YouTube

Group your YouTube subscriptions and watch one group at a time.

Implements [PRD-04](../../docs/extensions/PRD-04-youtube-subscriptions.md) §5 (provisional V1 scope).
**The PRD gates the build behind the §4 discovery step, which has not been run.** This
build exists so the discovery step can be argued against something real; treat the
positioning as unvalidated until that note lands.

## The positioning

No account. No OAuth. No server. The extension reads your subscription list the same
way the YouTube page you are already signed into does, and stores your groups in
`chrome.storage.local`. Nothing leaves the device, and your grouping work is
exportable to a JSON file at any time so it is never hostage to this extension.

## The tab rule

**Managing groups must never cost the user their tab.** The manager lives in a
**side panel**: it sits beside the page rather than over it, so the feed stays
visible and whatever is playing keeps playing, and it stays open while you
browse — filing channels as you go is not a sequence of open-click-close.

The manager is one component ([src/manager/manager.ts](src/manager/manager.ts))
mounted by three hosts:

| Host | When |
| :-- | :-- |
| [Side panel](src/sidepanel/sidepanel.ts) | Primary. Toolbar click, and the picker's "Manage all groups". |
| [Options page](src/options/options.ts) | **The guide** — quick start, walkthroughs, known limits, troubleshooting, privacy. Not a manager. |

The manager ships its own stylesheet and assumes no page styles, which is what
lets one component serve the panel and, previously, the options page.

The options page is now **the guide** instead. It was a second copy of the
manager — a third way to do what the panel does — and the browser opens it on
install, where an empty manager teaches nothing. A guide is what someone
reaching for "Extension options" is actually looking for, and it doubles as the
Web Store listing's support page. Its content is data at the top of
[options.ts](src/options/options.ts): adding a walkthrough or a limitation is
one entry, not a hunt through markup. `WALKTHROUGHS` is empty until real videos
exist — the page says so rather than showing placeholder cards.

**What lives in the page is now only what has to.** The "add to group" button
beside Subscribe, the subscribe-time picker, and the feed filter's hiding rule.
Group switching is the eye button in the panel; the in-page chip bar, the
overlay and the toolbar popup are all gone. Injected controls are the
part that breaks every time YouTube reshuffles its DOM — the panel is ours and
cannot be reshuffled underneath us.

## The panel shell

```
┌ toolbar — title + actions for the current screen ────────┬──────┐
│                                                           │ rail │
│  screen body — exactly one scrolling region               │  ▣   │ Groups
│                                                           │  ⚙   │ Settings
└───────────────────────────────────────────────────────────┴──────┘
```

**Groups** is the whole product: make groups, assign channels, and press the eye
on a group to show it. **Settings** holds everything that is neither.

A separate Feed screen existed briefly, listing the same groups again so you
could pick one to filter by. It was a screen's worth of interface for something
that is really one intent — *show me this group* — which the eye button now does
outright: it applies the filter and opens the subscription feed in one press.

Two rules, and they are what keep it usable at panel width:

1. **One screen fits one screen.** The panel never scrolls as a whole; the
   content region does. Anything else means two scrollbars and a toolbar that
   scrolls away. On the Groups screen the channel list is that region — groups
   are capped and yield the rest of the height to it.
2. **The toolbar is for the current screen; the rail is for navigation.**
   Refresh belongs to Groups, export belongs to Settings, neither is
   navigation. The first version had all six in one header row, where they
   meant nothing in particular.

The rail is on the right, matching the host browser's own panel controls and
leaving the left edge — where the eye starts — for content.

### No native dialogs

Group rename and creation happen in the row itself; deletion happens
immediately and the banner offers **Undo** for ten seconds.

Not a style preference. `prompt`/`confirm` were doing this job until the
browser's "Prevent this page from creating additional dialogs" checkbox turned
out to disable them *silently* — `confirm()` then returns false and `prompt()`
returns null with nothing shown, so Delete quietly stops deleting and Rename
quietly stops renaming, with no error and no way back until the panel is
reopened. A surface where you click Delete several times in a row is exactly
where a user meets that checkbox.

Undo rather than a confirmation step: a confirmation taxes every correct
deletion to guard against the occasional wrong one; undo taxes neither.
`restoreGroup` puts the group back under its original id, so nothing that
referenced it is orphaned.

### Adding a screen

Watch Later with its own filters is the obvious next one. It needs:

1. An entry in `SCREENS` in [manager.ts](src/manager/manager.ts) — id, title,
   and a 24×24 stroked icon path.
2. A `build…()` returning that screen's body, and a toolbar element for its own
   actions.

The shell needs no other changes: screens are built once and shown/hidden, so
switching back to Groups never re-renders 500 channel rows.

Given room — the options page — the Groups screen switches to a two-column
grid rather than stretching a panel-shaped column across a monitor.

## How it works

| Piece | File | Notes |
| :-- | :-- | :-- |
| Subscription list | [src/subscriptions.ts](src/subscriptions.ts) | Fetches `/feed/channels` with the user's own session and parses `ytInitialData`. No Data API, no token. Stats are classified by content, not field name — YouTube currently stores the @handle in `subscriberCountText`. |
| Persistence | [src/storage.ts](src/storage.ts) | One storage key, atomic reads, `onChanged` fan-out to every surface. Unsubscribed channels are pruned from groups on each refresh. |
| DOM assumptions | [src/selectors.ts](src/selectors.ts), [channel-context.ts](src/content/channel-context.ts) | Every YouTube selector lives in these two files and nowhere else. Channel identity resolves URL → cached handle map → live DOM → embedded JSON, in that order: **YouTube does not remove the previous page's `ytInitialData` on SPA navigation**, so script text is the least current source, not the most authoritative one. |
| Feed filtering | [src/content/feed-filter.ts](src/content/feed-filter.ts) | Each item classified once *per video* into a data attribute, then group switching is a `Set` lookup + class toggle. Mutations coalesced into one rAF. Resolution order: channel link → @handle → `videoId` via the Atom-feed map. |
| Orphan handling | [src/content/lifecycle.ts](src/content/lifecycle.ts) | On extension reload/update, running content scripts are orphaned and every `chrome.*` call throws. We detect it, remove our own UI and stop, instead of leaving dead controls on the page. |
| Manager | [src/manager/manager.ts](src/manager/manager.ts) | Group CRUD (inline, no native dialogs), channel assignment with stats, sort, search, members filter, export/import, and a per-group **eye** that applies the filter and opens the feed. Host-agnostic — see the hosts above. |
| Group button | [src/content/group-button.ts](src/content/group-button.ts) | Standing "Add to group" pill beside Subscribe on watch and channel pages. Doubles as a status readout — the label names the groups the channel is already in. Mounts on a bounded decaying retry (6 attempts over 6 s) that stops on success, plus a fallback scan for when YouTube renames a header element. |
| Subscribe hook | [subscribe-watcher.ts](src/content/subscribe-watcher.ts), [group-picker.ts](src/content/group-picker.ts) | One delegated capture listener; on a *new* subscription, the same popover opens unprompted. |
| Panel plumbing | [open-manager.ts](src/content/open-manager.ts), [background.ts](src/background.ts) | A content script cannot open the side panel itself, so it asks the service worker, which must be inside a user gesture — the click that got us there. |

### Channel stats

The manager sorts by subscriber or video count, and shows both — with the
@handle — in each row's hover tooltip rather than on screen. At panel width
they cost a line each, and they are read at most once per channel, when you are
deciding where it belongs; the name is read on every pass. Both ride along in
the subscription scrape, so they cost no extra requests. YouTube's own
localised strings are displayed; the parsed numbers exist only for sorting, and
a count we cannot parse sorts **last** rather than as zero — it is unknown, not
empty. Verified against `9.2M subscribers`, `1,234,567`, `9,2 Mio.`,
`9 200 abonnés` and `No videos`.

"Last upload per channel" was considered and dropped: it needs one fetch per
channel (~400 on a heavy account) and a cache/refresh layer, for a signal the
grouping decision rarely turns on.

### Filing a channel from the page

Two paths to the same popover, because they answer different questions:

- **"＋ Add to group"**, a standing pill next to Subscribe on every watch and
  channel page. This is the discoverable one, and the only one that works for a
  channel you subscribed to a year ago. Its label reports current membership
  (`✓ Marketing`, `✓ 3 groups`), so the page answers "is this filed?" itself.
- **At subscribe time**, the same popover opens on its own. Grouping is done in
  bulk once; after that every new subscription lands ungrouped and the groups
  rot, and the moment of subscribing is when the user already knows where the
  channel belongs.

Either way the popover can create a group and assign to it in one action. The channel is written into
the local cache from the page DOM, so it is assignable before the next full
scrape. Toggle it off with "Ask which group when I subscribe" in the manager
footer.

The prompt fires on a **change** from unsubscribed to subscribed, comparing the
state before the click with the state after — not on the after-state alone.
Two bugs made the first version never fire at all:

1. It checked the element it captured on click. YouTube *replaces* the subscribe
   button when its state changes, so that element is detached a moment later,
   and a detached node says "Subscribe" forever. It was asking a copy of the
   past. It now re-finds the live button.
2. It read the first `[aria-label]` inside the button. Once subscribed, YouTube
   adds a notification bell in the same container, so that first label becomes
   "Notification settings" — matching nothing. It now reads every label.

If the state can't be read at all (a localised UI defeats the text test), the
before/after comparison sees no change and stays silent: a missed prompt is a
minor annoyance, a prompt while unsubscribing is a bug the user notices.

### Charts & table

Settings → **Charts, table & export** is one filter row — group, period, search
— with three things to do with it. Charts and Table draw
[the overlay](src/insights/viz.ts) over your YouTube tab: the same videos as a
stacked column chart (uploads per day, coloured by group), a ranked bar chart of
the most active channels, four stat tiles, and a sortable table. Export CSV
writes exactly what those filters describe.

The split is by **shape of control, not by feature**. Filters and toggles are
panel-sized, so they live in the panel; charts and tables need width, so they
render over the page. Neither surface duplicates the other, and the wire between
them is [`viz-state.ts`](src/viz-state.ts) — a storage key both read, so the
picture follows the controls with no message-passing handshake to get wrong.

An overlay, not a tab. The charts describe the feed *behind* them, and sending
someone to a separate tab to read about the tab they were in makes the feature
feel like a detour. It renders in a shadow root: YouTube ships thousands of
rules and a fair number of `!important`s, and the shadow boundary is what lets
the same component run in the panel's world and the page's without a defensive
stylesheet.

Pressing Charts from a non-YouTube tab focuses a YouTube tab, opening one if
there is none. The alternative was greying the toggles out, which makes the
feature blink in and out depending on where you happen to be standing.

Colour follows the data-viz method rather than taste:

- The categorical palette is the validated eight-slot set, assigned **in fixed
  order and never cycled**. Past six series the tail folds into "Other" — a
  generated ninth hue is indistinguishable under colour-blindness.
- Colour follows the **entity**, not its rank, so filtering does not repaint
  the survivors and force the reader to relearn the legend.
- Both modes were run through the validator (`scripts/validate_palette.js` in
  the data-viz skill): all checks pass, with a light-mode WARN that three slots
  sit below 3:1 on the light surface. The documented relief for that is visible
  labels or a table view — this has both, which is why every bar is directly
  labelled and the table is a first-class view rather than a fallback.
- The channel ranking is a **single hue**: it ranks magnitude, it does not name
  categories, so categorical colour there would be noise.
- Legend appears only for ≥2 series (one series is named by the heading), and
  legend entries toggle series off.

### Period filter, and reading dates in any language

The toolbar's period control (Any time / Today / This week / This month) filters
the feed by age, independently of the group filter — "my Marketing channels,
this week" is one question with two controls.

Dates come from the Atom feeds where we hold them, which is exact. Otherwise
they come from the only date a tile carries: the "5 days ago" line it prints.
That means reading the phrase in the reader's language, so
[src/dates.ts](src/dates.ts) holds one unit-stem list per language for 14 of
them.

Nothing matches whole phrases — the shape varies far more than the words
(`vor 5 Tagen`, `il y a 3 jours`, `5 dagen geleden`, `3日前`). It finds a number,
looks at the word beside it, and asks whether that word starts with a known
stem. Stems are sorted longest-first per language, because `Monat` and `Minute`
overlap in several of them and reading months as minutes is a filter that lies
rather than one that fails.

Language is detected from YouTube's own `<html lang>`; Settings → Feed language
overrides it when detection is wrong. A phrase that cannot be read leaves the
video **visible** — over-showing costs one video, over-hiding empties the feed
and looks broken.

### The 15-video ceiling

Every count in the insights overlay is bounded by the Atom feed: **~15 videos per
channel**. Over 30 days most active channels hit that ceiling, so a "most
active channels" ranking becomes a row of identical bars that is measuring the
limit rather than the channels.

The overlay says so rather than hiding it: bars at the ceiling read `15+`, a note
names how many channels are capped and suggests shortening the period, and the
default period is **7 days** — short enough that the cap rarely binds and the
ranking means something. The table's 1,000-row display cap is stated the same
way, pointing at Export CSV for the rest.

### Video export (CSV)

Settings → **Video export**: pick a group (or all subscriptions) and a window —
last 7/30/90 days, or the latest 100/200/500, or everything held — and get one
row per video:

```
published_at,channel,channel_id,handle,title,video_id,url,views,groups
```

It draws entirely on data already on the device, gathered during an upload
check, so an export costs no requests and works offline. The honest ceiling is
therefore **roughly the last 15 uploads per channel as of the last Refresh** —
the label under the control states the actual row count rather than implying
"last 7 days" is exhaustive. Up to 5,000 rows are kept; `chrome.storage` is not
an archive.

Views are as of the last check, not live. The file is written with a UTF-8 BOM
because Excel otherwise renders non-ASCII titles as mojibake, and every field is
quoted per RFC 4180 — channel names contain commas and quotes, titles contain
newlines, and an unquoted one silently shifts every following column.

### What the sorts are based on

Name is the only ordering that is true at all times. Last upload, subscribers
and video counts are all **a snapshot from the last Refresh**, so the channel
list says so under the controls — "Order, dates and dots come from the last
refresh, 23 min ago" — rather than leaving "sorted by last upload" to imply
"right now".

Sorts with no data behind them are **disabled rather than offered**. YouTube's
subscription page supplies a handle and a subscriber count, and only sometimes
a video count; an option that silently orders everything as "unknown" leaves a
list that looks sorted and is not. The row also shows the value it is ordered
by, because sorting by something invisible asks the reader to take the order on
faith.

### New uploads

Each channel's most recent upload comes from its public Atom feed:

```
https://www.youtube.com/feeds/videos.xml?channel_id=UC…
```

No key, no OAuth, no quota — and, uniquely in this codebase, a **documented
format** rather than markup we scrape. It is the one part a YouTube redesign
cannot break. See [src/uploads.ts](src/uploads.ts).

The cost is one request per channel, so it runs on the Refresh button rather
than on every panel open, six at a time, with progress in the banner. A channel
that does not respond is simply left unknown; one bad channel never fails the
batch.

"Seen" is tracked **per channel**, not per group. A channel's dot goes out
when you open that channel or watch one of its videos — which is what YouTube's
own dot does — and a group row shows how many of its channels still have one.

The first version marked a whole *group* as seen the moment it was shown, and
it was wrong in a way that only showed up in use: you open a group precisely to
find out what is new, so that act erased the answer before it could be read.
Dots existed and were never visible.

The first upload check seeds every channel as already seen. Otherwise all 99
would arrive dotted, which says nothing — "new" has to mean new since you
started using this, not "exists". A channel with no known upload date shows no
dot: claiming news we have not verified is worse than staying quiet.

### Why a video id is the last resort

Three kinds of tile name no channel we can read:

- **Collaborations** — "The Next New Thing and Leveling Up with Eric Siu" — a
  byline naming two channels and linking neither in a readable form.
- **Shorts**, which link only to `/shorts/<id>`.
- **Tiles caught mid-render**, before the byline exists.

All three used to fail soft to *visible*, so a filtered feed kept a few
strangers in it. They are now resolved through the `videoId → channel` map from
the Atom feeds — the same map built for Shorts. A video belongs to whichever
channel publishes it, and that channel's feed lists it, whatever the byline says.

Coverage is the last ~15 uploads per channel as of the last Refresh, which is
what a recency-ordered feed shows. Beyond that we are back to fail-soft.

### Filtering an infinite scroll

Two things get worse the further you scroll a filtered feed, and only one of
them is fixable.

**Fixable — the cost of a pass.** Every mutation burst used to re-decide every
tile on the page, and the page grows without bound. By tile 800 each burst was
re-deciding 800 tiles to discover nothing had changed. A tile now records what
it was decided *for* (`<filter>:<videoId>`) and settled tiles are skipped, so a
pass costs roughly what the new tiles cost. Unknown tiles are deliberately left
unsettled, so a later pass can try again once YouTube finishes rendering them.
Section-collapsing is skipped entirely on the Shorts tab, which has no shelves.

**Not fixable — the loading loop.** Hiding is how this extension filters, and
YouTube loads more whenever the viewport is not full. So a group matching few
of the loaded Shorts will make YouTube keep fetching, which is the wall of grey
placeholders. It settles when enough matching items arrive or the feed ends.
The alternative — removing nodes instead of hiding them — is worse: the
virtualized grid owns those nodes and will fight anyone who detaches them.

### Shorts

Shorts **are** filtered by group, including on the `/feed/subscriptions/shorts`
tab. This is only possible because of the Atom feeds: a Shorts tile links to
`/shorts/<videoId>` and names no channel anywhere in its markup, so the page
alone cannot say whose it is — but each feed lists its channel's recent video
ids, giving a `videoId → channel` map. Coverage is therefore the last ~15
uploads per channel, which is what a recency-ordered Shorts feed shows anyway.

**Unknown Shorts are hidden while a group is applied** — the one place this
extension does not fail soft to visible. An unattributable Short is not a
near-miss to forgive; it is a stranger in a feed the user asked to be
exclusive. A false negative is fixed by pressing Refresh, which is
discoverable; a wall of unfiltered Shorts has no fix.

There is no "hide Shorts entirely" setting. It existed, and did nothing that
group filtering was not already doing better: with a group applied, Shorts are
filtered like everything else, and with no group applied the user has asked to
see their subscriptions — all of them.

A Shorts block is recognised by what it *links to*, not by
`ytd-rich-shelf-renderer[is-shorts]`, which YouTube does not reliably set —
that attribute is why Shorts kept sailing through a filtered feed.

### Where the button attaches (learned from PocketTube)

Anchor to the **actions row container**, never to the Subscribe button:

| Layout | Container |
| :-- | :-- |
| Channel, 2024+ | `ytd-browse[page-subtype="channels"] #page-header yt-flexible-actions-view-model` |
| Channel, older | `#channel-header-container #buttons.ytd-c4-tabbed-header-renderer` |
| Watch | `ytd-watch-metadata #owner` |

PocketTube targets the same two channel-page containers, and it is right to:
the row's *contents* vary per channel — Join and Community appear only
sometimes — so "insert next to Subscribe" produces a different visual slot on
every channel. Appending to the row gives one position, always last, everywhere.

Two placement strategies were tried and abandoned before this: measuring
available width (made the choice depend on *when* it ran during hydration) and
cloning the neighbouring slot's class name (still landed us outside the row).

**Coexisting with other extensions.** PocketTube appends to the same row, so on
a fresh load which of us lands first is a race, and it resolved differently
every reload. Our button carries `order: 99`, which renders it last regardless
of DOM order. Ordering visually rather than structurally is deliberate: moving
another extension's node would start a fight neither side wins, and YouTube's
own controls sit at the default `order: 0`.

### Failure posture

Every degradation path leans towards *unmodified YouTube*:

- A feed item whose channel cannot be identified is **hidden while a group is
  applied**. In practice these are collaborations — "Microsoft Developer and 2
  more", "Sabaton and 3 more" — where the printed name is a collaborator and the
  uploading channel may not be one the user follows at all. Nothing in the tile
  identifies it, so it belongs to no group by any reading.
- The safety valve for that is measured **over the page, not per pass**: if we
  resolve *nothing at all* across 20+ items, our selectors have stopped
  matching and everything is shown instead, because a broken filter must
  degrade to plain YouTube rather than to an empty page. Judging it per pass
  was visibly wrong — scrolling into a run of nine old collaborations tripped
  it and unfiltered the whole feed.
- A missing feed anchor means no group bar, not a thrown error.
- `saveChannels` ignores an empty scrape result, so a failed fetch can never wipe
  the groups by way of orphan cleanup.
- Hiding uses a CSS class, never node removal — YouTube's virtualized grid owns
  those nodes.

## Debugging on the page

YouTube's console is full of other people's noise — other extensions log there
too, and `403`s, CORS complaints from doubleclick, and `Timeout waiting for
element` lines are **not** from this extension (ours are all prefixed
`[subscription-groups]`). To tell whether our content script is even running,
look for its one unconditional line on load:

```
[subscription-groups] loaded on /@somechannel
```

No line = the content script isn't injected: reload the extension at
`chrome://extensions`, then hard-reload the YouTube tab (content scripts are
not injected into already-open tabs on install).

Everything else is opt-in, per tab:

```js
localStorage.ysgDebug = '1'   // in the YouTube tab's console, then reload
```

## Build

Requires Node 18+ (the build scripts use top-level await and `fs.cp`).

```bash
npm install
npm run icons        # regenerate icons/ (dependency-free PNG writer)
npm run typecheck
npm test             # the two parsers, bundled through esbuild and checked
npm run build        # → dist/, loadable via chrome://extensions → Load unpacked
npm run build:watch
npm run zip          # → release/<name>-<version>.zip for the Web Store
```

`dist/`, `release/` and `icons/` are generated and git-ignored.

## Scope

In: groups, filtered feed, local-only storage, JSON export/import, speed at 500+ subs.

Out of V1, per the PRD: cross-device sync, accounts, watch-later, keyword filters,
Shorts blocking, notifications, playback, mobile.

## Beyond the PRD

Three additions the PRD does not cover — the tab rule, channel stats and the
subscribe-time picker — are all product decisions taken during the build, not
PRD scope. Worth folding back into §5 if the §4 gate passes; the subscribe hook
in particular is a plausible answer to "why switch from PocketTube", since it
attacks the *maintenance* cost of grouping rather than the initial setup.

## Not yet done

- **Import from PocketTube's export** — PRD §4.4 calls switching cost the decisive
  question. `importGroups` is written to merge rather than replace, so a PocketTube
  converter can be added as a pure input adapter without touching storage.
- **Drag-and-drop assignment and group reordering in the UI.** `reorderGroups`
  exists in storage; nothing calls it yet. Checkbox assignment is wired.
- The performance targets in PRD §6 (< 500 ms switch, < 3 s initial load) have not
  been measured against a real 500-subscription account.
