/**
 * The guide — what the options page is for now.
 *
 * The browser opens this page on install and offers it under "Extension
 * options", which makes it the one surface a confused user is *given*. It used
 * to host a second copy of the manager, which was a third way to do what the
 * panel already does; a first run that lands on an empty manager teaches
 * nothing.
 *
 * It reads as a landing page: hook, walkthrough, then the reference material.
 * The content lives in data below rather than in the markup, so adding a
 * walkthrough or a limitation is one entry, not a hunt through HTML.
 */

interface Walkthrough {
  /** YouTube video id. */
  id: string;
  title: string;
  summary: string;
  duration: string;
}

/* ── Walkthroughs ────────────────────────────────────────────────────── */

/**
 * The headline walkthrough, shown in the player at the top of the page.
 *
 * Set this to the `v=` part of the watch URL and the player fills in — for
 * example `'dQw4w9WgXcQ'`. Left empty it shows a designed placeholder rather
 * than a broken frame, so shipping before the recording exists is fine.
 *
 * Nothing is contacted until the reader presses play: the poster frame comes
 * from YouTube's thumbnail host and the embed is only created on that click.
 */
// Annotated `string` rather than inferred: the empty-value branch below is the
// documented way to ship without a recording, and a literal type would make
// the compiler call that branch dead the moment an id is filled in.
const HERO_VIDEO: string = 'XmPk1qwO4N0';

/** Caption under the play button. Ignored when HERO_VIDEO is empty. */
const HERO_VIDEO_LABEL = 'Watch the tour on YouTube';

/**
 * Further walkthroughs, listed as cards beneath the player.
 *
 * Hosted on YouTube and linked, rather than bundled: a screen recording in the
 * package would dwarf the extension itself.
 *
 * To add one, append an entry — nothing else changes:
 *
 *   {
 *     id: 'dQw4w9WgXcQ',            // the v= part of the watch URL
 *     title: 'Grouping 400 channels without losing your mind',
 *     summary: 'Bulk-assigning channels, and why the members filter helps.',
 *     duration: '4 min',
 *   }
 */
const WALKTHROUGHS: Walkthrough[] = [];

/**
 * Where the rest live. Shown under the cards when set; hidden when not, so an
 * empty string is a valid state rather than a dead link.
 */
const PLAYLIST_URL = '';

/* ── Features ────────────────────────────────────────────────────────── */

/** The six accents defined in options.css. */
type Accent = 'red' | 'amber' | 'violet' | 'green' | 'blue' | 'teal';

interface Feature {
  title: string;
  body: string;
  accent: Accent;
  /** Key into ICONS. */
  icon: keyof typeof ICONS;
}

/**
 * Card glyphs, as inline SVG path data on a 24-unit grid.
 *
 * Drawn rather than shipped as images: a stroke inherits the card's accent
 * colour and stays crisp at any zoom, and the page keeps its promise that it
 * loads nothing from anywhere.
 */
const ICONS = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M8 16v-3M12 16v-5M16 16v-2"/>',
  plus: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6"/><path d="M13.7 20a2 2 0 0 1-3.4 0"/>',
  dot: '<path d="M4 7h8M4 12h10M4 17h13"/><circle cx="18.4" cy="6.4" r="2.9" fill="currentColor" stroke="none"/>',
  chart: '<path d="M4 20h16"/><path d="M7 20v-6M12 20V7M17 20v-9"/>',
  download: '<path d="M12 4v10"/><path d="m8 11 4 4 4-4"/><path d="M5 19h14"/>',
} as const;

const FEATURES: Feature[] = [
  {
    title: 'Groups and the filtered feed',
    accent: 'red',
    icon: 'folder',
    body:
      'Assign channels to as many groups as you like, then press the eye to show one ' +
      'group in your subscription feed. Shorts are filtered by group too, including on ' +
      'the Shorts tab.',
  },
  {
    title: 'Add to group, from the channel',
    accent: 'amber',
    icon: 'plus',
    body:
      'Every channel and watch page gets an "Add to group" button beside Subscribe. Its ' +
      'label doubles as a status readout — ✓ Marketing, ✓ 3 groups — so the page tells ' +
      'you whether a channel is filed.',
  },
  {
    title: 'A prompt when you subscribe',
    accent: 'violet',
    icon: 'bell',
    body:
      'Subscribing offers the same picker unprompted. It is the one moment you already ' +
      'know where a channel belongs, and it stops groups going stale. Turn it off in ' +
      'Settings if you would rather file in bulk.',
  },
  {
    title: 'New-upload dots',
    accent: 'green',
    icon: 'dot',
    body:
      'A dot marks a channel that has posted something you have not looked at; a group ' +
      'shows how many of its channels have one. The dot clears when you open that ' +
      'channel or watch one of its videos — the same rule as YouTube’s own dots.',
  },
  {
    title: 'Charts and a table',
    accent: 'blue',
    icon: 'chart',
    body:
      'Settings → Charts & table opens uploads per day, your most active channels, and a ' +
      'sortable table of every video held — with filters that apply to both views.',
  },
  {
    title: 'CSV export',
    accent: 'teal',
    icon: 'download',
    body:
      'Settings → Video export writes one row per video: date, channel, title, URL, views ' +
      'and groups. Pick a group and a period first; the label tells you how many rows ' +
      'you will get.',
  },
];

const LIMITS: string[] = [
  'Upload data covers roughly the last 15 videos per channel — that is all a channel’s ' +
    'public feed carries. Counts that reach 15 are shown as "15+" because they are a ' +
    'floor, not a total.',
  'Everything except alphabetical order is a snapshot from the last Refresh. Views, ' +
    'dates and dots are as of then, not live.',
  'Shorts and collaboration uploads name no channel in the page, so they are matched ' +
    'through the upload data. One published since your last Refresh may briefly slip ' +
    'through a filtered feed — press Refresh to place it.',
  'Filtering hides videos, and YouTube keeps loading more whenever the screen is not ' +
    'full. A group matching few videos will make it fetch for a while.',
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Nothing happens on YouTube after I install or update the extension',
    a:
      'Reload the YouTube tab. Content scripts are not injected into tabs that were ' +
      'already open, and an updated extension leaves the old copy in them.',
  },
  {
    q: 'Refresh says it could not read my subscriptions',
    a:
      'Sign in to YouTube in this browser and try again. The extension reads the list ' +
      'through your existing session, so signed out it can see nothing.',
  },
  {
    q: 'A channel shows no upload date, or the dots never appear',
    a:
      'Press Refresh — dates are only gathered when you do. A channel whose feed does not ' +
      'respond stays blank rather than being guessed at, and Settings reports how many ' +
      'channels are known.',
  },
  {
    q: 'Sorting by videos is greyed out',
    a:
      'YouTube did not include a video count for your subscriptions. The option is ' +
      'disabled rather than offered, because sorting by data we do not have would leave ' +
      'a list that looks sorted and is not.',
  },
  {
    q: 'Something looks wrong and I want to see why',
    a:
      "On the YouTube tab, open the console and run localStorage.ysgDebug = '1', then " +
      'reload. Every line from this extension is prefixed [subscription-groups].',
  },
];

/* ── Rendering ───────────────────────────────────────────────────────── */

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function svg(paths: string, cls?: string): SVGElement {
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('aria-hidden', 'true');
  if (cls) el.setAttribute('class', cls);
  // Path data is a literal from ICONS above, never user input.
  el.innerHTML = paths;
  return el;
}

function featureCard(feature: Feature): HTMLElement {
  const box = document.createElement('article');
  box.className = 'card';
  box.dataset.accent = feature.accent;

  const badge = document.createElement('div');
  badge.className = 'card__icon';
  badge.append(svg(ICONS[feature.icon]));

  const h = document.createElement('h3');
  h.textContent = feature.title;
  const p = document.createElement('p');
  p.textContent = feature.body;

  box.append(badge, h, p);
  return box;
}

/**
 * Build the hero player.
 *
 * With a video id this is a facade — poster frame plus a play button — that
 * opens the video on YouTube when pressed. Without one it is a placeholder
 * that says so.
 */
function renderPlayer(): void {
  const player = $('player');

  if (HERO_VIDEO === '') {
    player.classList.add('player--empty');
    const box = document.createElement('div');
    box.className = 'player__soon';
    const mark = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    mark.setAttribute('viewBox', '0 0 100 100');
    mark.innerHTML = '<use href="#mark" />';
    const title = document.createElement('strong');
    title.textContent = 'Walkthrough coming soon';
    const note = document.createElement('span');
    note.textContent =
      'The Quick start below covers everything the extension does today — it takes about a minute to read.';
    box.append(mark, title, note);
    player.append(box);
    return;
  }

  const facade = document.createElement('button');
  facade.type = 'button';
  facade.className = 'facade';
  facade.setAttribute('aria-label', HERO_VIDEO_LABEL);

  const thumb = document.createElement('img');
  // YouTube's own thumbnail host; no other remote origin is contacted.
  thumb.src = `https://i.ytimg.com/vi/${HERO_VIDEO}/maxresdefault.jpg`;
  thumb.alt = '';
  // maxres does not exist for every upload; fall back to the size that always does.
  thumb.addEventListener('error', () => {
    thumb.src = `https://i.ytimg.com/vi/${HERO_VIDEO}/hqdefault.jpg`;
  });

  const play = document.createElement('span');
  play.className = 'facade__play';
  play.append(svg('<path d="M8 5v14l11-7Z" stroke="none" fill="#fff"/>'));

  const label = document.createElement('span');
  label.className = 'facade__label';
  label.textContent = HERO_VIDEO_LABEL;

  facade.append(thumb, play, label);

  // Opens on YouTube rather than swapping in an embed, because an embed cannot
  // work here: this page is served from a chrome-extension:// origin, and the
  // YouTube player refuses to configure itself for an origin it cannot
  // validate — "Error 153" in a black box, which is worse than an honest link.
  // The same video embeds fine on the product site, where the origin is a
  // normal https one.
  facade.addEventListener('click', () => {
    void chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${HERO_VIDEO}` });
  });

  player.append(facade);
}

function renderWalkthroughs(): void {
  const list = $('video-list');

  const more = $<HTMLAnchorElement>('video-more');
  more.hidden = PLAYLIST_URL === '';
  more.href = PLAYLIST_URL;

  for (const video of WALKTHROUGHS) {
    const link = document.createElement('a');
    link.className = 'card card--video';
    link.href = `https://www.youtube.com/watch?v=${video.id}`;
    link.target = '_blank';
    link.rel = 'noreferrer';

    const thumb = document.createElement('img');
    thumb.src = `https://i.ytimg.com/vi/${video.id}/mqdefault.jpg`;
    thumb.alt = '';
    thumb.loading = 'lazy';

    const body = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = video.title;
    const summary = document.createElement('p');
    summary.textContent = video.summary;
    const meta = document.createElement('span');
    meta.className = 'card__meta';
    meta.textContent = video.duration;
    body.append(title, summary, meta);

    link.append(thumb, body);
    list.append(link);
  }
}

function render(): void {
  renderPlayer();
  renderWalkthroughs();

  const features = $('features-list');
  for (const feature of FEATURES) features.append(featureCard(feature));

  const limits = $('limits-list');
  for (const limit of LIMITS) {
    const li = document.createElement('li');
    li.textContent = limit;
    limits.append(li);
  }

  const faq = $('faq-list');
  for (const entry of FAQ) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = entry.q;
    const answer = document.createElement('p');
    answer.textContent = entry.a;
    details.append(summary, answer);
    faq.append(details);
  }

  const manifest = chrome.runtime.getManifest();
  $('version').textContent = `${manifest.name} ${manifest.version} · stored on this device only`;
}

/* ── Actions ─────────────────────────────────────────────────────────── */

function openPanel(): void {
  // A panel can only be opened for a window, and only from a user gesture —
  // which the click that reaches here is.
  void chrome.windows.getCurrent().then((window) => {
    if (window.id !== undefined) void chrome.sidePanel.open({ windowId: window.id });
  });
}

for (const id of ['open-panel', 'open-panel-top', 'open-panel-end']) {
  $(id).addEventListener('click', openPanel);
}

$('open-feed').addEventListener('click', () => {
  void chrome.tabs.create({ url: 'https://www.youtube.com/feed/subscriptions' });
});

render();
