# Web Store Listing — LinkedIn Feed Focus & Algorithm Control

## Name

LinkedIn Feed Focus & Algorithm Control

## Summary (132 characters max)

Hide promoted posts, suggestion modules, trending news and reaction counts on LinkedIn — one popup, a handful of toggles.

## Description

LinkedIn's feed algorithm inserts a lot you didn't ask for: sponsored posts, "People you may know"
and "Add to your feed" suggestion modules, a trending-news rail, and reaction counts that turn every
post into a social-comparison exercise. LinkedIn's own settings don't offer a persistent way to turn
any of that off.

**Feed Focus does one thing: it hides what's already on the page.** Six independent switches, one
popup, nothing to configure beyond flipping the ones you want:

- **Hide promoted posts** — no more sponsored content mixed into your feed
- **Hide "People you may know"** — no more suggestion modules pushing you to grow your network on
  LinkedIn's schedule, not yours
- **Hide trending news** — no more "LinkedIn News" rail pulling your attention sideways
- **Hide suggested posts** — favors people you actually follow over LinkedIn's own algorithmic picks,
  where LinkedIn's page makes that detectable
- **Hide reaction counts** — for anyone who finds the like tally more anxiety-inducing than useful.
  Off by default; your ability to react, comment, repost and send never changes
- **Focus mode** — widens the reading column and quiets the visual noise around it

**No account. No backend. No network requests, anywhere — this extension only hides what's already
rendered on your screen. It never reads your profile, your connections, or your messages, and it
never posts, likes, follows, connects or messages on your behalf.** Every hide is instant and
instantly reversible — flip a toggle back and everything reappears exactly where it was.

If you've used Control Panel for Twitter, Minimal Theme for X, or Unhook for YouTube, this is the
same idea, built for LinkedIn — a platform that, as far as we could find, has nothing like it yet.

## Category

Productivity

## Permissions justification (for reviewer notes)

- `storage` — remembers your six toggle choices locally, nothing else.
- Host access to `linkedin.com` only — required to run the content script that hides feed elements;
  no other site is touched.
- No `activeTab`, no `tabs`, no `scripting`, no `downloads`, no `sidePanel` — none of the code uses
  them.

## Screenshots (to produce before submission)

1. LinkedIn feed with all six toggles active — promoted post, suggestion module, trending module and
   a reaction count all visibly absent compared to the default feed.
2. The popup itself, showing all six toggles and their descriptions.
3. Focus mode on vs. off, side by side.
4. Before/after of a single post row with reaction counts hidden vs. shown, action buttons visibly
   unaffected either way.

## Support

Read-only tool, no account required. Issues are almost always a LinkedIn layout change breaking one
selector — see `README.md`'s manual test checklist for how that's triaged; a broken selector degrades
to "hides nothing for that one feature," never to a broken page.
