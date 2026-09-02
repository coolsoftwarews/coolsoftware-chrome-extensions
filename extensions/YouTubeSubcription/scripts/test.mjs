#!/usr/bin/env node
/**
 * The parsers, checked against the shapes YouTube actually emits.
 *
 * These two are the extension's only real algorithms, and both failed in ways
 * that were invisible on screen: `"No videos"` parsed as `0`, and channel-ID
 * lookup returned the previously-visited channel. Everything else here is DOM
 * wiring that only a browser can exercise, so this is deliberately narrow
 * rather than a test suite for its own sake.
 *
 * Run with `npm test`. Modules are bundled through esbuild so the test runs
 * exactly what ships.
 */

import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Load a TS module by bundling it, so no test-only copy of the code exists. */
async function load(entry) {
  const bundled = await build({
    entryPoints: [resolve(root, entry)],
    bundle: true,
    format: 'cjs',
    write: false,
    platform: 'node',
  });
  const module = { exports: {} };
  new Function('module', 'exports', bundled.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

let failed = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} → ${actual}${ok ? '' : ` (expected ${expected})`}`);
}

/* ── Subscriber / video counts ───────────────────────────────────────── */

const { parseCompactNumber } = await load('src/subscriptions.ts');

console.log('parseCompactNumber');
for (const [input, expected] of [
  ['9.2M subscribers', 9_200_000],
  ['285K subscribers', 285_000],
  ['1.2B subscribers', 1_200_000_000],
  ['1,204 videos', 1204],
  ['1,234,567 subscribers', 1_234_567],
  ['48 videos', 48],
  // Locale forms: comma decimals, space thousands separators.
  ['9,2 Mio. Abonnenten', 9_200_000],
  ['9 200 abonnés', 9200],
  // Not numbers. "No videos" must not become 0 — unknown is not empty, and the
  // UI sorts unknowns last rather than pretending they are the smallest.
  ['No videos', null],
  ['Subscribers', null],
  ['', null],
  [null, null],
]) {
  check(JSON.stringify(input), parseCompactNumber(input), expected);
}

/* ── Channel identity from YouTube's bootstrap JSON ──────────────────── */

const {
  extractInitialData,
  channelIdFromInitialData,
  extractPlayerResponse,
  videoOwnerIdFromPlayerResponse,
  videoOwnerIdFromInitialData,
} = await load('src/yt-data.ts');

const payload = (obj) => `var ytInitialData = ${JSON.stringify(obj)};`;

console.log('\nchannelIdFromInitialData');
for (const [name, text, expected] of [
  [
    'current channel page',
    payload({
      metadata: { channelMetadataRenderer: { externalId: 'UCnewnewnewnewnewnewnew' } },
      header: { c4TabbedHeaderRenderer: { channelId: 'UCnewnewnewnewnewnewnew' } },
    }),
    'UCnewnewnewnewnewnewnew',
  ],
  [
    'older header layout only',
    payload({ header: { c4TabbedHeaderRenderer: { channelId: 'UClegacylegacylegacyleg' } } }),
    'UClegacylegacylegacyleg',
  ],
  [
    'microformat fallback',
    payload({ microformat: { microformatDataRenderer: { externalId: 'UCmicromicromicromicr' } } }),
    'UCmicromicromicromicr',
  ],
  [
    // The reason for a brace-counting parser rather than a regex: channel names
    // contain braces and escaped quotes.
    'braces and quotes inside a channel name',
    'var ytInitialData = {"metadata":{"channelMetadataRenderer":{"title":"a } tricky { \\" name","externalId":"UCbracebracebracebracex"}}};',
    'UCbracebracebracebracex',
  ],
  ['payload with no channel', payload({ contents: {} }), null],
  ['not a data script at all', 'console.log("channelId")', null],
  ['truncated / unbalanced JSON', 'var ytInitialData = {"metadata":{"channel', null],
]) {
  check(name, channelIdFromInitialData(extractInitialData(text)), expected);
}

const playerPayload = (obj) => `var ytInitialPlayerResponse = ${JSON.stringify(obj)};`;

const owner = (id) => ({
  contents: {
    twoColumnWatchNextResults: {
      results: {
        results: {
          contents: [
            { videoPrimaryInfoRenderer: {} },
            {
              videoSecondaryInfoRenderer: {
                owner: {
                  videoOwnerRenderer: {
                    navigationEndpoint: { browseEndpoint: { browseId: id } },
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
});

console.log('\nvideoOwnerIdFromPlayerResponse');
for (const [name, text, videoId, expected] of [
  [
    'the video being watched',
    playerPayload({ videoDetails: { videoId: 'XmPk1qwO4N0', channelId: 'UCownerownerownerowner' } }),
    'XmPk1qwO4N0',
    'UCownerownerownerowner',
  ],
  [
    // The whole reason for the check: navigating leaves the previous video's
    // payload in the document, and it would answer confidently for the wrong one.
    'a stale payload for the previous video is refused',
    playerPayload({ videoDetails: { videoId: 'OLDvideoOLD', channelId: 'UCstalestalestalestale' } }),
    'XmPk1qwO4N0',
    null,
  ],
  ['no player payload at all', 'console.log("videoDetails")', 'XmPk1qwO4N0', null],
]) {
  check(name, videoOwnerIdFromPlayerResponse(extractPlayerResponse(text), videoId), expected);
}

console.log('\nvideoOwnerIdFromInitialData');
for (const [name, text, expected] of [
  ['the owner beside Subscribe', payload(owner('UCwatchwatchwatchwatch')), 'UCwatchwatchwatchwatch'],
  ['a channel page has no watch results', payload({ metadata: {} }), null],
  ['owner present but not a channel id', payload(owner('VLPLsomething')), null],
]) {
  check(name, videoOwnerIdFromInitialData(extractInitialData(text)), expected);
}

/* ── CSV export ──────────────────────────────────────────────────────── */

const { buildVideoCsv } = await load('src/csv.ts');

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

// Deliberately awkward data: a comma in one channel name, a quote in another,
// a newline in a title. Each one silently shifts every following column if it
// is not quoted, and a spreadsheet will not complain — it will just be wrong.
const fixture = {
  channels: [
    { id: 'UC1', name: 'Alex, Becker', handle: '@alex' },
    { id: 'UC2', name: 'Larry "Wheels"', handle: '@larry' },
  ],
  groups: [
    { id: 'g1', name: 'Fitness', channelIds: ['UC2'], order: 0 },
    { id: 'g2', name: 'Marketing', channelIds: ['UC1'], order: 1 },
  ],
  videos: [
    { channelId: 'UC1', videoId: 'v1', title: 'Hello, "world"', publishedAt: now - DAY, views: 10 },
    { channelId: 'UC2', videoId: 'v2', title: 'Line\nbreak', publishedAt: now - 3 * DAY, views: null },
    { channelId: 'UC1', videoId: 'v3', title: 'Older', publishedAt: now - 30 * DAY, views: 5 },
  ],
};

const csvOf = (scope) => buildVideoCsv({ ...fixture, scope });

console.log('\nbuildVideoCsv');
check('7-day window drops older rows', csvOf({ groupId: null, days: 7, limit: null }).rows, 2);
check('no window keeps everything', csvOf({ groupId: null, days: null, limit: null }).rows, 3);
check('limit caps rows', csvOf({ groupId: null, days: null, limit: 1 }).rows, 1);
check('group scope filters by channel', csvOf({ groupId: 'g1', days: null, limit: null }).rows, 1);

// The search box is shared with the charts, so the file it writes has to mean
// the same thing the picture shows — matched on title *and* on channel name.
const searched = (query) => csvOf({ groupId: null, days: null, limit: null, query }).rows;
check('query matches a title', searched('older'), 1);
check('query matches a channel name', searched('larry'), 1);
check('query is case-insensitive', searched('HELLO'), 1);
check('empty query keeps everything', searched('   '), 3);
check('query matching nothing keeps nothing', searched('zzz'), 0);

const full = csvOf({ groupId: null, days: null, limit: null }).csv;

check('header first', full.startsWith('published_at,channel,'), true);
check('comma in a name is quoted', full.includes('"Alex, Becker"'), true);
check('quotes are doubled', full.includes('""world""'), true);
check('newline in a title is quoted', full.includes('"Line\nbreak"'), true);
check('missing views leave an empty cell', full.includes(',,'), true);
check('group names are included', full.includes('Fitness'), true);
check('newest first', full.indexOf('v1') < full.indexOf('v2'), true);
check('trailing newline', full.endsWith('\n'), true);

/* ── Search rule ─────────────────────────────────────────────────────── */

const { makeMatcher, matchesVideo, highlight } = await load('src/search.ts');

const hits = (query, text) => makeMatcher(query).test(text);

console.log('\nmakeMatcher');
/*
 * The bug that prompted the rule: searching "has" returned videos about
 * purchases, because a substring match cannot tell HASfit from "purchased".
 *
 * The first fix — whole words — was wrong in the other direction: it would have
 * stopped matching HASfit, the search that started this. So short queries match
 * at the *start* of a word, and these two cases pin that down.
 */
check('short query matches a word start', hits('has', 'HASfit'), true);
check('short query matches a standalone word', hits('has', 'it has arrived'), true);
check('short query is case-insensitive', hits('HAS', 'hasfit'), true);
check('short query skips mid-word: purchase', hits('has', 'purchase now'), false);
check('short query skips mid-word: chased', hits('has', 'chased'), false);
// Longer queries stay substring: people expect "fitness" to find "Fitness101".
check('long query matches inside a word', hits('fitness', 'Fitness101'), true);
check('long query still misses', hits('fitness', 'marketing'), false);
// Regex metacharacters are data here, not syntax.
check('dots are literal', hits('a.b', 'axb'), false);
check('dots match themselves', hits('a.b', 'a.b'), true);

check('empty query matches everything', makeMatcher('   ').empty, true);

// Which fields a search looks at is the reader's choice, so the rule has to be
// obeyed exactly — including the awkward case of choosing none.
const row = {
  title: 'Morning mobility',
  channel: 'Tone and Tighten',
  handle: '@ToneAndTighten',
  groups: ['Fitness'],
};
const findsIn = (query, fields) => matchesVideo(makeMatcher(query), row, fields);

check('title field', findsIn('mobility', ['title']), true);
check('title field ignores the channel', findsIn('tighten', ['title']), false);
check('channel field', findsIn('tighten', ['channel']), true);
check('handle field', findsIn('toneand', ['handle']), true);
check('group field', findsIn('fitness', ['group']), true);
check('group field ignores the title', findsIn('mobility', ['group']), false);
check('several fields are an OR', findsIn('tighten', ['title', 'channel']), true);
// Unticking everything is deliberate; answering it with "here is all of it"
// would be ignoring the instruction.
check('no fields matches nothing', findsIn('mobility', []), false);
check('but an empty query still matches', matchesVideo(makeMatcher(''), row, []), true);

// Highlighting drives what the table marks, so the split must be exact and
// lossless — a highlight that drops or reorders text is a corrupted title.
const parts = highlight(makeMatcher('has'), 'HASfit has news');
check('text survives the split', parts.map((p) => p.text).join(''), 'HASfit has news');
check('both occurrences marked', parts.filter((p) => p.hit).length, 2);
check('marked text is the query', parts.filter((p) => p.hit)[0].text, 'HAS');
check('no marks without a match', highlight(makeMatcher('zzz'), 'nothing').length, 1);

/* ── Period wording ──────────────────────────────────────────────────── */

const { periodLabel, periodSlug } = await load('src/csv.ts');

console.log('\nperiodLabel');
// Sub-day windows have to read as hours: "last 1 days" is the wording that
// makes software feel unfinished, and three surfaces print this string.
check('24 hours', periodLabel(1, null), 'last 24 hours');
check('48 hours', periodLabel(2, null), 'last 48 hours');
check('7 days', periodLabel(7, null), 'last 7 days');
check('a row limit', periodLabel(null, 100), 'latest 100');
check('no window', periodLabel(null, null), 'everything held');
check('filename, hours', periodSlug(1, null), '24h');
check('filename, days', periodSlug(30, null), '30d');
check('filename, limit', periodSlug(null, 200), 'top200');
check('filename, everything', periodSlug(null, null), 'full');

/* ── Relative dates, per language ────────────────────────────────────── */

const { parseAge } = await load('src/dates.ts');

console.log('\nparseAge');
for (const [text, lang, expected] of [
  // The phrase shape differs per language — prefix, suffix, no spaces at all —
  // which is why the parser matches a number and its neighbouring word rather
  // than a whole phrase.
  ['11K views • 5 days ago', 'en', 5 * DAY],
  ['1,2 Mio. Aufrufe • vor 5 Tagen', 'de', 5 * DAY],
  ['9,7 K vues • il y a 3 jours', 'fr', 3 * DAY],
  ['9,7 mil visualizações • há 2 semanas', 'pt', 14 * DAY],
  ['5 dagen geleden', 'nl', 5 * DAY],
  ['1.2万 回視聴 • 3 日前', 'ja', 3 * DAY],
  ['조회수 1.2만회 • 3일 전', 'ko', 3 * DAY],
  ['1.2万次观看 • 3天前', 'zh', 3 * DAY],
  ['5 gün önce', 'tr', 5 * DAY],
  ['5 dni temu', 'pl', 5 * DAY],
  // Months must not be read as minutes: the stems overlap in several languages
  // and the longest match has to win.
  ['vor 2 Monaten', 'de', 2 * 30 * DAY],
  ['hace 2 meses', 'es', 2 * 30 * DAY],
  ['2 か月前', 'ja', 2 * 30 * DAY],
  // Nothing to read: the caller keeps the item rather than hiding it.
  ['Premiered', 'en', null],
  ['LIVE', 'en', null],
  ['1.2K views', 'en', null],
]) {
  check(`${lang}: ${text}`, parseAge(text, lang), expected);
}

/* ── Which text on a tile the age is read from ───────────────────────── */

/*
 * The regression this guards: `ageFromItemText` used to scan the whole tile,
 * so the first "number + time word" won — and that is nearly always in the
 * title. "Give Me 7 Minutes and I'll Give You 44 Years of Business Advice"
 * read as seven minutes old and survived a "Today" filter by eleven days.
 *
 * Enough of a DOM to answer the two calls the function makes. A real browser
 * is the only place the selectors themselves can be checked; what is testable
 * here is which string we end up parsing, which is where the bug lived.
 */
const { ageFromItemText } = await load('src/selectors.ts');

function tile({ metadata = [], title = '', text = '' }) {
  return {
    textContent: text,
    querySelectorAll: (selector) =>
      selector.includes('metadata') ? metadata.map((t) => ({ textContent: t })) : [],
    querySelector: () => (title ? { textContent: title } : null),
  };
}

console.log('\nageFromItemText');
for (const [name, item, expected] of [
  [
    'reads the metadata line, not the title',
    tile({
      metadata: ['96K views', '10 days ago'],
      title: '$100M Worth of Marketing Knowledge in 32 Minutes | Scale or Fail',
      text: '32:20 $100M Worth of Marketing Knowledge in 32 Minutes | Scale or Fail 96K views • 10 days ago',
    }),
    10 * DAY,
  ],
  [
    'ignores a duration in the title',
    tile({
      metadata: ['28K views', '11 days ago'],
      title: "Give Me 7 Minutes and I'll Give You 44 Years of Business Advice",
      text: "7:14 Give Me 7 Minutes and I'll Give You 44 Years of Business Advice 28K views • 11 days ago",
    }),
    11 * DAY,
  ],
  [
    'no metadata container: falls back to the tile minus its title',
    tile({
      title: "Give Me 7 Minutes and I'll Give You 44 Years of Business Advice",
      text: "Give Me 7 Minutes and I'll Give You 44 Years of Business Advice GaryVee 28K views • 11 days ago",
    }),
    11 * DAY,
  ],
  [
    'a scheduled upload states no age, so it is kept',
    tile({
      metadata: ['Scheduled for 8/21/26, 11:30 PM'],
      title: 'Alex Hormozi answers your questions',
      text: 'Upcoming Alex Hormozi answers your questions Scheduled for 8/21/26, 11:30 PM',
    }),
    null,
  ],
]) {
  check(name, ageFromItemText(item, 'en'), expected);
}

/* ── Which videos a window contains ──────────────────────────────────── */

/*
 * Two ways the charts lost videos the stat tiles had already counted, both
 * seen as "it says 10 uploads and draws 8":
 *
 *   1. A premiere scheduled for a future date satisfies `publishedAt >=
 *      cutoff`, so it was counted — and then no bucket reaches forward, so it
 *      was never drawn.
 *   2. The hourly buckets covered `days * 24` whole hours, but the window is
 *      rolling: at 20:15 the 48th bucket back begins at 21:00, leaving the
 *      first 45 minutes of the window with nowhere to be drawn. That half is
 *      geometry rather than filtering; this covers the filtering, which the
 *      charts and `buildVideoCsv` now share.
 */

const upcoming = {
  ...fixture,
  videos: [
    ...fixture.videos,
    // Scheduled for next week: dated in the future, and not an upload yet.
    { channelId: 'UC1', videoId: 'v4', title: 'Premiere', publishedAt: now + 7 * DAY, views: null },
  ],
};
const rowsOf = (scope) => buildVideoCsv({ ...upcoming, scope }).rows;

console.log('\nwindow contents');
check('a scheduled premiere is not in a 7-day window', rowsOf({ groupId: null, days: 7, limit: null }), 2);
check('nor under "everything held"', rowsOf({ groupId: null, days: null, limit: null }), 3);
check(
  'nor in its own channel scope',
  buildVideoCsv({ ...upcoming, scope: { groupId: null, channelId: 'UC1', days: null, limit: null } }).rows,
  2,
);
check(
  'a single channel scope still keeps its real uploads',
  buildVideoCsv({ ...upcoming, scope: { groupId: null, channelId: 'UC2', days: null, limit: null } }).rows,
  1,
);

/* ── Which YouTube account a page belongs to ─────────────────────────── */

/*
 * The bug: one browser profile, two YouTube accounts, one store. Signing in as
 * the second account and pressing Refresh replaced the channel list, and
 * `saveChannels` then pruned every group membership that was not in it — the
 * first account's groups survived as empty shells. Telling the accounts apart
 * is the whole fix, so the thing that tells them apart is worth pinning down.
 */
const { readAccount } = await load('src/account.ts');

const ytcfg = (fields) => `ytcfg.set(${JSON.stringify(fields)});`;

const SIGNED_IN = { LOGGED_IN: true, DATASYNC_ID: '113000000000000000001||', SESSION_INDEX: '0' };
const OTHER_ACCOUNT = { LOGGED_IN: true, DATASYNC_ID: '113000000000000000002||', SESSION_INDEX: '1' };

console.log('\nreadAccount');
check('signed out has no account', readAccount(ytcfg({ LOGGED_IN: false, DATASYNC_ID: '||' })), null);
check('an unrelated script has no account', readAccount('console.log("DATASYNC_ID")'), null);
check(
  'the signed-out placeholder is not an account',
  readAccount(ytcfg({ LOGGED_IN: true, DATASYNC_ID: '||' })),
  null,
);
check('a signed-in page has one', typeof readAccount(ytcfg(SIGNED_IN))?.id, 'string');
// The address, not the identity: these are what a later request uses to ask
// for this account rather than whichever one the browser answers with first.
check('the session index comes along', readAccount(ytcfg(OTHER_ACCOUNT))?.sessionIndex, '1');
check('a personal account has no page id', readAccount(ytcfg(SIGNED_IN))?.pageId, null);
check(
  'a brand account carries the page id to address it by',
  readAccount(ytcfg({ LOGGED_IN: true, DATASYNC_ID: 'brand-7||113000000000000000001' }))?.pageId,
  'brand-7',
);
check(
  'a delegated session id is the page id',
  readAccount(ytcfg({ LOGGED_IN: true, DELEGATED_SESSION_ID: 'brand-7' }))?.pageId,
  'brand-7',
);
check(
  'the same account reads the same both times',
  readAccount(ytcfg(SIGNED_IN)).id,
  readAccount(ytcfg({ ...SIGNED_IN, SESSION_INDEX: '2' })).id,
);
check(
  'two accounts do not share a store',
  readAccount(ytcfg(SIGNED_IN)).id === readAccount(ytcfg(OTHER_ACCOUNT)).id,
  false,
);
check(
  'a brand account is told apart from the account behind it',
  readAccount(ytcfg({ LOGGED_IN: true, DATASYNC_ID: 'brand||113000000000000000001' })).id ===
    readAccount(ytcfg(SIGNED_IN)).id,
  false,
);
check(
  'a delegated session id stands in when there is no datasync id',
  typeof readAccount(ytcfg({ LOGGED_IN: true, DELEGATED_SESSION_ID: 'brand-1' }))?.id,
  'string',
);
// The id is a storage key, not a fact about the user: the account id it was
// derived from must not travel into storage with it.
check(
  'the account id is not stored in the clear',
  readAccount(ytcfg(SIGNED_IN)).id.includes('113000000000000000001'),
  false,
);

/* ── Retry backoff for the flaky upload feed ─────────────────────────── */

/*
 * The endpoint this hits was measured directly: roughly 50% of requests fail
 * (404, 500, or a throttle response) with no clear link to how fast they are
 * sent, and it recovers within seconds on its own. That is what `retryDelay`
 * exists for — a batch of a few hundred channels with no retry logic loses
 * most of them, which is the bug this fixes. The delay itself is what is
 * tested here; the retry loop's use of it needs real timers and is exercised
 * live rather than in this suite (see the file's own module comment).
 */
const { retryDelay } = await load('src/uploads.ts');

console.log('\nretryDelay');
check('grows from attempt to attempt', retryDelay(1) < retryDelay(2), true);
check('grows again on the next attempt', retryDelay(2) < retryDelay(3), true);
// Bounds rather than exact values: jitter is randomised on purpose, so the
// assertion is "somewhere in the doubling band", not "exactly this number".
check('attempt 1 stays within its band', retryDelay(1) >= 500 && retryDelay(1) < 1000, true);
check('attempt 2 stays within its band', retryDelay(2) >= 1000 && retryDelay(2) < 2000, true);
check('attempt 3 stays within its band', retryDelay(3) >= 2000 && retryDelay(3) < 4000, true);

/* ── The circuit breaker over a whole refresh ────────────────────────── */

/*
 * The bug this exists to fix: a sustained outage meant every one of ~170
 * channels independently burned its own full retry budget before giving up,
 * turning one refresh into hundreds of requests over half a minute. These
 * tests drive the state machine with controlled timestamps rather than real
 * waits — same reasoning as `retryDelay` above, but for the "should this
 * attempt happen at all" question instead of "how long until the next one".
 */
const { newCircuit, shouldSkip } = await load('src/uploads.ts');

console.log('\nshouldSkip');
check('a fresh circuit never skips', shouldSkip(newCircuit(), 0), false);

{
  // Reaching the trip point needs a failing circuit — built by hand here
  // rather than through `recordFailure`, which is not exported: the module's
  // public surface for this is "closed" vs "open", not the counting that gets
  // it there.
  const open = { consecutiveFailures: 12, openedAt: 1000, lastProbeAt: 1000 };
  check('an open circuit skips immediately after tripping', shouldSkip(open, 1000), true);
  check('and keeps skipping through the cooldown', shouldSkip(open, 1000 + 2999), true);
}

{
  const open = { consecutiveFailures: 12, openedAt: 1000, lastProbeAt: 1000 };
  check(
    'a probe is allowed once the cooldown has fully elapsed',
    shouldSkip(open, 1000 + 3000),
    false,
  );
  check(
    'letting the probe through starts a fresh cooldown immediately',
    shouldSkip(open, 1000 + 3000),
    true,
  );
}

console.log(failed === 0 ? '\nall passed' : `\n${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
