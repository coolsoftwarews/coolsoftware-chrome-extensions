/**
 * Headless checks for the pure logic: shouldHideNode's per-toggle branching,
 * the Following-tab decision, active-toggle counting and the popup's
 * changed-toggle diff — plus the default/empty-state shapes in types.ts.
 * Everything DOM-bound (selectors.ts, content.ts) needs a real, logged-in X
 * session and is covered by the manual checklist in README.md instead.
 *
 * Also enforces PRD-24 §5/§6's "no network requests, anywhere in the
 * codebase" requirement directly, by grepping every src/*.ts file for the
 * calls that would violate it. (This comment intentionally never writes out
 * the exact substrings being grepped for, so it can't accidentally match
 * itself — see the grep section below for the literal patterns instead.)
 *
 * Run: node scripts/selftest.mjs
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const entry = path.join(os.tmpdir(), `xfd-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['types.ts', 'rules.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `xfd-selftest-bundle-${process.pid}.mjs`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  outfile: bundlePath,
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(bundlePath).href);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

/* ── Defaults (types.ts) ─────────────────────────────────────────────── */

console.log('DEFAULT_TOGGLES / TOGGLE_ORDER / TOGGLE_COPY');
check('five toggles, matching TOGGLE_ORDER length', mod.TOGGLE_ORDER.length === 5);
check(
  'every TOGGLE_ORDER key has a DEFAULT_TOGGLES value',
  mod.TOGGLE_ORDER.every(key => typeof mod.DEFAULT_TOGGLES[key] === 'boolean')
);
check(
  'every TOGGLE_ORDER key has copy (label + help)',
  mod.TOGGLE_ORDER.every(key => typeof mod.TOGGLE_COPY[key]?.label === 'string' && typeof mod.TOGGLE_COPY[key]?.help === 'string')
);
check('declutter-first defaults: followingDefault starts on', mod.DEFAULT_TOGGLES.followingDefault === true);
check('declutter-first defaults: hideAds starts on', mod.DEFAULT_TOGGLES.hideAds === true);
check('declutter-first defaults: hideSidebarModules starts on', mod.DEFAULT_TOGGLES.hideSidebarModules === true);
check('declutter-first defaults: hideVanityCounts starts on', mod.DEFAULT_TOGGLES.hideVanityCounts === true);
check('focusMode starts off — a layout change, not just noise removal (PRD §4)', mod.DEFAULT_TOGGLES.focusMode === false);

console.log('emptyMetrics');
const empty = mod.emptyMetrics();
check('sessionCount starts at 0', empty.sessionCount === 0);
check('popupOpenCount starts at 0', empty.popupOpenCount === 0);
check('every toggle has a zeroed on/off counter', mod.TOGGLE_ORDER.every(key => empty.toggleOnCount[key] === 0 && empty.toggleOffCount[key] === 0));

/* ── shouldHideNode ──────────────────────────────────────────────────── */

console.log('shouldHideNode');
const allOn = { followingDefault: true, hideAds: true, hideSidebarModules: true, hideVanityCounts: true, focusMode: true };
const allOff = { followingDefault: false, hideAds: false, hideSidebarModules: false, hideVanityCounts: false, focusMode: false };

check('an ad post is hidden when hideAds is on', mod.shouldHideNode({ kind: 'ad-post' }, allOn) === true);
check('an ad post is shown when hideAds is off', mod.shouldHideNode({ kind: 'ad-post' }, allOff) === false);
check(
  'a sidebar suggestion module is hidden only by hideSidebarModules, not by hideAds',
  mod.shouldHideNode({ kind: 'sidebar-suggestion-module' }, { ...allOff, hideAds: true }) === false
);
check(
  'a sidebar suggestion module is hidden by hideSidebarModules alone',
  mod.shouldHideNode({ kind: 'sidebar-suggestion-module' }, { ...allOff, hideSidebarModules: true }) === true
);
check(
  'a vanity count is hidden only by hideVanityCounts',
  mod.shouldHideNode({ kind: 'vanity-count' }, { ...allOff, hideVanityCounts: true }) === true &&
    mod.shouldHideNode({ kind: 'vanity-count' }, { ...allOn, hideVanityCounts: false }) === false
);
check(
  'focus chrome is hidden only by focusMode',
  mod.shouldHideNode({ kind: 'focus-chrome' }, { ...allOff, focusMode: true }) === true &&
    mod.shouldHideNode({ kind: 'focus-chrome' }, { ...allOn, focusMode: false }) === false
);
check('an ordinary node is never hidden, even with every toggle on', mod.shouldHideNode({ kind: 'ordinary' }, allOn) === false);

/* ── activeToggleCount ───────────────────────────────────────────────── */

console.log('activeToggleCount');
check('all off counts as 0', mod.activeToggleCount(allOff) === 0);
check('all on counts as 5', mod.activeToggleCount(allOn) === 5);
check('the shipped defaults count as 4 (focusMode starts off)', mod.activeToggleCount(mod.DEFAULT_TOGGLES) === 4);

/* ── isHomeTimelinePath / shouldForceFollowingTab ───────────────────── */

console.log('isHomeTimelinePath');
check('"/" is a home path', mod.isHomeTimelinePath('/') === true);
check('"/home" is a home path', mod.isHomeTimelinePath('/home') === true);
check('a profile path is not', mod.isHomeTimelinePath('/someuser') === false);
check('a status path is not', mod.isHomeTimelinePath('/someuser/status/123') === false);
check('the search path is not', mod.isHomeTimelinePath('/search') === false);

console.log('shouldForceFollowingTab');
check(
  'toggle off never forces the tab, even on the home path with For You active',
  mod.shouldForceFollowingTab({ ...allOff }, '/', 'For you') === false
);
check(
  'toggle on, home path, For You active — forces the tab',
  mod.shouldForceFollowingTab({ ...allOn }, '/', 'For you') === true
);
check(
  'toggle on, home path, Following already active — does nothing',
  mod.shouldForceFollowingTab({ ...allOn }, '/', 'Following') === false
);
check(
  'is case- and whitespace-insensitive when comparing the active label',
  mod.shouldForceFollowingTab({ ...allOn }, '/home', '  FOLLOWING  ') === false
);
check(
  'toggle on, home path, but the active tab could not be read — never guesses',
  mod.shouldForceFollowingTab({ ...allOn }, '/', null) === false
);
check(
  'toggle on but not the home path — never forces the tab on a profile/status/search page',
  mod.shouldForceFollowingTab({ ...allOn }, '/someuser', 'For you') === false
);

/* ── changedToggles ──────────────────────────────────────────────────── */

console.log('changedToggles');
const before = { ...mod.DEFAULT_TOGGLES };
const after = { ...before, hideAds: false, focusMode: true };
const changes = mod.changedToggles(before, after);
check('reports exactly the two flipped keys', changes.length === 2);
check(
  'reports hideAds turning off',
  changes.some(c => c.key === 'hideAds' && c.enabled === false)
);
check(
  'reports focusMode turning on',
  changes.some(c => c.key === 'focusMode' && c.enabled === true)
);
check('an identical before/after reports no changes', mod.changedToggles(before, { ...before }).length === 0);

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

/* ── PRD-24 §5/§6: no network requests anywhere in the codebase ────────
 * Grepped separately from the literal substrings so this comment can't
 * false-positive on itself. */
console.log('no-network-calls guard');
const forbidden = ['fetch' + '(', 'XMLHttpRequest' + '(', '.sendBeacon' + '(', 'new WebSocket' + '('];
const srcDir = path.join(rootDir, 'src');
const offenders = [];
for (const file of fs.readdirSync(srcDir)) {
  if (!file.endsWith('.ts')) continue;
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  for (const needle of forbidden) {
    if (text.includes(needle)) offenders.push(`${file}: ${needle}`);
  }
}
check('no fetch/XMLHttpRequest/sendBeacon/WebSocket call anywhere in src/*.ts', offenders.length === 0, offenders.join(', '));

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
