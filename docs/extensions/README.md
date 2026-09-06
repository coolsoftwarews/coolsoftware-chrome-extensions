# Portfolio notes

This is not a PRD and not a restatement of any extension's own README. It's an index of the
code shapes that show up in more than one extension in this repo, verified against the actual
source (not just README prose) as of this writing. Every extension here is still fully
standalone — own `package.json`, own build, own `chrome.storage.local` keys, no shared npm
package, no shared runtime. "Shared" below means one of two things, and each entry says which:
literally the same file, ported byte-for-byte, or the same shape independently reimplemented
per PRD ("wearing a different platform's clothes").

Where a claimed cross-reference didn't hold up against the source, that's noted plainly instead
of glossed over.

## Shared modules

### The Saver pattern

Origin: [WebHighlighter](../../extensions/WebHighlighter) `src/storage.ts` — one
`chrome.storage.local` key per item (`wh:page:<url>`), `readPage`/`writePage`/`deletePage`, a
per-key mutation queue, `exportBackup`/`importBackup`/`clearAllData`, `quotaStatus` at an 80%
warn ratio, `readOptions`/`writeOptions`.

Reused, confirmed against each extension's own `src/storage.ts`:

- [InstagramResearchSaver](../../extensions/InstagramResearchSaver) — `irs:post:<id>` records
  plus a `collections` array (`irs:collections`); same save/export/import/clear/quota shape.
- [PinterestCompetitorResearch](../../extensions/PinterestCompetitorResearch) — same shape over
  pins; import/merge logic is factored into its own `merge.ts` (`mergeImport`/`validateBackup`)
  rather than inlined in `storage.ts` the way WebHighlighter and InstagramResearchSaver do it.
- [XConversationSaver](../../extensions/XConversationSaver) — adds a third record family
  (`xcs:people`, per-person notes) alongside items/collections; also uses a standalone `merge.ts`.
- [XBookmarkOrganizer](../../extensions/XBookmarkOrganizer) — batches writes: `indexBookmarks`
  reads and writes the whole item table once per scroll pass instead of once per bookmark.
  Otherwise the same collections/export/import/clear/quota shape.
- [LinkedInJobTracker](../../extensions/LinkedInJobTracker) — swaps the collections axis for a
  fixed `stage` field (`changeStage`, `isStage`); there is no `collections` key at all here.

All five keep: one key-prefix family per item, a `readAll*`, a `save*`/`write*` that throws a
"storage is full — export and remove a few, then try again" error on quota failure rather than
swallowing it, `exportBackup`/`importBackup` matched by id (importing the same file twice never
duplicates), `clearAllData`, and `quotaStatus`. This is a genuinely and consistently followed
shape, not a superficial resemblance.

### Outlier engine

No single origin file — the shape (a median baseline over a loaded sample, a ratio badge
against it, and an explicit refusal/downgrade when the sample is too thin to trust) is
independently reimplemented per PRD, not copy-pasted. Thresholds, band names and the
reliability rule all differ across implementations.

Confirmed real in:

- [InstagramOutlierFinder](../../extensions/InstagramOutlierFinder) `src/outlier.ts` — bands
  `fire5`/`fire2`/`up`/`flat` at 5×/2×/1.5×, `MIN_RELIABLE_SAMPLE`.
- [TikTokCreatorOutliers](../../extensions/TikTokCreatorOutliers) `src/outlier.ts` — bands
  `fire`/`up`/`flat` with its own thresholds, a `lowSample` flag on the computed snapshot.
- [LinkedInPostOutliers](../../extensions/LinkedInPostOutliers) `src/outlier.ts` — per-author
  baseline; adds a two-pass `robustMedian` exclusion step the Instagram version doesn't have.
- [XVelocityFinder](../../extensions/XVelocityFinder) `src/velocity.ts` — same ratio-against-
  median idea applied to engagement *per hour since posting* rather than a raw count, against a
  rolling window of the author's last 20 samples rather than "whatever's currently loaded."
- [TikTokProductScout](../../extensions/TikTokProductScout) `src/outlier.ts` — per-creator
  baseline with an explicit `confidence: 'pending' | 'low-sample' | 'reliable'` field.
- [PinterestOpportunityFinder](../../extensions/PinterestOpportunityFinder) `src/outlier.ts` —
  no fire/up bands; degrades straight to a rank-based badge when the sample isn't trustworthy
  (`MIN_USABLE_FRACTION`, `MIN_SAMPLE_SIZE`).
- [LinkedInCreatorWatchlist](../../extensions/LinkedInCreatorWatchlist) `src/outliers.ts` —
  the simplest version: a ratio per post against its own author's median, no bands, no glyphs.

[YouTubeProFilters](../../extensions/YouTubeProFilters) also computes an `outlierRatio`
(`src/lib/filters.ts`) against a channel's median view count, but that median comes from a
guaranteed ~30-video network fetch rather than a possibly-thin local sample, so it carries no
sample-size/reliability flag — a lighter variant, not the full pattern.

Common thread across the seven full implementations: `median()` over a same-shaped values
array, `ratio = value / median`, a display cap around 20×, and an explicit downgrade when the
sample is too thin — "sample-size honesty" is real, though every extension names and
thresholds it independently rather than sharing a literal file.

### Rules engine

No shared file. [FacebookGroupOpportunities](../../extensions/FacebookGroupOpportunities)
`src/rules.ts` (two-part intent+topic matching — `evaluateRule`/`evaluatePost`, hit-count
summaries, `isUsableRule`, `parseTokenList`, `normalizeText`) and
[XKeywordMute](../../extensions/XKeywordMute) `src/rules.ts` (single-signal — one value,
`substring`/`whole-word`/regex mode, `compileRule`/`matchPost`, `isRuleTooBroad`, `isUsableRule`,
`parseTokenList`, `normalizeText`) are independent, parallel implementations of the same shape;
each file's own header comment cross-references the other.

Shared: pure/DOM-free rule evaluation (both exercised headlessly by `scripts/selftest.mjs`), an
`enabled` flag per rule, a bundled `starter-packs.ts`, and per-rule hit tracking surfaced back to
the user (Facebook's `summarizeHits`, XKeywordMute's per-rule counter plus `isRuleTooBroad`).
XKeywordMute's README calls itself "a deliberately simpler, single-signal form" of Facebook's
two-part rule — the source bears that out exactly.

[XFeedDeclutter](../../extensions/XFeedDeclutter) does **not** belong to this family, despite
also being a "filter the feed" product. Its `src/rules.ts` is a fixed set of five boolean
toggles (`shouldHideNode`, `shouldForceFollowingTab`) — no keyword/phrase matching, no rule
list, nothing user-authored. Its own README doesn't actually claim the Rules-engine shape
either; it links to this doc only for the portfolio's generic constraints (below), not for this
pattern.

### PDF writer

Origin: [YouTubeTranscription](../../extensions/YouTubeTranscription) `src/pdf.ts` —
`generatePdf`, a dependency-free PDF 1.4 writer using the two standard Helvetica faces,
WinAnsi-only with unsupported-character reporting back to the caller.

[WebHighlighter](../../extensions/WebHighlighter) `src/pdf.ts` and
[UniversalReaderMode](../../extensions/UniversalReaderMode) `src/pdf.ts`, diffed line-for-line
against the origin, are **functionally identical**: every function, constant and line of code is
the same. The only differences anywhere in the three files are in comments — each copy's doc
comments describe its own product's export path instead of re-explaining the algorithm, and
UniversalReaderMode drops one inline comment about a timestamp gutter it has no use for (it
formats articles, not transcripts). This is a genuine unmodified port, not just a similar shape.

### Data-ownership rule

As stated by [LinkedInFeedFocus](../../extensions/LinkedInFeedFocus)'s README: "everything the
user creates is theirs — export all / import / clear all, in every product that stores
anything."

Confirmed:

- [WebHighlighter](../../extensions/WebHighlighter) `src/storage.ts` —
  `exportBackup`/`importBackup`/`clearAllData`.
- [FacebookGroupOpportunities](../../extensions/FacebookGroupOpportunities) `src/storage.ts` —
  the same three, for rules and captured opportunities together.
- [LinkedInFeedFocus](../../extensions/LinkedInFeedFocus) itself is the documented, deliberate
  exception: its only stored data is six toggle booleans, it carries no `downloads` permission,
  and "Reset to defaults" stands in for clear-all. No import or export exists, by design, and
  its README says so.
- [XFeedDeclutter](../../extensions/XFeedDeclutter) is a second self-documented exception, for
  the same reason as LinkedInFeedFocus (no `downloads` permission for five toggles and two
  counters) — its own `background.ts` comment and README both say so directly.

**Not confirmed for YouTubeTranscription.** FacebookGroupOpportunities' README previously claimed
it shares this "export/data-ownership shape" with YouTubeTranscription specifically.
YouTubeTranscription's `src/` has no `exportBackup`, `importBackup`, or `clearAllData` anywhere,
and its own README lists "no bulk ... export" as explicitly out of scope — it has per-item delete
(`forgetVideos` in `history.ts`, `deleteNote`/`deleteNotes` in `notes.ts`) and a "remove N videos
from history" confirmation, but nothing that exports or re-imports the whole library. The rule
does not hold for YouTubeTranscription, so FacebookGroupOpportunities' README has been corrected
to drop that cross-reference.

## Portfolio-wide constraints

Several extensions ([WebHighlighter](../../extensions/WebHighlighter),
[FacebookGroupOpportunities](../../extensions/FacebookGroupOpportunities),
[LinkedInFeedFocus](../../extensions/LinkedInFeedFocus),
[XFeedDeclutter](../../extensions/XFeedDeclutter),
[XKeywordMute](../../extensions/XKeywordMute)) independently state the same constraints in
their own README: no sign-in, no backend, no network requests of any kind, `chrome.storage.local`
only, read-only against the host platform, foreground-only (no background polling/automation),
minimum permissions, local-only usage instrumentation. This review did not check every one of
the 40+ extensions in this repo against that list — treat it as a strongly-attested pattern
across the extensions actually inspected here, not an audited guarantee for the whole portfolio.

