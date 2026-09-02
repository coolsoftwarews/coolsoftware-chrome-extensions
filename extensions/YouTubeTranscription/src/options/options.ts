/**
 * The guide page.
 *
 * Mostly static content, so this is the handful of things HTML cannot state
 * for itself: the running version, the buttons that go somewhere, the
 * walkthrough player, and the screenshots. First run lands here rather than on
 * an empty panel — a panel with no video in front of it teaches nothing.
 */

const SITE = 'https://coolsoftware.io';
const PRODUCT_SLUG = 'youtube-transcript-export';
const PRODUCT_PATH = `/extensions/${PRODUCT_SLUG}/`;

/* ── Walkthrough ─────────────────────────────────────────────────────── */

/**
 * The walkthrough, shown in the player under the hook.
 *
 * Set this to the `v=` part of the watch URL and the player fills in — for
 * example `'dQw4w9WgXcQ'`. Left empty it shows a designed placeholder rather
 * than a broken frame, so shipping before the recording exists is fine.
 *
 * Nothing is contacted until the reader presses play, and even then the video
 * opens on YouTube rather than in an embed — see the click handler for why an
 * embed cannot work on a chrome-extension:// page. The only remote request this
 * page makes is the poster frame, from YouTube's own thumbnail host.
 */
// Annotated `string` rather than inferred: the empty-value branch below is the
// documented way to ship without a recording, and a literal type would make the
// compiler call that branch dead the moment an id is filled in.
const HERO_VIDEO: string = '6b029axJFh0';

const HERO_LABEL = 'Watch the walkthrough on YouTube';
const HERO_SOON = 'Two minutes: open, search, export.';
const HERO_NOTE = 'Recording in progress — the walkthrough lands with the store listing.';

/* ── Screenshots ─────────────────────────────────────────────────────── */

interface Shot {
  /** Path relative to this page, e.g. `img/shot-panel.webp`. */
  src: string;
  alt: string;
  tag: string;
  caption: string;
  /** A full browser page rather than a panel; takes the whole row. */
  wide?: boolean;
}

/**
 * Product shots for "A closer look".
 *
 * Empty renders nothing at all rather than a gap — the prose below stands on
 * its own, and a broken image teaches worse than no image.
 *
 * Drop files in `src/options/img/` and add an entry:
 *
 *   { src: 'img/shot-panel.webp', alt: '…', tag: 'The panel', caption: '…' }
 */
const SHOTS: Shot[] = [
  {
    src: 'img/shot-panel.webp',
    alt: 'The transcript panel open beside a YouTube video, listing every line with its timestamp above the export buttons.',
    tag: 'Transcript',
    caption:
      'Every line with its timestamp, beside the video rather than over it. Search filters the list; clicking a line seeks the player.',
    wide: true,
  },
  {
    src: 'img/shot-prompt.webp',
    alt: 'The Prompt button open, offering to send the transcript to ChatGPT, Claude, Gemini or somewhere else.',
    tag: 'Prompt',
    caption: 'Send it to ChatGPT, Claude, Gemini — or name your own — with your instruction already in front of it.',
  },
  {
    src: 'img/shot-read.webp',
    alt: 'Read mode showing the transcript as a formatted document with headings, bullets and clickable timestamps.',
    tag: 'Read & edit',
    caption: 'The transcript as a document you can work on. Headings, lists, quotes — saved against that video.',
  },
  {
    src: 'img/shot-history.webp',
    alt: 'The history tab listing previously opened transcripts, searchable and deletable.',
    tag: 'History',
    caption: 'Everything you have opened, searchable by video. Delete one, or the lot.',
  },
  {
    src: 'img/shot-settings.webp',
    alt: 'The settings tab: caption tidying, clickable timestamps, chapters, a prompt list and four panel themes.',
    tag: 'Settings',
    caption: 'Tidying, timestamps, chapters, your prompt list, and four panel themes. All of it on this device.',
  },
];

/* ── Rendering ───────────────────────────────────────────────────────── */

function $<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function playIcon(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M8 5v14l11-7Z" />';
  return svg;
}

/**
 * Build the player.
 *
 * With a video id this is a facade — poster frame plus a play button — that
 * swaps itself for the embed on click. Without one it is a placeholder that
 * says so, which is a state this page will be in for a while.
 */
function renderPlayer(): void {
  const player = $('player');

  if (HERO_VIDEO === '') {
    player.classList.add('player--empty');
    const box = document.createElement('div');
    box.className = 'player__soon';

    const play = document.createElement('span');
    play.className = 'player__play';
    play.append(playIcon());

    const title = document.createElement('strong');
    title.textContent = HERO_SOON;
    const note = document.createElement('span');
    note.textContent = HERO_NOTE;

    box.append(play, title, note);
    player.append(box);
    return;
  }

  const facade = document.createElement('button');
  facade.type = 'button';
  facade.className = 'facade';
  facade.setAttribute('aria-label', HERO_LABEL);

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
  play.append(playIcon());

  facade.append(thumb, play);

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

function renderShots(): void {
  const host = $('shots');
  for (const shot of SHOTS) {
    const figure = document.createElement('figure');
    figure.className = shot.wide ? 'shot shot--wide' : 'shot';

    const img = document.createElement('img');
    img.src = shot.src;
    img.alt = shot.alt;
    img.loading = 'lazy';

    const caption = document.createElement('figcaption');
    const tag = document.createElement('span');
    tag.className = 'shot__tag';
    tag.textContent = shot.tag;
    caption.append(tag, document.createTextNode(shot.caption));

    figure.append(img, caption);
    host.append(figure);
  }
}

/* ── Actions ─────────────────────────────────────────────────────────── */

/** The studio's bug report form, told which product and version it is hearing about. */
function bugReportUrl(): string {
  const q = new URLSearchParams({
    product: PRODUCT_SLUG,
    version: chrome.runtime.getManifest().version,
  });
  return `${SITE}/support/?${q.toString()}`;
}

renderPlayer();
renderShots();

$('version').textContent = `v${chrome.runtime.getManifest().version}`;

// Every CTA does the same thing: the panel only enables itself on YouTube, so
// "open the panel" from here would be a button that cannot keep its promise.
for (const id of ['open-youtube-top', 'open-youtube-hero', 'open-youtube']) {
  $(id).addEventListener('click', () => {
    void chrome.tabs.create({ url: 'https://www.youtube.com/' });
  });
}

$('report').addEventListener('click', () => void chrome.tabs.create({ url: bugReportUrl() }));
$('studio').addEventListener('click', () =>
  void chrome.tabs.create({ url: `${SITE}${PRODUCT_PATH}` }),
);
