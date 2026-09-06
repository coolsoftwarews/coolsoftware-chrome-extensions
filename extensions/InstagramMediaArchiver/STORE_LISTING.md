# Chrome Web Store listing — Instagram Media Archiver

## Single purpose

Save the photos and videos from your own Instagram posts to your device in one click — restricted,
by an in-code ownership check, to posts the logged-in account itself authored.

## Name

`Instagram Media Archiver`

## Short description (132 char max)

`Save your own Instagram posts' photos & videos in one click. Ownership-gated — never someone else's content. No account, no cloud.`

## Category

Productivity → Workflow & Planning

## Detailed description

**Instagram has no bulk "download my media" button. This is that button — for your own posts only.**

Open a post you posted yourself and a **Save** button appears next to its like/comment/share row.
Click it and the original photo or video downloads straight to your device, at the same quality
Instagram already served to your browser — no re-encoding, no re-hosting, no server in between.

**Carousels save slide by slide.** A multi-image post gets one Save button per slide, so you choose
exactly which images to keep.

**This is not a tool for saving other people's posts, and it can't be turned into one.**

Every single post is checked before a Save button is ever shown: the extension reads your logged-in
handle from Instagram's own navigation and the post's author handle from that post's own header. If
they don't match — or if either can't be confidently read — no button appears. Not a setting, not a
toggle, not a "power user" mode. There is no code path in this extension that offers Save on a post
you didn't post.

**Why that's a feature, not a limitation**

A generic "save any post" extension is a copyright and ToS problem no matter how it's marketed, and
it's exactly the kind of listing the Web Store routinely removes. Instagram's own "Download your
information" export is slow, bundles everything into one dump, and re-encodes your media — it's not
a "grab this one photo I just posted" tool. This extension is that tool, and the restriction to your
own account is what makes it a legitimate, narrow, genuinely useful thing instead of a scraper with a
nice icon.

**A local record of what you've saved**

A small local log tracks what you've archived — post URL, date, media type, filename — so you don't
have to reopen every post to check. Export it as CSV or JSON any time from the toolbar popup, or
clear it entirely. Nothing in the log, or anywhere else in this extension, ever leaves your device.

**Built for**

Creators and small businesses who want a local, original-quality backup of what they've already
posted. Anyone who lost the original file and needs to recover one specific post's media without
requesting Instagram's full account archive.

**Why it only asks for access to Instagram**

The Save button and the ownership check it depends on only exist on instagram.com. This extension has
no reason to run anywhere else, and it doesn't ask to.

## Permission justifications (for review)

| Permission | Justification |
| :-- | :-- |
| Host access to `*.instagram.com` | The extension's entire function — reading a post's media and its author handle, and the logged-in handle from Instagram's own nav — happens on this one site. No broader host access is requested. |
| `activeTab` | Identifying the active Instagram tab so Save applies to the post the user is looking at. |
| `downloads` | Writing the saved media file, and the exported .csv/.json log, that the user explicitly requests. |
| `storage` | Persisting the local archive log (post URL, filename, date, media type) on-device. |

**Remote code:** none. All code is bundled in the package; no eval, no remote scripts.
**Data usage disclosures:** no data is collected or transmitted off-device; none of the Chrome Web
Store data-usage categories apply.

## Screenshots (1280×800)

1. A user's own post with the Save button next to the action row
2. A carousel post with one Save button per slide
3. Someone else's post, shown side-by-side with a user's own — no Save button on the former
4. The toolbar popup: the local archive log with Export CSV / Export JSON / Clear all
5. A successful save, button reading "Saved", and the file in the Downloads folder

## Support and privacy links

- Privacy policy: publish [PRIVACY.md](PRIVACY.md) at a stable URL
- Support: repository issues page
