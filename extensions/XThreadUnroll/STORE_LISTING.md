# Chrome Web Store listing — X Thread Unroll & Reader Export

## Name

`X Thread Unroll & Reader Export`

## Single purpose

> Turn a thread the user is viewing on X into one clean, scrollable reading view — read from their
> own logged-in tab — and let them export it as Markdown or plain text, or copy it to the clipboard.

## Short description (132 char max)

`Unroll any X thread into a clean reading view, right in your tab. Export to Markdown or text. No account, no server, no republishing.`

## Category

Productivity → Workflow & Planning

## Detailed description

**"Unroll this thread" tools have a catch: they're not reading your tab.**

The popular ones work by fetching the thread with their own server and republishing it as a new
public page at their domain — which means anything only visible in your own session (a protected
account, a follow-gated reply) is invisible to them, and the result is a public copy the original
author never asked for and can't take down.

**This one works differently. It never leaves your browser.**

Click **Unroll** on the first post of any thread. A side panel opens showing every post in that
same-author chain, in order — avatar, text, media reference, date — auto-scrolling the page in small
steps to pull in whatever X hasn't loaded yet, and stopping on its own once nothing new appears.

**Honest, always.** X doesn't tell any tool the true size of a thread. So instead of guessing, this
extension tells you exactly what it read — "14 posts shown" — and separately flags it plainly when
more might exist, rather than inventing a fraction that sounds precise but isn't.

**Get it out however you want**

• **Copy to clipboard** — paste it straight into a note, an email, a doc
• **Markdown** — headers, quote blocks, links back to every post
• **Plain text** — for anywhere formatting doesn't matter

A reading-time estimate sits at the top of every unroll, so you know what you're getting into before
you start.

**No account. No cloud. No network. No republishing.**

This extension makes no network requests at all — verify that in devtools in about ten seconds.
Nothing you unroll is ever stored, either — the reading view lives only for the current session; if
you want to keep it, export or copy it.

**Built for**

Readers who'd rather read a thread as one document than scroll-and-click through it. Writers and
researchers pulling a thread's structure and wording into notes. Newsletter and curation accounts who
want to quote a thread accurately, without a third-party mirror sitting in between.

**What it doesn't do**

It never posts, replies, likes, reposts or follows on your behalf — read-only, always. It never saves
a library of past unrolls (that's a different tool). It never downloads images or video — a reference
and a count only. No PDF in this version — Markdown, plain text and copy, on purpose.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `x.com` / `twitter.com` | The extension's core function — reading a thread the user is viewing and adding the "Unroll" control — only happens on these two domains. No other site is accessed, and no data is transmitted off-device. |
| `activeTab` | Identifying the active X tab so the panel and the Unroll action target the right page. |
| `storage` | Persisting only the user's export-format preference and local usage counters. |
| `downloads` | Writing the exported .md/.txt file the user requests. |
| `sidePanel` | The reading view is a side panel. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** none of the categories apply — no data is collected or transmitted.

## Screenshots (1280×800)

1. A thread on X with the "Unroll" control visible on its first post
2. Side panel reading view — several posts rendered, reading-time estimate and post count visible
3. Auto-scroll in progress — the "Reading…" status with posts streaming in
4. The honest "More may exist" note on a thread X didn't fully load
5. The export row — format selector, Copy and Download

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
