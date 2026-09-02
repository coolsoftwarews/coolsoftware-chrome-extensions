/**
 * The manager: a shell with screens, hosted by the side panel (primary) and
 * the options page.
 *
 * Structure, which is the point of this file:
 *
 *   ┌ toolbar — title + actions *for the current screen* ─────┬──────┐
 *   │                                                          │ rail │
 *   │  screen body — exactly one scrolling region              │  ▣   │
 *   │                                                          │  ⚙   │
 *   └──────────────────────────────────────────────────────────┴──────┘
 *
 * Two rules hold it together:
 *
 * 1. **One screen fits one screen.** Chrome and its neighbours have taught
 *    everyone that a panel does not scroll as a whole; the *content region*
 *    scrolls. Anything else means two scrollbars and a lost toolbar.
 * 2. **Screen-specific actions live in the toolbar, navigation lives in the
 *    rail.** Refresh belongs to Groups; export belongs to Settings; neither is
 *    navigation. Mixing the two is what made the first version's header a
 *    six-button row that meant nothing in particular.
 *
 * Screens are built once and shown/hidden, not rebuilt — switching back to
 * Groups must not re-render 500 channel rows.
 */

import {
  ActiveAccount,
  buildExport,
  createGroup,
  deleteGroup,
  getActiveAccount,
  importGroups,
  onStoreChanged,
  readStore,
  renameGroup,
  restoreGroup,
  saveChannels,
  saveUploads,
  setActiveAccount,
  setActiveGroup,
  setChannelInGroup,
  setFeedLanguage,
  setFeedPeriod,
  setPromptOnSubscribe,
  setTheme,
} from '../storage';
import { NotSignedInError, SubscriptionScrapeError, fetchSubscribedChannels } from '../subscriptions';
import { fetchAllUploads } from '../uploads';
import { ExportScope, buildVideoCsv, csvFilename } from '../csv';
import { LANGUAGES } from '../dates';
import { SEARCH_FIELDS, SearchField } from '../search';
import { isDebug } from '../content/debug';
import { showInsights } from '../open-insights';
import { scrapeInTab } from '../tab-scrape';
import { VizView, readVizState, writeVizState } from '../viz-state';
import { AccountIdentity } from '../account';
import { Channel, Group, StoreShape } from '../types';
import styles from './manager.css';

export const MANAGER_STYLES = styles as unknown as string;

type SortKey = 'name' | 'subscribers' | 'videos' | 'latest';

/**
 * The panel's looks.
 *
 * Each is a block of custom-property overrides in manager.css and nothing
 * else — no markup changes, no per-theme logic. The swatch here is only what
 * the button paints, so a new preset is a CSS block plus one line.
 */
const THEMES: Array<[string, string, string]> = [
  ['system', 'System', '#3663d6'],
  ['ink', 'Ink', '#8b7dfb'],
  ['paper', 'Paper', '#b4622e'],
  ['forest', 'Forest', '#2f8f6b'],
];

/**
 * The feed periods, in menu order. The value is a day count as a string, or
 * empty for "no limit" — the shape `feedPeriodDays` is stored in.
 */
const PERIODS: Array<[string, string]> = [
  ['', 'Any time'],
  ['1', 'Today'],
  ['7', 'This week'],
  ['30', 'This month'],
];

/** The chart/table/export windows, in menu order. Label doubles as readout. */
const WINDOWS: Array<[string, string]> = [
  ['1', 'Last 24 hours'],
  ['2', 'Last 48 hours'],
  ['7', 'Last 7 days'],
  ['30', 'Last 30 days'],
  ['90', 'Last 90 days'],
  ['n100', 'Latest 100'],
  ['n200', 'Latest 200'],
  ['n500', 'Latest 500'],
  ['all', 'Everything held'],
];

/** The channel orderings, in menu order. The label is also the readout. */
const SORTS: Array<[SortKey, string]> = [
  ['name', 'Name'],
  ['latest', 'Last upload'],
  ['subscribers', 'Subscribers'],
  ['videos', 'Videos'],
];
type ScreenId = 'groups' | 'data' | 'settings';

interface ScreenDef {
  id: ScreenId;
  title: string;
  /** Rail icon. Inline SVG path data, drawn on a 24×24 grid. */
  icon: string;
}

/**
 * The rail. Adding a screen — "Watch later" with its own filters, say — means
 * adding an entry here and a `buildX()` returning its body and toolbar; the
 * shell needs no other changes.
 */
const SCREENS: ScreenDef[] = [
  {
    id: 'groups',
    title: 'Groups',
    // Folder.
    icon: 'M4 5h5l2 2h9v11H4z',
  },
  {
    id: 'data',
    title: 'Charts & data',
    /*
     * Columns rising left to right. Not a pie, not a gauge: the screen is about
     * counts over time, and the icon should say which question it answers.
     */
    icon: 'M4 20h16M7 20V12M12 20V7M17 20V15',
  },
  {
    id: 'settings',
    title: 'Settings',
    /*
     * Sliders, not a cog — the cog belongs to the menu at the foot of the rail.
     * Two gears in one 44px strip would be two controls that look like the same
     * control. Sliders also describe this screen better: it is where you adjust
     * how the extension behaves, while the cog leads out to help and legal.
     */
    icon: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 4v6M8 14v6',
  },
];

/**
 * Row-action icons, on the same 24×24 grid as the rail.
 *
 * The group rows carried three text buttons — Watch, Rename, Delete — which at
 * panel width took more room than the group names they belonged to. Icons with
 * `title`/`aria-label` say the same thing in a fifth of the space; the labels
 * are still there for anyone hovering or using a screen reader.
 */
/**
 * Where the studio's public pages live.
 *
 * The guide inside the extension answers "how do I use this"; these answer
 * "who made it, what does it do with my data, and how do I complain" — which
 * are questions people ask *about* software rather than *of* it, and which
 * belong on a page anyone can read without installing anything.
 */
const SITE = 'https://coolsoftware.io';

/** Straight to the account chooser, told to come back to the page we need. */
const YOUTUBE_SIGN_IN =
  'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Ffeed%2Fchannels';
/** Matches the slug in the studio site's `EXTENSIONS` config; the URLs derive from it. */
const PRODUCT_SLUG = 'youtube-subscription-manager';
/** Trailing slash deliberate — see bugReportUrl() for why every link here carries one. */
const PRODUCT_PATH = `/extensions/${PRODUCT_SLUG}/`;

/**
 * The studio's bug report page, told what it is being told about.
 *
 * Both params land in hidden fields on the form. `product` decides where the
 * report is filed; `version` decides whether it is still true — a bug fixed two
 * releases ago and a bug present in the current build read identically in prose,
 * and nobody reporting one goes looking for a version number first.
 *
 * The browser is asked for in words on the page instead. It matters less often
 * than the version, and there is no hidden field waiting for it: a param the
 * form has no matching `paramName` for is dropped without complaint.
 *
 * Note the trailing slash. The site builds pages as directories, so `/support`
 * is answered with a 301 to `/support/` whose Location is built from the
 * origin's own scheme — plain http, because TLS is terminated ahead of it. The
 * domain sends an HSTS header but is not on the preload list, so a browser that
 * has never been here has nothing cached to upgrade with, and follows that hop
 * in the clear. An extension click is very often exactly that first visit.
 * Linking to the settled URL means no redirect happens at all.
 */
function bugReportUrl(): string {
  const q = new URLSearchParams({
    product: PRODUCT_SLUG,
    version: chrome.runtime.getManifest().version,
  });
  return `${SITE}/support/?${q}`;
}

const ICONS = {
  /**
   * A cog for the overflow menu.
   *
   * Three dots say "there is more here" without saying what — explicit enough
   * for a toolbar you use daily, too quiet for a menu holding the guide, bug
   * reports and the privacy policy, which are things people go looking for.
   */
  more:
    'M12 15a3 3 0 100-6 3 3 0 000 6z ' +
    'M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 ' +
    '1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 ' +
    '11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 ' +
    '001.5-1.1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 ' +
    '001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 ' +
    '1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
  book: 'M5 4h9a3 3 0 013 3v13H8a3 3 0 01-3-3z M8 4v13',
  play: 'M4 5h16v12H4z M10 8.5l4.5 2.5L10 13.5z',
  // A lightbulb: what could be built next, rather than what is broken now.
  idea:
    'M12 3a6 6 0 00-3.6 10.8c.6.4.9 1.1.9 1.8v.4h5.4v-.4c0-.7.3-1.4.9-1.8A6 6 0 0012 3z ' +
    'M9.7 19h4.6 M10.5 21.5h3',
  bug: 'M8 9a4 4 0 018 0v4a4 4 0 01-8 0z M4 11h4M16 11h4M5.5 6.5L8 8M18.5 6.5L16 8M5.5 16.5L8 15M18.5 16.5L16 15',
  star: 'M12 4l2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 9.7l5.4-.8z',
  shield: 'M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z',
  add: 'M12 5v14M5 12h14',
  // A circular arrow with its arrowhead: an incomplete circle reads as a
  // loading spinner, which is not what this button does until it is pressed.
  refresh: 'M20 12a8 8 0 11-2.4-5.7M20 4.5V9h-4.5',
  // A tick: "show only the ticked ones".
  members: 'M4 12l5 5L20 6',
  // Three bars, long to short, with a down arrow: the shape every list control
  // uses for "order these". A plain arrow would read as "collapse".
  sort: 'M4 6h11M4 12h7M4 18h4 M17 10v9M17 19l3-3M17 19l-3-3',
  // Three dots, drawn as zero-length round strokes so they need no fill and
  // inherit `currentColor` like every other icon here.
  kebab: 'M12 5.2h.01M12 12h.01M12 18.8h.01',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M20 20l-4.2-4.2',
  // A clock: this is a window in time, not a calendar date.
  period: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7.5V12l3 2',
  // A funnel: which fields the search is allowed through.
  fields: 'M4 5h16l-6.5 7.5V19l-3 1.5v-8z',
  // Bars on a baseline — the picture these open.
  chart: 'M4 20h16 M7 20v-7 M12 20V6 M17 20v-4',
  // A grid with a heavier head row: the same numbers, read as rows.
  table: 'M4 5h16v14H4z M4 9.5h16 M10 9.5V19 M15 9.5V19',
  // An arrow into a tray: a file leaving for your disk.
  download: 'M12 4v10 M8.5 11l3.5 3 3.5-3 M5 19h14',
  // The same tray, arrow reversed: a file arriving from your disk.
  upload: 'M12 14V4 M8.5 7.5L12 4l3.5 3.5 M5 19h14',
  // A circled i. Drawn as two strokes so it inherits `currentColor` like the
  // rest, rather than needing a fill.
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 8h.01 M12 11.5v5',
  // An eye, in one path: outline plus pupil. Not a play triangle — this shows
  // a group in the feed, it does not start playing anything.
  watch:
    'M2 12s3.6-6.5 10-6.5 10 6.5 10 6.5-3.6 6.5-10 6.5S2 12 2 12z M15 12a3 3 0 11-6 0 3 3 0 016 0z',
  rename: 'M4 20h4L18 10l-4-4L4 16z',
  delete: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
} as const;

interface MenuItem {
  label: string;
  icon: string;
  run: () => void;
}

/**
 * The overflow menu, at the foot of the rail.
 *
 * Everything here is a destination rather than a setting: one click, one tab,
 * no state to manage. Settings stays a screen in the rail because it is a place
 * you *work*, not a place you leave for.
 */
function menuItems(): MenuItem[] {
  return [
    {
      label: 'Guide & quick start',
      icon: ICONS.book,
      run: () => void chrome.runtime.openOptionsPage(),
    },
    {
      label: 'Walkthrough videos',
      icon: ICONS.play,
      run: () => void chrome.tabs.create({ url: `${SITE}${PRODUCT_PATH}#walkthroughs` }),
    },
    {
      label: 'Report a bug',
      icon: ICONS.bug,
      // A page rather than a mailto: a blank draft asks the reporter to guess
      // what I need, and a mailto also assumes a configured mail client, which
      // on a machine that reads its mail in a browser tab opens nothing at all.
      run: () => void chrome.tabs.create({ url: bugReportUrl() }),
    },
    {
      /*
       * Next to Report a bug on purpose: both are "I have something to say
       * about this", and someone who came looking for one is often really
       * after the other — a missing feature reads as a fault until you are
       * shown where to ask for it.
       */
      label: 'Vote for the next feature',
      icon: ICONS.idea,
      run: () => void chrome.tabs.create({ url: `${SITE}${PRODUCT_PATH}#roadmap` }),
    },
    {
      label: 'Rate this extension',
      icon: ICONS.star,
      run: () =>
        void chrome.tabs.create({
          url: `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`,
        }),
    },
    {
      label: 'Privacy & terms',
      icon: ICONS.shield,
      run: () =>
        void chrome.tabs.create({ url: `${SITE}/legal/privacy/#youtube-subscription-manager` }),
    },
  ];
}

export interface ManagerHandle {
  destroy(): void;
  show(screen: ScreenId): void;
}

export interface MountOptions {
  container: HTMLElement;
  /** Called when the user dismisses the manager; omit for a non-closable host. */
  onClose?: () => void;
}

export function mountManager(opts: MountOptions): ManagerHandle {
  return new Manager(opts);
}

class Manager implements ManagerHandle {
  private readonly root: HTMLElement;
  private readonly els: Elements;
  private readonly unsubscribe: () => void;

  private store: StoreShape | null = null;
  private screen: ScreenId = 'groups';
  private selectedGroupId: string | null = null;
  private sort: SortKey = 'name';
  /** Filter the channel list down to this group's members. */
  private membersOnly = false;
  /** The group the charts, table and export are scoped to; '' = all. */
  private vizGroupId = '';
  /** How far back they reach — a `WINDOWS` key. */
  private vizWindow = '30';
  /** One channel inside the scope, or '' for all of it. */
  private vizChannelId = '';
  /*
   * Which view a group opens in. Charts until told otherwise: it is the one
   * that answers "what is in here?" at a glance, and the table is where you go
   * when the picture has raised a question.
   */
  private vizView: VizView = 'chart';
  /** The group whose row menu is open, if any. */
  private menuGroup: Group | null = null;
  /** Group being renamed in place, or 'new' while creating one. */
  private editing: string | null = null;
  /** channel id → its row, so per-group updates never re-query the DOM. */
  private rows = new Map<string, { li: HTMLLIElement; box: HTMLInputElement }>();
  /**
   * Hover-card timers, owned by the manager rather than by each row.
   *
   * Per-row timers looked fine and were not: every row overwrote the shared
   * reference, so the card's own "keep me open" cancelled the *last* row's
   * timer rather than the hovered one's — and the card closed under the
   * pointer on its way to the button.
   */
  private cardOpenTimer = 0;
  private cardCloseTimer = 0;
  /** Signature of the (channels, sort) pair the rows were built from. */
  private renderedKey = '';
  private refreshing = false;
  /** Which account this panel has already tried to load by itself. */
  private autoLoadedFor: string | null = null;
  private bannerTimer = 0;
  /** Debounce for the charts/export search box. */
  private searchTimer = 0;

  constructor(private readonly opts: MountOptions) {
    this.els = buildShell(Boolean(opts.onClose));
    this.root = this.els.root;
    opts.container.append(this.root);
    this.wire();

    this.unsubscribe = onStoreChanged((next) => {
      this.store = next;
      this.render();
      void this.renderAccount();
      void this.autoLoad(next);
    });

    void this.init();
  }

  destroy(): void {
    this.unsubscribe();
    clearTimeout(this.bannerTimer);
    clearTimeout(this.searchTimer);
    clearTimeout(this.cardOpenTimer);
    clearTimeout(this.cardCloseTimer);
    this.root.remove();
  }

  show(screen: ScreenId): void {
    this.screen = screen;
    for (const def of SCREENS) {
      const active = def.id === screen;
      this.els.screens[def.id].hidden = !active;
      this.els.toolbars[def.id].hidden = !active;
      this.els.railButtons[def.id].setAttribute('aria-pressed', String(active));
    }
    this.els.title.textContent = SCREENS.find((s) => s.id === screen)?.title ?? '';
  }

  private async init(): Promise<void> {
    this.store = await readStore();
    this.show('groups');
    this.render();
    void this.renderAccount();
    await this.hydrateFilters();
    if (this.store.channelsFetchedAt === 0) await this.refresh();
  }

  /* ── Wiring ────────────────────────────────────────────────────────── */

  private wire(): void {
    const e = this.els;

    e.close?.addEventListener('click', () => this.opts.onClose?.());

    for (const def of SCREENS) {
      e.railButtons[def.id].addEventListener('click', () => this.show(def.id));
    }


    // Two buttons, one job — see where they are built.
    for (const btn of e.refreshButtons) {
      btn.addEventListener('click', () => void this.refresh());
    }
    // The scrim's own two buttons: go and do the thing, or say you have.
    e.signInGo.addEventListener('click', () => {
      void chrome.tabs.create({ url: YOUTUBE_SIGN_IN });
    });
    e.signInRetry.addEventListener('click', () => void this.refresh());

    e.exportBtn.addEventListener('click', () => this.exportToFile());
    e.importBtn.addEventListener('click', () => e.importFile.click());

    // The (i) beside them: a note anchored to the button, dismissed by the
    // next click anywhere — it is a sentence, not a dialog.
    this.attachNote(e.backupInfo, e.backupNote);
    for (const btn of e.refreshInfoButtons) this.attachNote(btn, e.refreshNote);
    e.importFile.addEventListener('change', () => {
      const file = e.importFile.files?.[0];
      if (file) void this.importFromFile(file);
      e.importFile.value = '';
    });

    e.search.addEventListener('input', () => this.applySearch());

    /*
     * The search toggle.
     *
     * Closing is conditional on the field being empty, because the alternative
     * — closing on blur regardless — would hide a filter that is still
     * applied. A list showing four of a hundred channels with no visible
     * reason is the worst outcome available here, so a search with text in it
     * stays on screen until it is cleared.
     */
    const openSearch = (): void => {
      e.searchBox.classList.add('ysg-searchbox--open');
      e.channelsHead.classList.add('ysg-pcard__head--searching');
      e.searchButton.hidden = true;
      e.search.hidden = false;
      e.search.focus();
    };

    const closeSearchIfEmpty = (): void => {
      if (e.search.value.trim() !== '') return;
      e.searchBox.classList.remove('ysg-searchbox--open');
      e.channelsHead.classList.remove('ysg-pcard__head--searching');
      e.search.hidden = true;
      e.searchButton.hidden = false;
    };

    e.searchButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openSearch();
    });
    e.search.addEventListener('blur', () => closeSearchIfEmpty());
    e.search.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      // Escape clears first, then closes — one key, both meanings, in the
      // order that never loses work.
      if (e.search.value !== '') {
        e.search.value = '';
        this.applySearch();
      }
      closeSearchIfEmpty();
    });
    // A `type="search"` field's own clear button fires `search`, not `blur`.
    e.search.addEventListener('search', () => {
      this.applySearch();
      if (e.search.value === '') closeSearchIfEmpty();
    });

    const closeSort = (): void => {
      e.sortMenu.hidden = true;
      e.sortButton.setAttribute('aria-expanded', 'false');
      e.sortButton.classList.remove('ysg-btn--on');
    };

    e.sortButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = e.sortMenu.hidden;
      e.sortMenu.hidden = !open;
      e.sortButton.setAttribute('aria-expanded', String(open));
      e.sortButton.classList.toggle('ysg-btn--on', open);
    });
    // Clicking anywhere else puts it away — a menu you can only close by
    // choosing something is a trap.
    document.addEventListener('click', (event) => {
      if (e.sortMenu.hidden) return;
      if (e.sortBox.contains(event.target as Node)) return;
      closeSort();
    });

    for (const [key, item] of e.sortOptions) {
      item.addEventListener('click', () => {
        if (item.disabled) return;
        this.sort = key;
        closeSort();
        this.render();
      });
    }

    e.promptToggle.addEventListener('change', () => {
      void setPromptOnSubscribe(e.promptToggle.checked);
    });

    e.helpButton.addEventListener('click', () => void chrome.runtime.openOptionsPage());

    e.csvButton.addEventListener('click', () => this.exportVideos());

    /* The window clock on the scope row — same shape as the feed period. */

    const closeWindow = (): void => {
      e.csvWindowMenu.hidden = true;
      e.csvWindowButton.setAttribute('aria-expanded', 'false');
      e.csvWindowButton.classList.remove('ysg-btn--on');
    };

    e.csvWindowButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = e.csvWindowMenu.hidden;
      e.csvWindowMenu.hidden = !open;
      e.csvWindowButton.setAttribute('aria-expanded', String(open));
      e.csvWindowButton.classList.toggle('ysg-btn--on', open);
      if (!open) return;
      // Fixed-positioned, because this opens from inside the scrolling picker.
      const box = e.csvWindowButton.getBoundingClientRect();
      const menu = e.csvWindowMenu.getBoundingClientRect();
      e.csvWindowMenu.style.left = `${Math.max(8, box.right - menu.width)}px`;
      e.csvWindowMenu.style.top = `${box.bottom + 4}px`;
    });
    document.addEventListener('click', (event) => {
      if (e.csvWindowMenu.hidden) return;
      if (e.csvWindowBox.contains(event.target as Node)) return;
      closeWindow();
    });
    e.csvGroupList.addEventListener('scroll', () => {
      if (!e.csvWindowMenu.hidden) closeWindow();
      if (!e.fieldsMenu.hidden) {
        e.fieldsMenu.hidden = true;
        e.fieldsButton.setAttribute('aria-expanded', 'false');
      }
    });

    for (const [value, item] of e.csvWindowOptions) {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closeWindow();
        this.vizWindow = value;
        this.renderExport();
        void this.publishFilters();
      });
    }

    /* Search, opening and closing like the one on the Groups screen. */

    const openVizSearch = (): void => {
      e.vizSearchBox.classList.add('ysg-searchbox--open');
      e.scopeRow.classList.add('ysg-scope-row--searching');
      e.vizSearchButton.hidden = true;
      e.vizSearch.hidden = false;
      e.vizSearch.focus();
    };

    const closeVizSearchIfEmpty = (): void => {
      if (e.vizSearch.value.trim() !== '') return;
      e.vizSearchBox.classList.remove('ysg-searchbox--open');
      e.scopeRow.classList.remove('ysg-scope-row--searching');
      e.vizSearch.hidden = true;
      e.vizSearchButton.hidden = false;
    };

    e.vizSearchButton.addEventListener('click', (event) => {
      event.stopPropagation();
      openVizSearch();
    });
    e.vizSearch.addEventListener('blur', () => closeVizSearchIfEmpty());
    e.vizSearch.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (e.vizSearch.value !== '') {
        e.vizSearch.value = '';
        this.renderExport();
        void this.publishFilters();
      }
      closeVizSearchIfEmpty();
    });
    e.vizSearch.addEventListener('search', () => {
      this.renderExport();
      void this.publishFilters();
      if (e.vizSearch.value === '') closeVizSearchIfEmpty();
    });

    e.fieldsButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = e.fieldsMenu.hidden;
      e.fieldsMenu.hidden = !open;
      e.fieldsButton.setAttribute('aria-expanded', String(open));
      e.fieldsButton.classList.toggle('ysg-btn--on', open);
      if (!open) return;
      // Also inside the scrolling picker now, so also placed from script.
      const box = e.fieldsButton.getBoundingClientRect();
      const menu = e.fieldsMenu.getBoundingClientRect();
      e.fieldsMenu.style.left = `${Math.max(8, box.right - menu.width)}px`;
      e.fieldsMenu.style.top = `${box.bottom + 4}px`;
    });
    document.addEventListener('click', (event) => {
      if (e.fieldsMenu.hidden) return;
      if (e.fieldsBox.contains(event.target as Node)) return;
      e.fieldsMenu.hidden = true;
      e.fieldsButton.setAttribute('aria-expanded', 'false');
      e.fieldsButton.classList.remove('ysg-btn--on');
    });

    for (const box of e.fieldBoxes.values()) {
      box.addEventListener('change', () => {
        const chosen = [...e.fieldBoxes.entries()]
          .filter(([, input]) => input.checked)
          .map(([id]) => id);
        this.renderFields(chosen);
        void writeVizState({ fields: chosen });
        this.renderExport();
      });
    }

    // Debounced: this is a storage write that redraws a chart, and one per
    // keystroke would redraw it six times for the word "podcast".
    e.vizSearch.addEventListener('input', () => {
      clearTimeout(this.searchTimer);
      this.searchTimer = setTimeout(() => void this.publishFilters(), 200);
      // The count below the controls describes what Export CSV would write, so
      // it has to follow the search too. It did not, and the panel confidently
      // reported 333 videos while the chart beside it showed 5.
      this.renderExport();
    });

    e.chartButton.addEventListener('click', () => void this.openViz('chart'));
    e.tableButton.addEventListener('click', () => void this.openViz('table'));

    for (const [id, btn] of e.themeButtons) {
      btn.addEventListener('click', () => void setTheme(id));
    }

    e.languageSelect.addEventListener('change', () => {
      void setFeedLanguage(e.languageSelect.value);
    });


    // Inside a list row now, so the click must not also reach the row.
    e.addGroup.addEventListener('click', (event) => {
      event.stopPropagation();
      this.editing = 'new';
      this.render();
    });

    /* The per-row menu: rename, or delete behind a confirmation. */

    e.rowRename.addEventListener('click', (event) => {
      event.stopPropagation();
      const group = this.menuGroup;
      this.closeRowMenu();
      if (!group) return;
      this.editing = group.id;
      this.render();
    });

    e.rowDelete.addEventListener('click', (event) => {
      event.stopPropagation();
      if (!this.menuGroup) return;
      // Second face. The group is named in full, because "are you sure?" over
      // a list of similar names is a question nobody can answer.
      e.rowConfirmText.textContent = `Delete "${this.menuGroup.name}"? Its channels stay subscribed.`;
      e.rowActions.hidden = true;
      e.rowConfirm.hidden = false;
    });

    e.rowCancel.addEventListener('click', (event) => {
      event.stopPropagation();
      this.closeRowMenu();
    });

    e.rowConfirmDo.addEventListener('click', (event) => {
      event.stopPropagation();
      const group = this.menuGroup;
      this.closeRowMenu();
      // Undo still stands. The confirmation guards the click; the banner
      // guards the minute afterwards, when you realise it was the wrong one.
      if (group) this.removeGroup(group);
    });

    // Any click outside puts it away, and so does Escape.
    document.addEventListener('click', (event) => {
      if (this.els.rowMenu.hidden) return;
      if (this.els.rowMenu.contains(event.target as Node)) return;
      this.closeRowMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.els.rowMenu.hidden) this.closeRowMenu();
    });
    // A menu pinned to a row that has scrolled away points at nothing.
    e.groupList.addEventListener('scroll', () => {
      if (!this.els.rowMenu.hidden) this.closeRowMenu();
    });

    e.menuButton.addEventListener('click', (event) => {
      event.stopPropagation();
      this.toggleMenu();
    });
    // Any click that is not inside the menu closes it, including one on the
    // page behind — a menu that survives the next click is a menu in the way.
    document.addEventListener('click', (event) => {
      if (!e.menu.contains(event.target as Node)) this.closeMenu();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') this.closeMenu();
    });

    e.card.root.addEventListener('mouseenter', () => this.cancelCardClose());
    e.card.root.addEventListener('mouseleave', () => this.scheduleCardClose());

    /* The period menu — same shape as the sort menu on the card below. */

    const closePeriod = (): void => {
      e.periodMenu.hidden = true;
      e.periodButton.setAttribute('aria-expanded', 'false');
      e.periodButton.classList.remove('ysg-btn--on');
    };

    e.periodButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = e.periodMenu.hidden;
      e.periodMenu.hidden = !open;
      e.periodButton.setAttribute('aria-expanded', String(open));
      e.periodButton.classList.toggle('ysg-btn--on', open);

      /*
       * Placed from the button's own rectangle, because this menu opens from
       * inside the group list — a box with `overflow-y: auto`, which clips any
       * absolutely-positioned child at its edge. Left as it was, the menu lost
       * its bottom option behind the card boundary.
       *
       * The sort menu one card down needs none of this: its button sits in a
       * card header, which clips nothing.
       */
      if (!open) return;
      const box = e.periodButton.getBoundingClientRect();
      const menu = e.periodMenu.getBoundingClientRect();
      e.periodMenu.style.left = `${Math.max(8, box.right - menu.width)}px`;
      e.periodMenu.style.top = `${box.bottom + 4}px`;
    });
    // Anchored to the viewport, so a scroll leaves it pointing at nothing.
    e.groupList.addEventListener('scroll', () => {
      if (!e.periodMenu.hidden) closePeriod();
    });
    document.addEventListener('click', (event) => {
      if (e.periodMenu.hidden) return;
      if (e.periodBox.contains(event.target as Node)) return;
      closePeriod();
    });

    for (const [value, item] of e.periodOptions) {
      item.addEventListener('click', (event) => {
        event.stopPropagation();
        closePeriod();
        void setFeedPeriod(value === '' ? null : Number(value));
      });
    }

    e.membersOnly.addEventListener('click', () => {
      this.membersOnly = !this.membersOnly;
      e.membersOnly.setAttribute('aria-pressed', String(this.membersOnly));
      e.membersOnly.classList.toggle('ysg-btn--on', this.membersOnly);
      this.applySearch();
    });
  }

  /* ── Rendering ─────────────────────────────────────────────────────── */

  private render(): void {
    if (!this.store) return;
    this.renderStatus();
    this.renderGroups();
    this.renderChannels();
    this.els.promptToggle.checked = this.store.promptOnSubscribe;
    this.els.languageSelect.value = this.store.feedLanguage;
    this.renderPeriod();
    // The whole of theming: one attribute, read by CSS.
    this.els.root.dataset.theme = this.store.theme;
    for (const [id, btn] of this.els.themeButtons) {
      btn.setAttribute('aria-pressed', String(id === this.store.theme));
    }
    this.renderExport();
  }

  /** The period readout and the tick in its menu, both from the stored value. */
  private renderPeriod(): void {
    const days = this.store?.feedPeriodDays ?? null;
    const value = days === null ? '' : String(days);
    const label = PERIODS.find(([key]) => key === value)?.[1] ?? 'Any time';

    this.els.periodLabel.textContent = `Show videos for: ${label}`;
    for (const [key, item] of this.els.periodOptions) {
      item.setAttribute('aria-checked', String(key === value));
    }
  }

  private renderStatus(): void {
    const store = this.store!;
    const n = store.channels.length;
    /*
     * The header carries the freshness and nothing else, so it sits right
     * beside the screen's name instead of trailing off the end of a line.
     *
     * The subscription count moved to the "All subscriptions" row, where every
     * other row already states how many channels it holds — a count belongs
     * beside the thing it counts, and there it can be compared with the groups
     * under it at a glance.
     */
    const text =
      store.channelsFetchedAt === 0
        ? 'Subscriptions not loaded yet'
        : `updated ${relativeTime(store.channelsFetchedAt)}`;
    this.els.status.textContent = text;
    // Settings is the one place that reports everything in full, so it keeps
    // the count the header no longer carries.
    const known = Object.keys(store.uploads).length;
    const full =
      store.channelsFetchedAt === 0
        ? 'Subscriptions not loaded yet'
        : `${n} subscription${n === 1 ? '' : 's'} · ${text}`;
    this.els.settingsStatus.textContent =
      store.uploadsCheckedAt === 0
        ? `${full} · uploads not checked yet`
        : `${full} · upload dates known for ${known} of ${n} channels, checked ${relativeTime(store.uploadsCheckedAt)}`;
  }

  private renderGroups(): void {
    const store = this.store!;
    const groups = [...store.groups].sort((a, b) => a.order - b.order);

    if (this.selectedGroupId && !groups.some((g) => g.id === this.selectedGroupId)) {
      this.selectedGroupId = null;
    }
    if (!this.selectedGroupId && groups.length > 0) this.selectedGroupId = groups[0].id;

    this.els.groupList.replaceChildren();

    /*
     * "All subscriptions" is a row like any other, and it is the way back to an
     * unfiltered feed — now by clicking it, like every other row.
     *
     * With the eyes gone this is the *only* way back: a group row no longer
     * un-filters when you click it again, because a row that toggles is a row
     * whose second click does something different from its first. So the escape
     * hatch is stated outright, at the top, where you look for it.
     */
    const showingAll = store.activeGroupId === null;
    const allRow = document.createElement('li');
    allRow.className = showingAll ? 'ysg-group ysg-group--all ysg-group--on' : 'ysg-group ysg-group--all';
    allRow.title = showingAll
      ? 'Showing every subscription'
      : 'Show every subscription again';
    allRow.addEventListener('click', (event) => {
      if (fromControl(event) || showingAll) return;
      void setActiveGroup(null).then(() => openSubscriptionFeed());
    });

    const allName = groupName('All subscriptions');
    /*
     * The count reads as part of the label, not as a column.
     *
     * A number at the far right of the row lines up with the groups' own
     * counts, which invites reading it as one of them — but it is the total
     * those are drawn from, so it wears a badge and sits against the words it
     * qualifies: "All subscriptions (102)".
     */
    const allCount = el('span', 'ysg-count-badge');
    allCount.textContent = String(store.channels.length);
    allCount.title = `${store.channels.length} subscriptions in total`;

    allRow.append(allName, allCount);
    if (showingAll) allRow.append(showingPill());
    allRow.append(this.els.periodBox, this.els.addGroup);
    // The scope line, between "everything" and the groups that divide it.
    this.els.groupList.append(allRow, this.els.periodRow);

    if (this.editing === 'new') {
      const li = document.createElement('li');
      li.className = 'ysg-group';
      li.append(
        this.editor('', (value) => {
          if (!value) return;
          if (this.nameTaken(value)) {
            this.rejectName(value, 'new');
            return;
          }
          void createGroup(value).then((group) => {
            this.selectedGroupId = group.id;
          });
        }),
      );
      this.els.groupList.append(li);
    }

    for (const group of groups) {
      const li = document.createElement('li');
      li.className = 'ysg-group';
      li.setAttribute('aria-selected', String(group.id === this.selectedGroupId));

      const empty = group.channelIds.length === 0;

      /*
       * One click, the whole intent: select the row, filter the feed, and put
       * this group's channels below.
       *
       * These used to be two controls — click the row to edit it, click its eye
       * to show it — on the theory that "edit" and "watch" are different
       * intents. In use they are not: you pick a group *because* you want to
       * look at it, and having to click twice, in two places, to do the obvious
       * thing is a distinction the interface was making for its own benefit.
       *
       * An empty group is the exception, and it is a real one: filtering the
       * feed to no channels empties it. So an empty group selects without
       * filtering, which puts its channel list in front of the person who just
       * asked for it — the useful response to "show me this" when there is
       * nothing to show yet.
       */
      li.title = empty
        ? `"${group.name}" has no channels yet — tick some below`
        : `Show only "${group.name}" in your subscription feed`;
      li.addEventListener('click', (event) => {
        if (fromControl(event)) return;
        this.selectedGroupId = group.id;
        this.render();
        if (empty) return;
        if (group.id === store.activeGroupId) return; // already showing it
        void setActiveGroup(group.id).then(() => openSubscriptionFeed());
      });

      const name =
        this.editing === group.id
          ? this.editor(group.name, (value) => {
              if (!value || value === group.name) return;
              if (this.nameTaken(value, group.id)) {
                this.rejectName(value, group.id);
                return;
              }
              void renameGroup(group.id, value);
            })
          : groupName(group.name);

      /*
       * One badge, "videos/channels", instead of two bare numbers.
       *
       * The old pair — a plain count and a blue pill — was two numbers of
       * different kinds sitting side by side with nothing to say which was
       * which. "23 14" could as easily have been a range or a score. A single
       * `3/23` reads as one fact with two parts, and the hover spells it out
       * for the one time anybody needs it spelled out.
       *
       * The left number was also upgraded on the way: it used to be *how many
       * channels* had something new, which answered "is there anything in
       * here?" but never "how much?". It is now the videos themselves.
       */
      const channels = group.channelIds.length;
      const fresh = this.newVideosInGroup(group);
      const badge = document.createElement('span');
      badge.className = fresh > 0 ? 'ysg-tally ysg-tally--new' : 'ysg-tally';
      // Spaced, because "12/9" reads as a date or a fraction at 10px and
      // "12 / 9" reads as two numbers.
      badge.textContent = `${fresh} / ${channels}`;
      badge.title =
        `${fresh} new video${fresh === 1 ? '' : 's'} across ` +
        `${channels} channel${channels === 1 ? '' : 's'}`;
      // An empty group has nothing to tally. "0/0" is noise, and the row
      // already says it is empty in its own way.
      badge.hidden = channels === 0;

      const watching = group.id === store.activeGroupId;

      /*
       * Rename and delete live behind one button, not two.
       *
       * They are rare — a group is named once and deleted almost never — and
       * they were spending two permanent slots on every row, next to a tally
       * that is read every time. Worse, the delete was a red bin one pixel from
       * the pencil, on a row that is now itself clickable.
       */
      const more = iconButton(
        ICONS.kebab,
        `More for "${group.name}"`,
        'ysg-btn--icon ysg-btn--kebab',
        (ev) => {
          ev.stopPropagation();
          this.toggleRowMenu(group, more);
        },
      );
      more.setAttribute('aria-haspopup', 'true');

      if (empty) li.classList.add('ysg-group--empty');

      li.append(name);
      // The group the feed is currently showing, said in a word. It is not the
      // same thing as the selected row and must not look like it.
      if (watching) {
        li.classList.add('ysg-group--on');
        li.append(showingPill());
      }
      li.append(badge, more);
      this.els.groupList.append(li);
    }

    if (groups.length === 0 && this.editing !== 'new') {
      const li = document.createElement('li');
      li.className = 'ysg-muted';
      li.textContent = 'No groups yet — use + to make one.';
      this.els.groupList.append(li);
    }

    // Re-rendering replaces the input, so focus has to be re-established each
    // time. Only a storage change re-renders, and typing does not touch
    // storage, so this never fights the user mid-word.
    const open = this.els.groupList.querySelector<HTMLInputElement>('.ysg-group__edit');
    open?.focus();
    open?.select();
  }

  /**
   * A one-line editor: Enter commits, Escape abandons, clicking away commits.
   *
   * Commit on blur rather than discard, because the common accident is clicking
   * elsewhere having *finished* typing — losing that work is the more annoying
   * of the two failures.
   */
  private editor(initial: string, commit: (value: string) => void): HTMLInputElement {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'ysg-group__edit';
    input.value = initial;
    input.maxLength = 60;
    input.placeholder = 'Group name';
    input.autocomplete = 'off';

    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.editing = null;
      if (save) commit(input.value.trim());
      this.render();
    };

    // The row underneath selects a group on click, and the panel is inside a
    // page with its own key handling; neither should see these events.
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    return input;
  }

  /**
   * Is this name already in use?
   *
   * Compared case-insensitively: "Fitness" and "fitness" are the same group to
   * anyone reading the list, and two of them is a filing system that has
   * already started to fail.
   */
  private nameTaken(name: string, exceptId?: string): boolean {
    const wanted = name.toLowerCase();
    return (this.store?.groups ?? []).some(
      (g) => g.id !== exceptId && g.name.toLowerCase() === wanted,
    );
  }

  /** Refuse the name, say why, and leave the editor open with it still typed. */
  private rejectName(name: string, keepEditing: string): void {
    this.banner(`There is already a group called "${name}".`, 'error');
    this.editing = keepEditing;
  }

  /**
   * An (i) button and the note it opens.
   *
   * Several buttons may share one note — Refresh appears on two screens, and
   * the sentence about it is the same sentence — so the note is positioned
   * from whichever button was pressed, and any click elsewhere closes it.
   */
  private attachNote(button: HTMLButtonElement, note: HTMLElement): void {
    const close = (): void => {
      note.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.classList.remove('ysg-btn--on');
    };

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = note.hidden;
      note.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.classList.toggle('ysg-btn--on', open);
      if (!open) return;
      const box = button.getBoundingClientRect();
      const size = note.getBoundingClientRect();
      note.style.left = `${Math.max(8, box.right - size.width)}px`;
      note.style.top = `${box.bottom + 4}px`;
    });

    document.addEventListener('click', () => {
      if (!note.hidden) close();
    });
  }

  /* ── The per-row menu ──────────────────────────────────────────────── */

  /**
   * Open the menu against a row's button, or close it if it is already that
   * row's menu that is open.
   *
   * Positioned `fixed` from the button's own rectangle rather than absolutely
   * inside the row: the group list is a scrolling box with `overflow-y: auto`,
   * and an absolutely-positioned child of a scrolling box gets clipped at its
   * edge. The menu would have been cut in half on the bottom row — which is
   * the row people reach for most, because that is where new groups land.
   */
  private toggleRowMenu(group: Group, anchor: HTMLElement): void {
    if (this.menuGroup?.id === group.id && !this.els.rowMenu.hidden) {
      this.closeRowMenu();
      return;
    }

    this.menuGroup = group;
    const { rowMenu, rowActions, rowConfirm } = this.els;

    // Always opens on its first face: a menu that remembers you were half-way
    // through deleting something is a menu that deletes something.
    rowActions.hidden = false;
    rowConfirm.hidden = true;
    rowMenu.hidden = false;

    const box = anchor.getBoundingClientRect();
    const menu = rowMenu.getBoundingClientRect();
    const gap = 4;
    // Right-aligned to the button, below it — flipping above when the bottom of
    // the window is closer than the menu is tall.
    const below = box.bottom + gap + menu.height <= window.innerHeight - 8;
    rowMenu.style.left = `${Math.max(8, box.right - menu.width)}px`;
    rowMenu.style.top = `${below ? box.bottom + gap : box.top - gap - menu.height}px`;

    anchor.setAttribute('aria-expanded', 'true');
  }

  private closeRowMenu(): void {
    this.menuGroup = null;
    this.els.rowMenu.hidden = true;
    this.els.rowConfirm.hidden = true;
    this.els.rowActions.hidden = false;
    for (const btn of this.els.groupList.querySelectorAll('[aria-expanded="true"]')) {
      btn.setAttribute('aria-expanded', 'false');
    }
  }

  /**
   * Has this channel posted since the user last looked at it?
   *
   * A channel with no known upload date is *not* new: we have never checked
   * it, and claiming news we have not seen is worse than staying quiet.
   */
  private hasNewUpload(channelId: string): boolean {
    const upload = this.store?.uploads[channelId];
    if (!upload) return false;
    const seen = this.store?.channelSeenAt[channelId] ?? 0;
    return upload.latestAt > seen;
  }

  /**
   * How many unseen videos a group holds.
   *
   * Same definition of "new" the dots use — published since you last looked at
   * that channel — counted per video rather than per channel. Bounded by what
   * the last refresh actually fetched, which is roughly the newest 15 uploads
   * per channel, so a group nobody has opened in a month reports a floor
   * rather than a total. That is the same caveat the insights charts carry.
   */
  private newVideosInGroup(group: Group): number {
    const store = this.store;
    if (!store) return 0;
    const wanted = new Set(group.channelIds);
    let count = 0;
    for (const video of store.videos) {
      if (!wanted.has(video.channelId)) continue;
      if (video.publishedAt > (store.channelSeenAt[video.channelId] ?? 0)) count++;
    }
    return count;
  }

  /**
   * Show a channel's details on hover, with a way through to the channel.
   *
   * The trigger is the avatar, not the whole row. Row-wide hover meant the card
   * opened on the way to somewhere else: moving down the list to reach a tick
   * box put a panel over the tick boxes, and scrolling the list dragged a card
   * along with the pointer. The avatar is the one part of a row that does
   * nothing else, so it is the part that can afford to mean "who is this?".
   *
   * The card is interactive, so it cannot simply vanish on mouseleave: the
   * pointer has to be able to travel into it to press the button. Hence the
   * small close delay, cancelled when the pointer arrives in the card.
   */
  private attachCard(row: HTMLElement, channel: Channel, trigger: HTMLElement): void {
    trigger.classList.add('ysg-cardable');
    trigger.addEventListener('mouseenter', () => {
      this.cancelCardClose();
      this.cardOpenTimer = self.setTimeout(() => this.showCard(row, channel), 220);
    });
    trigger.addEventListener('mouseleave', () => this.scheduleCardClose());

    // Keyboard users get the card too, without the hover delay — but only when
    // focus arrived by keyboard. `:focus-visible` is what tells tabbing onto a
    // row apart from clicking its checkbox, and a click must not throw a card
    // over the rows below the one being ticked.
    row.addEventListener('focusin', (event) => {
      const target = event.target as Element | null;
      if (!target?.matches(':focus-visible')) return;
      this.cancelCardClose();
      this.showCard(row, channel);
    });
    row.addEventListener('focusout', () => this.scheduleCardClose());
  }

  private toggleMenu(): void {
    const open = this.els.menu.hidden;
    this.els.menu.hidden = !open;
    this.els.menuButton.setAttribute('aria-expanded', String(open));
  }

  private closeMenu(): void {
    if (this.els.menu.hidden) return;
    this.els.menu.hidden = true;
    this.els.menuButton.setAttribute('aria-expanded', 'false');
  }

  private cancelCardClose(): void {
    clearTimeout(this.cardCloseTimer);
  }

  /** Delayed, so the pointer can travel from the row into the card. */
  private scheduleCardClose(): void {
    clearTimeout(this.cardOpenTimer);
    clearTimeout(this.cardCloseTimer);
    this.cardCloseTimer = self.setTimeout(() => this.hideCard(), 180);
  }

  private showCard(row: HTMLElement, channel: Channel): void {
    const card = this.els.card;
    const upload = this.store?.uploads[channel.id];

    card.avatar.src = channel.avatarUrl ?? '';
    card.avatar.hidden = !channel.avatarUrl;
    card.name.textContent = channel.name;
    card.handle.textContent = channel.handle ?? '';
    card.handle.hidden = !channel.handle;
    card.stats.textContent = statsLine(channel);
    card.latest.textContent = upload
      ? `Latest: ${upload.title || 'untitled'} · ${relativeTime(upload.latestAt)}`
      : 'Latest upload unknown — press Refresh to check';
    card.view.onclick = () => {
      void chrome.tabs.create({ url: `https://www.youtube.com/channel/${channel.id}` });
    };

    card.root.hidden = false;
    positionCard(card.root, row);
  }

  private hideCard(): void {
    this.els.card.root.hidden = true;
  }

  /** Delete now, offer Undo for as long as the banner is up. */
  private removeGroup(group: Group): void {
    const snapshot: Group = { ...group, channelIds: [...group.channelIds] };
    void deleteGroup(group.id).then(() => {
      this.banner(`Deleted "${snapshot.name}".`, 'info', {
        label: 'Undo',
        run: () => void restoreGroup(snapshot),
      });
    });
  }

  /**
   * Offer only the sorts we can actually perform.
   *
   * YouTube's subscription page supplies a handle and a subscriber count, and
   * — depending on the layout it serves — sometimes a video count. Leaving a
   * "Videos" option that silently orders everything as "unknown" is worse than
   * not offering it: the list looks sorted and is not.
   */
  private renderSortOptions(): void {
    const store = this.store!;
    const available: Record<string, boolean> = {
      name: true,
      latest: Object.keys(store.uploads).length > 0,
      subscribers: store.channels.some((c) => c.subscriberCount !== null),
      videos: store.channels.some((c) => c.videoCount !== null),
    };

    for (const [key, item] of this.els.sortOptions) {
      const ok = available[key] ?? true;
      item.disabled = !ok;
      item.title = ok ? '' : 'YouTube did not provide this for your subscriptions';
    }

    if (available[this.sort] === false) this.sort = 'name';

    for (const [key, item] of this.els.sortOptions) {
      item.setAttribute('aria-checked', String(key === this.sort));
    }
  }

  private renderChannels(): void {
    const store = this.store!;
    this.renderSortOptions();
    const group = store.groups.find((g) => g.id === this.selectedGroupId) ?? null;
    // Named either way. A bare "Channels" left the reader to work out whether
    // they were looking at a group's channels or all of them.
    this.els.channelsTitle.textContent = `Channels in "${group ? group.name : 'All'}"`;

    if (store.channels.length === 0) {
      this.els.channelList.replaceChildren();
      this.rows.clear();
      this.renderedKey = '';
      this.els.hint.textContent =
        'No subscriptions loaded. Hit Refresh — you need to be signed in to YouTube.';
      this.els.hint.hidden = false;
      return;
    }

    // The instruction is only worth its vertical space until the user has done
    // it once. After the first group exists, the interface is self-evident.
    this.els.hint.hidden = group !== null && store.groups.length > 0;
    this.els.hint.textContent = group
      ? 'Tick a channel to add it to this group.'
      : 'Create a group above, then tick the channels that belong to it.';

    /*
     * The line under the list states the ordering, because the control that
     * sets it is now an icon and an icon cannot say "Last upload".
     *
     * The provenance sentence that used to live here — "order, dates and dots
     * come from the last refresh, 44 minutes ago" — is gone. It said in a
     * paragraph what the header says in three words, and it said it every time
     * you looked at the list rather than when it mattered.
     */
    const label = SORTS.find(([key]) => key === this.sort)?.[1] ?? 'Name';
    const missing = store.uploadsCheckedAt === 0;
    this.els.dataNote.hidden = false;
    this.els.dataNote.textContent = missing
      ? `Sort by: ${label} — upload dates are not loaded yet, so press Refresh on Charts & data.`
      : `Sort by: ${label}`;

    this.rebuildRows();

    const member = new Set(group?.channelIds ?? []);
    for (const [id, row] of this.rows) {
      row.box.checked = member.has(id);
      row.box.disabled = group === null;
    }
    this.applySearch();
  }

  private rebuildRows(): void {
    const store = this.store!;
    const ordered = this.sortChannels(store.channels);

    const key = [
      this.sort,
      ordered.length,
      ordered[0]?.id ?? '',
      ordered[ordered.length - 1]?.id ?? '',
      // Both of these change which dots show. `seenStamp` is the newest "seen"
      // moment: any channel being marked seen moves it, which is enough to
      // know the dots need redrawing.
      store.uploadsCheckedAt,
      seenStamp(store),
    ].join(':');
    if (key === this.renderedKey) return;
    this.renderedKey = key;
    this.rows.clear();

    const frag = document.createDocumentFragment();
    for (const channel of ordered) frag.append(this.buildRow(channel));
    this.els.channelList.replaceChildren(frag);
  }

  private buildRow(channel: Channel): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'ysg-channel';
    li.dataset.search = `${channel.name} ${channel.handle ?? ''}`.toLowerCase();

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.id = `ysg-ch-${channel.id}`;
    box.addEventListener('change', () => {
      if (!this.selectedGroupId) return;
      void setChannelInGroup(this.selectedGroupId, channel.id, box.checked);
    });

    const avatar = document.createElement('img');
    avatar.alt = '';
    avatar.loading = 'lazy';
    if (channel.avatarUrl) avatar.src = channel.avatarUrl;

    const name = document.createElement('label');
    name.className = 'ysg-channel__name';
    name.htmlFor = box.id;
    name.textContent = channel.name;

    // Show the value you sorted by. Sorting a list by something invisible asks
    // the reader to take the order on faith; "Name" needs no such column.
    const metric = document.createElement('span');
    metric.className = 'ysg-channel__metric';
    metric.textContent = this.metricFor(channel);
    metric.hidden = metric.textContent === '';

    // Same idea as YouTube's own sidebar dot, and the same meaning — this
    // channel has posted something you have not been shown yet.
    const dot = document.createElement('span');
    dot.className = 'ysg-dot';
    dot.hidden = !this.hasNewUpload(channel.id);
    dot.title = 'New upload';

    // Details live in a hover card rather than on the row: they are read at
    // most once per channel, when deciding where it belongs, whereas the name
    // is read on every pass. A native `title` cannot hold a button, and the
    // useful thing to do with a channel you are unsure about is go and look at
    // it — so the card is a real element, and it is interactive.
    this.attachCard(li, channel, avatar);

    li.append(box, avatar, name, metric, dot);
    this.rows.set(channel.id, { li, box });
    return li;
  }

  /** The value the current sort is ordering by, as a short right-hand label. */
  private metricFor(channel: Channel): string {
    switch (this.sort) {
      case 'latest': {
        const upload = this.store?.uploads[channel.id];
        return upload ? relativeTime(upload.latestAt) : 'unknown';
      }
      case 'subscribers':
        return channel.subscriberText ?? '';
      case 'videos':
        return channel.videoText ?? '';
      default:
        return '';
    }
  }

  private sortChannels(channels: Channel[]): Channel[] {
    const byName = (a: Channel, b: Channel) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

    // Channels with no parseable count sort last in every numeric mode — they
    // are unknown, not zero, and burying them keeps the top of the list honest.
    const byNumber = (a: number | null, b: number | null) => {
      if (a === b) return 0;
      if (a === null) return 1;
      if (b === null) return -1;
      return b - a;
    };

    const sorted = [...channels];
    switch (this.sort) {
      case 'subscribers':
        return sorted.sort(
          (a, b) => byNumber(a.subscriberCount, b.subscriberCount) || byName(a, b),
        );
      case 'videos':
        return sorted.sort((a, b) => byNumber(a.videoCount, b.videoCount) || byName(a, b));
      case 'latest':
        // Most recently active first. A channel we have never checked sorts
        // last with the other unknowns rather than as "uploaded in 1970".
        return sorted.sort(
          (a, b) =>
            byNumber(
              this.store?.uploads[a.id]?.latestAt ?? null,
              this.store?.uploads[b.id]?.latestAt ?? null,
            ) || byName(a, b),
        );
      default:
        return sorted.sort(byName);
    }
  }

  /**
   * Row visibility: the search box and the members filter, together.
   *
   * "In this group" used to be a *sort* mode, which was the wrong shape — it
   * answered "who is in here?" by putting members on top and leaving 90 other
   * channels underneath. As a filter it answers the question outright, and it
   * composes with search and with whichever sort you are using.
   */
  private applySearch(): void {
    const q = this.els.search.value.trim().toLowerCase();
    const group = this.store?.groups.find((g) => g.id === this.selectedGroupId) ?? null;
    const members = new Set(group?.channelIds ?? []);

    for (const [id, { li }] of this.rows) {
      const matchesSearch = q === '' || (li.dataset.search ?? '').includes(q);
      const matchesFilter = !this.membersOnly || members.has(id);
      li.hidden = !(matchesSearch && matchesFilter);
    }
  }

  /* ── Actions ───────────────────────────────────────────────────────── */

  private banner(
    text: string,
    tone: 'ok' | 'error' | 'info' = 'info',
    action?: { label: string; run: () => void },
  ): void {
    clearTimeout(this.bannerTimer);
    this.els.banner.replaceChildren(text);
    this.els.banner.dataset.tone = tone;
    this.els.banner.hidden = false;

    if (action) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ysg-banner__action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        this.els.banner.hidden = true;
        action.run();
      });
      this.els.banner.append(btn);
      // Undo exists only while it is visible, so the window has to be long
      // enough to notice the mistake and reach the button.
      this.bannerTimer = self.setTimeout(() => (this.els.banner.hidden = true), 10000);
      return;
    }

    if (tone === 'ok') {
      this.bannerTimer = self.setTimeout(() => (this.els.banner.hidden = true), 4000);
    }
  }

  /**
   * Load an account we have never scraped, without being asked.
   *
   * Switching YouTube accounts swaps the store under the panel for an empty
   * one; filling it is the same thing `init` does on a first run, and the
   * alternative is a panel that goes blank and waits. Once per account, though
   * — a scrape that fails leaves the store empty, and every subsequent write
   * would otherwise start another one.
   */
  private async autoLoad(store: StoreShape): Promise<void> {
    if (store.channelsFetchedAt !== 0) return;
    const account = await getActiveAccount();
    const key = account?.id ?? '(none)';
    if (this.autoLoadedFor === key) return;
    this.autoLoadedFor = key;
    await this.refresh();
  }

  /**
   * Name the account this panel is reading, next to the version.
   *
   * A hashed id rather than anything readable: it exists to be *compared* —
   * against the id another window shows, or against the one in yesterday's
   * screenshot — not to identify a person. The session index rides along
   * because it is what the subscription scrape asks YouTube for, and a wrong
   * one there is how a panel ends up holding another account's channels.
   */
  private async renderAccount(): Promise<void> {
    const account = await getActiveAccount();
    const version = `v${chrome.runtime.getManifest().version}`;
    if (!account) {
      this.els.version.textContent = version;
      this.els.version.title = 'No YouTube account identified yet.';
      return;
    }
    const index = account.sessionIndex ?? '?';
    this.els.version.textContent = `${version} · ${account.id}#${index}`;
    this.els.version.title =
      `Showing groups for account ${account.id} (authuser=${index}). ` +
      'Each YouTube account you sign in to keeps its own groups.';
  }

  /** Both copies of the button lock together — it is one operation. */
  private setRefreshing(busy: boolean): void {
    this.refreshing = busy;
    for (const btn of this.els.refreshButtons) btn.disabled = busy;
  }

  private async refresh(): Promise<void> {
    // A refresh writes the store several times over, and every write comes back
    // as a change event — one of which can ask for a refresh. Re-entering here
    // would put two scrapes of a few hundred channels on the wire at once.
    if (this.refreshing) return;
    this.setRefreshing(true);
    this.banner('Reading your subscription list from YouTube…');

    let channels: Channel[];
    try {
      // Ask for the account the user is browsing as, not the browser's default
      // — the content script records which that is on every YouTube page.
      const before = await getActiveAccount();

      // An open YouTube tab first. It is the only context that can read the
      // list for the channel actually in use — see src/tab-scrape.ts. Fetching
      // from here is the fallback, and still correct for one account.
      const inTab = await scrapeInTab(before?.id ?? null);
      const scrape = inTab ?? (await fetchSubscribedChannels());

      // Traces where the list came from, what we asked for, and what answered —
      // the whole diagnosis for "the panel is showing the wrong account's
      // channels", which is otherwise unfalsifiable from the outside. Behind
      // the same opt-in flag src/content/debug.ts uses: turn it on with
      // `localStorage.ysgDebug = '1'` in the panel's own devtools console.
      if (isDebug()) {
        console.info(
          '[subscription-groups] scrape:',
          inTab ? `via tab ${inTab.tabId}` : 'via panel fetch',
          `asked ${describe(before)}`,
          `→ answered as ${scrape.account ? describe(scrape.account) : 'UNIDENTIFIED'}`,
          `(${scrape.channels.length} channels)`,
        );
      }

      // We asked for one account and YouTube answered for another. Refuse, and
      // refuse *before* adopting the answer: switching to it is what made
      // changing accounts do nothing at all, because the panel then snapped
      // back to the browser's default on every single refresh. A panel saying
      // it could not read this account beats one confidently showing another.
      if (before && scrape.account && scrape.account.id !== before.id) {
        this.banner(
          'Could not read this account’s subscriptions — YouTube answered for a ' +
            'different one. Open a youtube.com tab signed in to this account, then Refresh. ' +
            'Nothing was changed.',
          'error',
        );
        this.setRefreshing(false);
        return;
      }

      // Only now: the list and the store it lands in agree on whose they are.
      // `saveChannels` prunes group memberships against the list it is given,
      // so getting this order wrong empties the other account's groups, and
      // nothing gets them back.
      if (scrape.account) await setActiveAccount(scrape.account);

      channels = scrape.channels;
      // Prune only when the page told us whose list this is. Unidentified, it
      // may belong to another account, and pruning would empty this one's
      // groups against a list that was never theirs.
      await saveChannels(channels, scrape.account !== null);
      if (!scrape.account) {
        console.warn(
          '[subscription-groups] YouTube did not say which account this list belongs to;' +
            ' groups were left untouched rather than pruned against it.',
        );
      }
      this.els.signIn.hidden = true;
    } catch (err) {
      // Being signed out takes over the panel; everything else is a banner,
      // because everything else leaves the screen behind it worth looking at.
      if (err instanceof NotSignedInError) {
        this.els.banner.hidden = true;
        this.els.signIn.hidden = false;
        this.els.signInRetry.focus();
        this.setRefreshing(false);
        return;
      }

      this.banner(
        err instanceof SubscriptionScrapeError
          ? err.message
          : 'Something went wrong reading your subscriptions.',
        'error',
      );
      this.setRefreshing(false);
      return;
    }

    // Uploads are checked in the same action, because "refresh" meaning two
    // different things depending on which button you pressed is worse than one
    // slower refresh. The banner reports progress; the list is already usable.
    try {
      await this.checkUploads(channels.map((c) => c.id), channels.length);
    } finally {
      // Whatever happened, the lock has to come off: it now gates the automatic
      // load as well as the button, and a stuck one is a panel that never fills.
      this.setRefreshing(false);
    }
  }

  /** One Atom request per channel, six at a time. See src/uploads.ts. */
  private async checkUploads(channelIds: string[], subscriptionCount: number): Promise<void> {
    if (channelIds.length === 0) return;

    this.banner(`Loaded ${subscriptionCount} subscriptions. Checking for new uploads…`);
    const batch = await fetchAllUploads(channelIds, ({ done, total }) => {
      // Cheap enough to write on every completion, and the alternative is a
      // progress bar that sits still for a minute.
      this.banner(
        `Loaded ${subscriptionCount} subscriptions. Checking uploads… ${done}/${total}`,
      );
    });

    const found = Object.keys(batch.uploads).length;
    await saveUploads(batch.uploads, batch.videoOwners, batch.videos);

    if (found === 0) {
      // Every single one failing is not "no news", it is a broken feature —
      // say so, and say why, rather than showing an empty list of dots.
      console.warn('[subscription-groups] no upload feeds could be read:', batch.firstError);
      this.banner(
        `Could not read any upload feeds. First error — ${batch.firstError ?? 'unknown'}`,
        'error',
      );
      return;
    }

    this.banner(
      batch.failed === 0
        ? `Up to date: ${found} channels checked.`
        : `Checked ${found} of ${channelIds.length} channels; ${batch.failed} did not respond.`,
      'ok',
    );
  }

  /** Keep the export's group list current, and say how much it would write. */
  /** Keep the field checkboxes and their summary in step with the state. */
  private renderFields(fields: SearchField[]): void {
    const chosen = new Set(fields);
    for (const [id, box] of this.els.fieldBoxes) box.checked = chosen.has(id);

    const labels = SEARCH_FIELDS.filter((f) => chosen.has(f.id)).map((f) => f.label);
    this.els.fieldsLabel.textContent =
      labels.length === 0
        ? 'No fields'
        : labels.length === SEARCH_FIELDS.length
          ? 'All fields'
          : labels.join(', ');
    this.els.fieldsButton.title =
      labels.length === 0
        ? 'Nothing is being searched — tick at least one field'
        : `Searching ${labels.join(', ').toLowerCase()}`;
  }

  /**
   * The chart/table/export scope, drawn as the same card of groups the Groups
   * screen uses — minus everything that would act on the feed.
   *
   * A group that has fallen out of the store takes the scope back to "all"
   * rather than leaving the charts filtered to something that no longer
   * exists.
   */
  private renderScopePicker(): void {
    const store = this.store!;
    const groups = [...store.groups].sort((a, b) => a.order - b.order);
    if (this.vizGroupId !== '' && !groups.some((g) => g.id === this.vizGroupId)) {
      this.vizGroupId = '';
    }

    /*
     * Picking a group *shows* it, in whichever view is current.
     *
     * Selecting a scope and then having to press a second button to look at it
     * is the same two-step the Groups screen used to have with its eyes — and
     * the same answer applies: choosing a group is not a separate intent from
     * wanting to see it.
     *
     * Re-picking the group already selected still opens: by then the click can
     * only mean "show me that again".
     */
    const pick = (id: string): void => {
      if (this.vizGroupId !== id || this.vizChannelId !== '') {
        this.vizGroupId = id;
        // Asking for a group means the whole group — a channel left selected
        // from the last look would silently narrow it again.
        this.vizChannelId = '';
        this.renderExport();
      }
      void this.openViz(this.vizView);
    };

    const rows: HTMLElement[] = [];

    const allRow = document.createElement('li');
    allRow.className = 'ysg-group ysg-group--all';
    allRow.setAttribute('aria-selected', String(this.vizGroupId === ''));
    allRow.title = 'Chart and export every subscription';
    /*
     * The row is clickable and now carries four buttons, so a click has to be
     * asked where it came from.
     *
     * Without this, pressing Charts also selected the row underneath it —
     * silently resetting the scope to "all subscriptions" and then charting
     * that, whichever group you had picked. `stopPropagation` on each button
     * would work too, until the next button is added and forgets to.
     */
    allRow.addEventListener('click', (event) => {
      if (fromControl(event)) return;
      pick('');
    });
    const allName = groupName('All subscriptions');
    const allCount = el('span', 'ysg-count-badge');
    allCount.textContent = String(store.channels.length);
    allCount.title = `${store.channels.length} subscriptions in total`;
    // The window clock sits on this row, right of the label, exactly as the
    // feed period does on the Groups screen.
    allRow.append(allName, allCount, this.els.csvWindowBox, this.els.vizActions);
    rows.push(allRow, this.els.scopeRow);

    for (const group of groups) {
      const li = document.createElement('li');
      li.className = 'ysg-group';
      li.setAttribute('aria-selected', String(group.id === this.vizGroupId));
      li.title = `Chart and export "${group.name}" only`;
      li.addEventListener('click', (event) => {
        if (fromControl(event)) return;
        pick(group.id);
      });

      /*
       * On this screen the tally counts what the charts would *contain*, not
       * what is unseen.
       *
       * The Groups screen asks "is there anything new in here?", so its badge
       * counts videos published since you last looked. Here the question is
       * "how much data is in this slice?", and the two answers differ wildly —
       * a group could read 211 while the line under the card said 29, because
       * one ignored the window and the other did not. Two numbers describing
       * the same group, in the same card, disagreeing.
       */
      const channels = group.channelIds.length;
      const matching = this.videosInScope(group.id);
      const badge = el('span', matching > 0 ? 'ysg-tally ysg-tally--new' : 'ysg-tally');
      badge.textContent = `${matching} / ${channels}`;
      badge.title =
        `${matching} video${matching === 1 ? '' : 's'} in this window, across ` +
        `${channels} channel${channels === 1 ? '' : 's'}`;
      badge.hidden = channels === 0;

      if (channels === 0) li.classList.add('ysg-group--empty');
      li.append(groupName(group.name), badge);
      rows.push(li);
    }

    const window = WINDOWS.find(([value]) => value === this.vizWindow)?.[1] ?? 'Last 30 days';
    this.els.scopeLabel.textContent = window;
    for (const [value, item] of this.els.csvWindowOptions) {
      item.setAttribute('aria-checked', String(value === this.vizWindow));
    }

    this.els.csvGroupList.replaceChildren(...rows);
    this.renderChannelPicker();
  }

  /**
   * How many videos the current window and search leave in a group — the same
   * count the line under the card reports, asked per group.
   *
   * Built on `buildVideoCsv` rather than a second copy of its filtering, so
   * the badges and the readout can never drift apart. It formats a CSV it
   * throws away, which is wasteful and worth revisiting if the list ever grows
   * long; at a few thousand videos and a handful of groups it is not
   * measurable, and one filter shared is worth more than one saved.
   */
  private videosInScope(groupId: string, channelId = ''): number {
    const store = this.store;
    if (!store) return 0;
    return buildVideoCsv({
      videos: store.videos,
      channels: store.channels,
      groups: store.groups,
      scope: {
        ...this.exportScope(),
        groupId: groupId || null,
        channelId: channelId || null,
      },
    }).rows;
  }

  /**
   * The channels inside the current group scope, as a second picker.
   *
   * Ordered by how much they contribute to the picture above, because that is
   * the order the question arrives in — the tall bar is the one you want to
   * look into. Channels with nothing in the window are still listed, greyed,
   * rather than vanishing: a channel disappearing from a list you were reading
   * is worse than a row saying "0".
   */
  private renderChannelPicker(): void {
    const store = this.store!;
    const group = store.groups.find((g) => g.id === this.vizGroupId);
    const inScope = group ? new Set(group.channelIds) : null;
    if (this.vizChannelId && inScope && !inScope.has(this.vizChannelId)) this.vizChannelId = '';

    const counts = new Map<string, number>();
    for (const video of store.videos) {
      if (inScope && !inScope.has(video.channelId)) continue;
      counts.set(video.channelId, (counts.get(video.channelId) ?? 0) + 1);
    }

    const channels = store.channels
      .filter((c) => (inScope ? inScope.has(c.id) : true))
      .map((c) => ({ channel: c, videos: this.videosInScope(this.vizGroupId, c.id) }))
      .sort((a, b) => b.videos - a.videos || a.channel.name.localeCompare(b.channel.name));

    const pick = (id: string): void => {
      if (this.vizChannelId !== id) {
        this.vizChannelId = id;
        this.renderExport();
      }
      void this.openViz(this.vizView);
    };

    const rows: HTMLElement[] = [];

    // "Every channel" is the way back out, and the row that is selected when
    // no channel is.
    const allRow = document.createElement('li');
    allRow.className = 'ysg-group ysg-group--all';
    allRow.setAttribute('aria-selected', String(this.vizChannelId === ''));
    allRow.title = 'Every channel in this scope';
    allRow.addEventListener('click', (event) => {
      if (fromControl(event)) return;
      pick('');
    });
    const allName = groupName(group ? `Every channel in "${group.name}"` : 'Every channel');
    const allCount = el('span', 'ysg-count-badge');
    allCount.textContent = String(channels.length);
    allRow.append(allName, allCount);
    rows.push(allRow);

    for (const { channel, videos } of channels) {
      const li = document.createElement('li');
      li.className = videos === 0 ? 'ysg-group ysg-group--empty' : 'ysg-group';
      li.setAttribute('aria-selected', String(channel.id === this.vizChannelId));
      li.title = `Show only "${channel.name}"`;
      li.addEventListener('click', (event) => {
        if (fromControl(event)) return;
        pick(channel.id);
      });

      const avatar = document.createElement('img');
      avatar.className = 'ysg-pick__avatar';
      avatar.src = channel.avatarUrl ?? '';
      avatar.alt = '';
      avatar.loading = 'lazy';

      const badge = el('span', videos > 0 ? 'ysg-tally ysg-tally--new' : 'ysg-tally');
      badge.textContent = String(videos);
      badge.title = `${videos} video${videos === 1 ? '' : 's'} in this window`;

      li.append(avatar, groupName(channel.name), badge);
      // The same hover card the Groups screen uses — handle, subscribers,
      // latest upload, and a way through to the channel. It is the same
      // question being asked in both places: "who is this again?"
      this.attachCard(li, channel, avatar);
      rows.push(li);
    }

    this.els.csvChannelList.replaceChildren(...rows);
  }

  private renderExport(): void {
    const store = this.store!;
    this.renderScopePicker();

    const { rows } = buildVideoCsv({
      videos: store.videos,
      channels: store.channels,
      groups: store.groups,
      scope: this.exportScope(),
    });

    // The count the paragraph used to carry now lives on the export button,
    // which is the one place it changes what you get.
    this.els.csvButton.title =
      store.videos.length === 0
        ? 'Nothing to export yet — press Refresh first'
        : `Export ${rows} video${rows === 1 ? '' : 's'} as CSV — date, channel, title, ` +
          'URL, views at the last check, and groups';
  }

  private exportScope(): ExportScope {
    const value = this.vizWindow;
    return {
      groupId: this.vizGroupId || null,
      channelId: this.vizChannelId || null,
      days: /^\d+$/.test(value) ? Number(value) : null,
      limit: value.startsWith('n') ? Number(value.slice(1)) : null,
      query: this.els.vizSearch.value,
      fields: [...this.els.fieldBoxes.entries()]
        .filter(([, box]) => box.checked)
        .map(([id]) => id),
    };
  }

  /* ── Charts & table ────────────────────────────────────────────────── */

  /**
   * Push the filter row to storage, where the overlay reads it.
   *
   * Storage rather than a message: the overlay may not exist yet, may be in a
   * tab that is not this one, or may be about to be rebuilt after a reload. A
   * value that is simply *there* to be read handles all three, and there is no
   * "are you listening?" handshake to get wrong.
   */
  private async publishFilters(): Promise<void> {
    await writeVizState({
      groupId: this.vizGroupId,
      channelId: this.vizChannelId,
      window: this.vizWindow,
      query: this.els.vizSearch.value,
    });
  }

  private async openViz(view: VizView): Promise<void> {
    this.setVizView(view);
    // The view first, then the filters, then draw — so a modal that is already
    // open switches immediately rather than redrawing the old view en route.
    await writeVizState({
      view,
      groupId: this.vizGroupId,
      channelId: this.vizChannelId,
      window: this.vizWindow,
      query: this.els.vizSearch.value,
    });

    if (!(await showInsights())) {
      this.banner('Could not reach the YouTube tab — try reloading it.', 'error');
    }
  }

  private setVizView(view: VizView): void {
    this.vizView = view;
    this.els.chartButton.setAttribute('aria-pressed', String(view === 'chart'));
    this.els.tableButton.setAttribute('aria-pressed', String(view === 'table'));
  }

  /**
   * Put the filter row back where it was left.
   *
   * Run after the first render, because the group `<select>` has no options
   * until `renderExport` has built them and assigning to an empty select is a
   * silent no-op.
   */
  private async hydrateFilters(): Promise<void> {
    const state = await readVizState();
    const { vizSearch } = this.els;

    const known = state.groupId === '' || this.store?.groups.some((g) => g.id === state.groupId);
    if (known) this.vizGroupId = state.groupId;
    const channelKnown =
      state.channelId === '' || this.store?.channels.some((c) => c.id === state.channelId);
    if (channelKnown) this.vizChannelId = state.channelId;
    if (WINDOWS.some(([value]) => value === state.window)) this.vizWindow = state.window;
    vizSearch.value = state.query;
    this.renderFields(state.fields);
    this.setVizView(state.view);
    this.renderExport();
  }

  private exportVideos(): void {
    const store = this.store!;
    const scope = this.exportScope();
    const { csv, rows } = buildVideoCsv({
      videos: store.videos,
      channels: store.channels,
      groups: store.groups,
      scope,
    });

    if (rows === 0) {
      this.banner('Nothing matches that selection.', 'error');
      return;
    }

    const groupName = store.groups.find((g) => g.id === scope.groupId)?.name;
    // The BOM is for Excel, which otherwise reads UTF-8 titles as mojibake.
    download(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }),
      csvFilename(scope, groupName));
    this.banner(`Exported ${rows} videos.`, 'ok');
  }

  private exportToFile(): void {
    download(
      new Blob([JSON.stringify(buildExport(this.store!), null, 2)], {
        type: 'application/json',
      }),
      `subscription-groups-${new Date().toISOString().slice(0, 10)}.json`,
    );
  }

  private async importFromFile(file: File): Promise<void> {
    try {
      const result = await importGroups(JSON.parse(await file.text()));
      const skipped = result.channelsSkipped
        ? ` ${result.channelsSkipped} channel(s) skipped — you are not subscribed to them.`
        : '';
      this.banner(`Imported. ${result.groupsAdded} new group(s).${skipped}`, 'ok');
    } catch (err) {
      this.banner(err instanceof Error ? err.message : 'Could not read that file.', 'error');
    }
  }
}

/* ── Shell ───────────────────────────────────────────────────────────── */

interface Elements {
  root: HTMLElement;
  title: HTMLElement;
  status: HTMLElement;
  settingsStatus: HTMLElement;
  close: HTMLButtonElement | null;
  banner: HTMLParagraphElement;
  signIn: HTMLElement;
  signInGo: HTMLButtonElement;
  signInRetry: HTMLButtonElement;
  screens: Record<ScreenId, HTMLElement>;
  toolbars: Record<ScreenId, HTMLElement>;
  railButtons: Record<ScreenId, HTMLButtonElement>;
  refreshButtons: HTMLButtonElement[];
  refreshInfoButtons: HTMLButtonElement[];
  refreshNote: HTMLElement;
  exportBtn: HTMLButtonElement;
  backupInfo: HTMLButtonElement;
  backupNote: HTMLElement;
  importBtn: HTMLButtonElement;
  importFile: HTMLInputElement;
  addGroup: HTMLButtonElement;
  periodBox: HTMLElement;
  periodButton: HTMLButtonElement;
  periodMenu: HTMLElement;
  periodOptions: Map<string, HTMLButtonElement>;
  periodLabel: HTMLElement;
  periodRow: HTMLElement;
  membersOnly: HTMLButtonElement;
  groupList: HTMLUListElement;
  rowMenu: HTMLElement;
  rowActions: HTMLElement;
  rowConfirm: HTMLElement;
  rowConfirmText: HTMLElement;
  rowRename: HTMLButtonElement;
  rowDelete: HTMLButtonElement;
  rowCancel: HTMLButtonElement;
  rowConfirmDo: HTMLButtonElement;
  channelsTitle: HTMLElement;
  sortBox: HTMLElement;
  sortButton: HTMLButtonElement;
  sortMenu: HTMLElement;
  sortOptions: Map<SortKey, HTMLButtonElement>;
  search: HTMLInputElement;
  searchBox: HTMLElement;
  searchButton: HTMLButtonElement;
  channelsHead: HTMLElement;
  hint: HTMLParagraphElement;
  dataNote: HTMLParagraphElement;
  channelList: HTMLUListElement;
  promptToggle: HTMLInputElement;
  themeButtons: Map<string, HTMLButtonElement>;
  languageSelect: HTMLSelectElement;
  menuButton: HTMLButtonElement;
  menu: HTMLElement;
  /** Footer line: the extension version, and which account is on screen. */
  version: HTMLElement;
  helpButton: HTMLButtonElement;
  csvGroupList: HTMLElement;
  csvChannelList: HTMLElement;
  csvWindowBox: HTMLElement;
  csvWindowButton: HTMLButtonElement;
  csvWindowMenu: HTMLElement;
  csvWindowOptions: Map<string, HTMLButtonElement>;
  scopeRow: HTMLElement;
  scopeLabel: HTMLElement;
  vizSearchBox: HTMLElement;
  vizSearchButton: HTMLButtonElement;
  vizSearch: HTMLInputElement;
  fieldsBox: HTMLElement;
  fieldsButton: HTMLButtonElement;
  fieldsLabel: HTMLElement;
  fieldsMenu: HTMLElement;
  fieldBoxes: Map<SearchField, HTMLInputElement>;
  vizActions: HTMLElement;
  chartButton: HTMLButtonElement;
  tableButton: HTMLButtonElement;
  csvButton: HTMLButtonElement;
  card: {
    root: HTMLElement;
    avatar: HTMLImageElement;
    name: HTMLElement;
    handle: HTMLElement;
    stats: HTMLElement;
    latest: HTMLElement;
    view: HTMLButtonElement;
  };
}

function buildShell(closable: boolean): Elements {
  const root = el('div', 'ysg-mgr');

  /* Toolbar: screen title, then the actions belonging to that screen. */
  const head = el('div', 'ysg-mgr__head');
  const title = el('h2', 'ysg-mgr__title');
  const status = el('span', 'ysg-mgr__status');

  const toolbars: Record<ScreenId, HTMLElement> = {
    groups: el('div', 'ysg-mgr__actions'),
    data: el('div', 'ysg-mgr__actions'),
    settings: el('div', 'ysg-mgr__actions'),
  };

  /*
   * The period: an icon on the "All subscriptions" row, with its value stated
   * in words on the line below.
   *
   * The same shape as sorting, one card down — icon to change it, sentence to
   * read it — because they are the same kind of thing: a setting that describes
   * what the list beneath is showing. A `<select>` sitting in the row was the
   * only unlabelled control in the panel, and the widest.
   */
  const periodBox = el('div', 'ysg-fields ysg-fields--icon');
  const periodButton = iconButton(
    ICONS.period,
    'Only show videos published within this period',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  periodButton.setAttribute('aria-haspopup', 'true');
  periodButton.setAttribute('aria-expanded', 'false');

  const periodMenu = el('div', 'ysg-fields__menu ysg-fields__menu--fixed');
  periodMenu.hidden = true;
  const periodOptions = new Map<string, HTMLButtonElement>();
  for (const [value, label] of PERIODS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ysg-menu__item ysg-menu__item--check';
    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);
    periodMenu.append(item);
    periodOptions.set(value, item);
  }
  periodBox.append(periodButton, periodMenu);

  /*
   * The per-row menu, built once and moved to whichever row asked for it.
   *
   * One menu rather than one per row: only one can be open, and a hundred
   * hidden menus is a hundred nodes to build on every render.
   *
   * It has two faces. The first offers Rename and Delete; choosing Delete
   * turns it into the second, which names the group and makes you press again.
   * The confirmation lives *in the menu* because the browser's "prevent
   * additional dialogs" guard can silently disable `confirm()` — which is
   * exactly how the rename prompt broke once already, and a delete guard that
   * silently stops guarding is worse than none.
   */
  const rowMenu = el('div', 'ysg-menu ysg-menu--row');
  rowMenu.hidden = true;

  const rowActions = el('div', 'ysg-menu__face');
  const rowRename = document.createElement('button');
  rowRename.type = 'button';
  rowRename.className = 'ysg-menu__item';
  rowRename.append(icon(ICONS.rename, 15), document.createTextNode('Rename'));
  const rowDelete = document.createElement('button');
  rowDelete.type = 'button';
  rowDelete.className = 'ysg-menu__item ysg-menu__item--danger';
  rowDelete.append(icon(ICONS.delete, 15), document.createTextNode('Delete'));
  rowActions.append(rowRename, rowDelete);

  const rowConfirm = el('div', 'ysg-menu__face ysg-confirm');
  rowConfirm.hidden = true;
  const rowConfirmText = el('p', 'ysg-confirm__text');
  const rowConfirmRow = el('div', 'ysg-confirm__row');
  const rowCancel = button('Cancel', 'ysg-btn');
  const rowConfirmDo = button('Delete', 'ysg-btn ysg-btn--danger-solid');
  rowConfirmRow.append(rowCancel, rowConfirmDo);
  rowConfirm.append(rowConfirmText, rowConfirmRow);

  rowMenu.append(rowActions, rowConfirm);
  root.append(rowMenu);

  // What the clock is currently set to, said in words. The icon can change the
  // period but cannot state it, so this line does — the same division of labour
  // as the sort icon and its "Sort by:" line.
  const periodRow = document.createElement('li');
  periodRow.className = 'ysg-group ysg-period-row';
  const periodLabel = el('span', 'ysg-period-row__label');
  periodRow.append(periodLabel);

  /*
   * "New group" sits on the "All subscriptions" row, not in the toolbar.
   *
   * That row is the head of the list of groups, so the control that adds one
   * belongs to it — next to the eye, which is the row's other action. The
   * toolbar it came from is now empty on this screen, which is the point: the
   * Groups screen has no actions that are not about a specific row.
   */
  const addGroup = iconButton(ICONS.add, 'New group', 'ysg-btn--icon', () => undefined);

  /*
   * Refresh lives on Charts & data, not on Groups.
   *
   * It re-reads the subscription list and each channel's recent uploads —
   * minutes of work whose only visible product is fresher numbers. On the
   * Groups screen that reads as "reload the list I am looking at", and people
   * pressed it expecting the list to change. Here it sits beside the thing it
   * actually feeds, next to the line that says how old the data is.
   */
  const refreshLabel = 'Re-read your subscriptions and their recent uploads from YouTube';
  const refresh = iconButton(ICONS.refresh, refreshLabel, 'ysg-btn--icon', () => undefined);
  toolbars.data.append(refresh);

  /*
   * The same button again on Groups, in the same corner.
   *
   * It was moved off this screen because it reads as "reload the list" — but
   * Groups is also where you notice the data is stale, in the counts and the
   * dots on every row, and being sent to another tab to fix that is worse than
   * the ambiguity. Two buttons, one handler; the tooltip does the explaining.
   */
  const refreshGroups = iconButton(ICONS.refresh, refreshLabel, 'ysg-btn--icon', () => undefined);
  toolbars.groups.append(refreshGroups);
  const refreshButtons = [refresh, refreshGroups];

  /*
   * An (i) beside each Refresh, saying what a refresh can and cannot get.
   *
   * The ceiling is the single most surprising thing about this extension's
   * numbers — "Last 90 days" cannot mean 90 days for a channel that posts
   * daily, because its feed only carries 15 — and it was explained in the
   * charts, after the fact, in a note under a bar. Here it sits on the button
   * that does the fetching, where the expectation is formed.
   */
  const refreshNote = el('div', 'ysg-menu ysg-menu--row ysg-note-pop');
  refreshNote.hidden = true;
  const refreshNoteText = el('p', 'ysg-confirm__text');
  refreshNoteText.textContent =
    'Refresh re-reads your subscription list, then each channel’s public feed — which ' +
    'carries only its newest ~15 uploads. Nothing older is kept, so a long period reaches ' +
    'back only as far as those 15 go.';
  refreshNote.append(refreshNoteText);
  root.append(refreshNote);

  const infoLabel = 'What a refresh can fetch';
  const refreshInfoData = iconButton(ICONS.info, infoLabel, 'ysg-btn--icon', () => undefined);
  const refreshInfoGroups = iconButton(ICONS.info, infoLabel, 'ysg-btn--icon', () => undefined);
  for (const btn of [refreshInfoData, refreshInfoGroups]) {
    btn.setAttribute('aria-haspopup', 'true');
    btn.setAttribute('aria-expanded', 'false');
  }
  toolbars.data.append(refreshInfoData);
  toolbars.groups.append(refreshInfoGroups);
  const refreshInfoButtons = [refreshInfoData, refreshInfoGroups];

  /*
   * Export and Import as icons, with an (i) that says what they do.
   *
   * They are two words on a screen of prose, so as buttons they read as more
   * of the same. As icons they read as actions, and the explanation they used
   * to need a card for is one click away from the pair it describes.
   */
  const exportBtn = iconButton(
    ICONS.download,
    'Export your groups to a JSON file',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  const importBtn = iconButton(
    ICONS.upload,
    'Import groups from a JSON file',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  const backupInfo = iconButton(
    ICONS.info,
    'What Export and Import do',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  backupInfo.setAttribute('aria-haspopup', 'true');
  backupInfo.setAttribute('aria-expanded', 'false');

  const backupNote = el('div', 'ysg-menu ysg-menu--row ysg-note-pop');
  backupNote.hidden = true;
  const backupNoteText = el('p', 'ysg-confirm__text');
  backupNoteText.textContent =
    'Export writes a JSON file of your groups. Import merges it back — groups ' +
    'with the same name gain the channels rather than being replaced.';
  backupNote.append(backupNoteText);
  root.append(backupNote);
  const importFile = document.createElement('input');
  importFile.type = 'file';
  importFile.accept = 'application/json,.json';
  importFile.hidden = true;
  toolbars.settings.append(exportBtn, importBtn, backupInfo, importFile);

  let close: HTMLButtonElement | null = null;
  if (closable) {
    close = button('✕', 'ysg-btn ysg-btn--icon ysg-btn--close');
    close.title = 'Close (Esc)';
    close.setAttribute('aria-label', 'Close');
  }

  head.append(title, status, toolbars.groups, toolbars.data, toolbars.settings);
  if (close) head.append(close);

  const banner = el('p', 'ysg-banner') as HTMLParagraphElement;
  banner.hidden = true;

  /* Groups screen */
  const groupsScreen = el('section', 'ysg-screen');

  const groupList = el('ul', 'ysg-list ysg-list--groups') as HTMLUListElement;

  /*
   * The channels card, headed like the groups card above it.
   *
   * Title and controls on one line inside the card, rather than three loose
   * lines floating above a list. Two cards, each with a head and a body, is a
   * shape the eye can take in at a glance; the previous arrangement made the
   * channel list look like it belonged to whatever was above it.
   *
   * The controls fit on that line now because they are all icons — the search
   * box that used to need half a row opens on demand.
   */
  const channelsHead = el('div', 'ysg-pcard__head');
  const channelsHeadRow = el('div', 'ysg-pcard__headrow');
  const channelsTitle = el('h3', 'ysg-section-title');
  const channelsControls = el('div', 'ysg-section-controls');

  /*
   * Sorting, as an icon with a menu rather than a `<select>`.
   *
   * At panel width a select showing "Subscribers" ate a third of the line and
   * left the search box too narrow to read what you typed — and its own label
   * was invisible, so the word sat there unexplained. An icon costs 28px, says
   * "ordering" on sight, and the current choice is stated in full under the
   * list where there is room for it.
   *
   * Built from the same parts as the search-field picker below: a button, a
   * menu, one item per option. Same markup, same styles, same behaviour.
   */
  const sortBox = el('div', 'ysg-fields ysg-fields--icon');
  const sortButton = iconButton(
    ICONS.sort,
    'Sort channels — by name, last upload, subscribers or video count',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  sortButton.setAttribute('aria-expanded', 'false');
  sortButton.setAttribute('aria-haspopup', 'true');

  const sortMenu = el('div', 'ysg-fields__menu ysg-fields__menu--right');
  sortMenu.hidden = true;
  const sortOptions = new Map<SortKey, HTMLButtonElement>();
  for (const [value, label] of SORTS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ysg-menu__item ysg-menu__item--check';
    item.dataset.sort = value;
    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);
    sortMenu.append(item);
    sortOptions.set(value, item);
  }
  sortBox.append(sortButton, sortMenu);

  /*
   * Search: an icon until you want it, a field while you are using it.
   *
   * A permanent search box is a permanent claim on the width of a 380px panel,
   * for a control most visits never touch — and it was pushing sort and the
   * members toggle onto a line of their own. Open it and it takes the header;
   * leave it empty and it puts the header back.
   */
  const searchBox = el('div', 'ysg-searchbox');
  const searchButton = iconButton(
    ICONS.search,
    'Search channels by name',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'ysg-input ysg-search';
  search.placeholder = 'Search channels…';
  search.autocomplete = 'off';
  search.hidden = true;
  searchBox.append(searchButton, search);

  const membersOnly = iconButton(
    ICONS.members,
    'Show only channels in this group',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  membersOnly.setAttribute('aria-pressed', 'false');

  channelsControls.append(searchBox, sortBox, membersOnly);
  channelsHeadRow.append(channelsTitle, channelsControls);

  const hint = el('p', 'ysg-hint') as HTMLParagraphElement;
  const dataNote = el('p', 'ysg-hint ysg-hint--note') as HTMLParagraphElement;
  // The only scrolling region on this screen.
  const channelList = el('ul', 'ysg-list ysg-list--channels') as HTMLUListElement;

  // A stated rule between the two cards, because they are two different
  // subjects — which groups exist, and what is in the one you picked.
  const divider = el('div', 'ysg-divider');

  // Title and controls on one line, the sort readout under it — both above the
  // card's rule, so the head is one block and the list below it is the body.
  channelsHead.append(channelsHeadRow, dataNote);

  const channelsCard = el('div', 'ysg-pcard ysg-pcard--channels');
  channelsCard.append(channelsHead, hint, channelList);

  groupsScreen.append(groupList, divider, channelsCard);

  /* Charts & data screen */
  const dataScreen = el('section', 'ysg-screen');

  /* Settings screen */
  const settingsScreen = el('section', 'ysg-screen');
  /*
   * The subscription-status row is gone, and so is the backup prose.
   *
   * The status said in a paragraph what the header says in three words, and
   * the backup card was a card whose entire content described two buttons
   * sitting above it — an explanation of an explanation. What is worth keeping
   * of it now lives behind the (i) beside those buttons, where it is read at
   * the moment anyone wonders.
   */
  const settingsStatus = el('p', 'ysg-setting__value');
  settingsStatus.hidden = true;
  settingsScreen.append(settingsStatus);

  /* Charts, table and export — one filter, three things to do with it.
   *
   * They used to be two settings rows and a link to a separate page, which
   * meant choosing a group and a period twice: once to look, once to export.
   * The filter is the same question in all three cases, so it is asked once. */
  /*
   * A column of two cards sharing the height, not a grid of loose controls.
   *
   * It was `.ysg-export`, which this screen lays out as a two-column grid —
   * the right shape when it held a row of selects, the wrong one now that it
   * holds two lists that both want to be as tall as they can.
   */
  const csvControls = el('div', 'ysg-data-stack');
  /*
   * The scope picker: the same card of groups as the Groups screen, not a
   * dropdown of their names.
   *
   * A `<select>` gave one line to the most important filter on the screen, and
   * a long group name filled it edge to edge with no room for the counts that
   * tell you whether the group is worth charting at all. The list shows every
   * group at once, with the same tallies, so picking one is a comparison
   * rather than a recall exercise.
   *
   * It sets the chart scope only. Clicking a group here does not touch the
   * feed — that is what the identical-looking list on Groups is for, and the
   * fieldset's own heading says which is which.
   */
  const csvGroupList = el('ul', 'ysg-list ysg-list--groups ysg-list--picker');

  /*
   * The channels inside whatever the group picker is set to.
   *
   * Charting a group answers "who is posting"; the answer is usually one or
   * two names, and the next question is always about one of them. Clicking a
   * channel narrows the same picture to it rather than opening a different
   * one — the window, the search and the group all still apply, and the
   * overlay's heading says so.
   */
  const csvChannelList = el('ul', 'ysg-list ysg-list--groups ysg-list--picker ysg-list--channels-pick');
  /*
   * The window, as a clock on the "All subscriptions" row — the same control,
   * in the same place, as the feed period on the Groups screen.
   */
  const csvWindowBox = el('div', 'ysg-fields ysg-fields--icon');
  const csvWindowButton = iconButton(
    ICONS.period,
    'How far back the charts, table and export reach',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  csvWindowButton.setAttribute('aria-haspopup', 'true');
  csvWindowButton.setAttribute('aria-expanded', 'false');
  const csvWindowMenu = el('div', 'ysg-fields__menu ysg-fields__menu--fixed');
  csvWindowMenu.hidden = true;
  const csvWindowOptions = new Map<string, HTMLButtonElement>();
  for (const [value, label] of WINDOWS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'ysg-menu__item ysg-menu__item--check';
    const text = document.createElement('span');
    text.textContent = label;
    item.append(text);
    csvWindowMenu.append(item);
    csvWindowOptions.set(value, item);
  }
  csvWindowBox.append(csvWindowButton, csvWindowMenu);
  /*
   * Which fields the search looks at, as a control rather than a paragraph.
   *
   * It replaced four lines of prose explaining that titles and channel names
   * were searched. The prose was accurate, unread, and could not be argued
   * with — this can: tick only Channel name and "has" stops finding videos
   * whose titles happen to contain it.
   */
  const fieldsBox = el('div', 'ysg-fields ysg-fields--icon');
  const fieldsButton = iconButton(
    ICONS.fields,
    'Which fields the search looks at',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  fieldsButton.setAttribute('aria-haspopup', 'true');
  fieldsButton.setAttribute('aria-expanded', 'false');
  // Kept as the button's tooltip now that the chosen fields have no room to be
  // printed on its face — `renderFields` writes both.
  const fieldsLabel = el('span', 'ysg-fields__label');
  fieldsLabel.hidden = true;
  fieldsButton.append(fieldsLabel);

  const fieldsMenu = el('div', 'ysg-fields__menu ysg-fields__menu--fixed');
  fieldsMenu.hidden = true;
  const fieldBoxes = new Map<SearchField, HTMLInputElement>();
  for (const field of SEARCH_FIELDS) {
    const row = el('label', 'ysg-fields__item');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = field.id;
    const text = document.createElement('span');
    text.textContent = field.label;
    row.append(box, text);
    fieldsMenu.append(row);
    fieldBoxes.set(field.id, box);
  }
  fieldsBox.append(fieldsButton, fieldsMenu);

  /*
   * Search, opened by its own icon — the same control as on the Groups screen,
   * behaving the same way: a field while it holds something, an icon when it
   * does not.
   */
  const vizSearchBox = el('div', 'ysg-searchbox');
  const vizSearchButton = iconButton(
    ICONS.search,
    'Search these videos by title or channel',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  const vizSearch = document.createElement('input');
  vizSearch.type = 'search';
  vizSearch.className = 'ysg-input ysg-search';
  vizSearch.placeholder = 'Search title or channel…';
  vizSearch.title =
    'Under 4 characters, matches the start of a word — “has” finds HASfit, not “purchase”. ' +
    'The Table view highlights what matched.';
  vizSearch.autocomplete = 'off';
  vizSearch.hidden = true;
  vizSearchBox.append(vizSearchButton, vizSearch);

  /*
   * The picker's second line: what it is scoped to, said in words, and the two
   * controls that narrow it further.
   *
   * It sits under a rule below "All subscriptions", so the card reads the same
   * way the groups card does — the scope at the top, the settings that qualify
   * it beneath, then the groups themselves.
   */
  const scopeRow = document.createElement('li');
  scopeRow.className = 'ysg-group ysg-period-row ysg-scope-row';
  const scopeLabel = el('span', 'ysg-period-row__label');
  const scopeControls = el('div', 'ysg-section-controls');
  scopeControls.append(vizSearchBox, fieldsBox);
  scopeRow.append(scopeLabel, scopeControls);

  /*
   * Charts, Table and Export, as icons on the scope row.
   *
   * They are three ways of taking the same slice away with you, so they belong
   * beside the thing being sliced rather than stacked underneath it in two
   * more full-width controls. Charts and Table keep their pressed state — it
   * says which view the overlay is showing, not just which button you last
   * pressed.
   *
   * Charts and a table need width, which a 380px panel does not have. So the
   * panel keeps the controls and the drawing happens over the YouTube tab —
   * the tab the numbers are about — instead of in a page of its own.
   */
  const vizActions = el('div', 'ysg-section-controls');
  const chartButton = iconButton(
    ICONS.chart,
    'Open the charts over your YouTube tab',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  const tableButton = iconButton(
    ICONS.table,
    'Open the table over your YouTube tab',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  const csvButton = iconButton(
    ICONS.download,
    'Export these videos as a CSV file',
    'ysg-btn--icon ysg-btn--toggle',
    () => undefined,
  );
  vizActions.append(chartButton, tableButton, csvButton);
  /*
   * Every filter now lives inside the picker card itself.
   *
   * There is no "Filters" box any more: the window is a clock on the scope
   * row, and the search and its field list are icons on the line under it.
   * They were three full-width controls stacked in a second card, describing
   * the list in the first — restating in a box what the card above it was
   * already about.
   */
  // The same rule the Groups screen draws between its two cards: they answer
  // different questions — which group, then which channel inside it.
  csvControls.append(csvGroupList, el('div', 'ysg-divider'), csvChannelList);

  const helpButton = button('Open the guide', 'ysg-btn ysg-btn--wide');


  settingsScreen.append(
    settingRow(
      'Guide & help',
      helpButton,
      'How it works, known limits and troubleshooting — the page the browser opens on first run.',
    ),
  );

  /*
   * Its own screen, not a settings row.
   *
   * Settings is where you configure the extension once and leave; this is a
   * place you *work* — pick a group, pick a period, look, adjust, export. That
   * is a different kind of visit, and burying it under Settings made a
   * destination look like a preference.
   */
  dataScreen.append(csvControls);

  /*
   * Presets, as swatches.
   *
   * A panel that sits inside YouTube all day is furniture, and furniture is
   * allowed to be chosen. Each preset is a palette and nothing more, so this
   * cannot drift out of step with the rest of the interface — everything here
   * is drawn from the same tokens either way.
   */
  const themeRow = el('div', 'ysg-themes');
  const themeButtons = new Map<string, HTMLButtonElement>();
  for (const [id, label, swatch] of THEMES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ysg-theme';
    btn.dataset.theme = id;
    btn.title = label;
    btn.setAttribute('aria-pressed', 'false');
    const dot = el('span', 'ysg-theme__dot');
    dot.style.background = swatch;
    const text = el('span', 'ysg-theme__label');
    text.textContent = label;
    btn.append(dot, text);
    themeRow.append(btn);
    themeButtons.set(id, btn);
  }

  settingsScreen.append(
    settingRow('Appearance', themeRow, 'How the panel looks. Nothing else changes.'),
  );

  const languageSelect = document.createElement('select');
  languageSelect.className = 'ysg-sort';
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = 'Detect automatically';
  languageSelect.append(auto);
  for (const language of LANGUAGES) {
    const option = document.createElement('option');
    option.value = language.code;
    option.textContent = language.label;
    languageSelect.append(option);
  }

  settingsScreen.append(
    settingRow(
      'Feed language',
      languageSelect,
      'The period filter reads the “5 days ago” line on each video, so it needs to know ' +
        'the language YouTube is showing you. Detection is right almost always — set it ' +
        'here if a period filter is not matching anything.',
    ),
  );

  const promptToggle = document.createElement('input');
  promptToggle.type = 'checkbox';
  const toggleLabel = el('label', 'ysg-toggle');
  const toggleText = document.createElement('span');
  toggleText.textContent = 'Ask which group when I subscribe';
  toggleLabel.append(promptToggle, toggleText);

  settingsScreen.append(
    settingRow(
      'On subscribing',
      toggleLabel,
      'Offers a group picker the moment you subscribe — the one point where you already know where a channel belongs.',
    ),
  );

  /* Rail */
  const rail = el('nav', 'ysg-rail');
  rail.setAttribute('aria-label', 'Sections');
  const railButtons = {} as Record<ScreenId, HTMLButtonElement>;
  for (const def of SCREENS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ysg-rail__btn';
    btn.title = def.title;
    btn.setAttribute('aria-label', def.title);
    btn.append(icon(def.icon));
    railButtons[def.id] = btn;
    rail.append(btn);
  }

  // Pushed to the bottom of the rail: navigation at the top, everything that
  // leaves the extension at the foot, the way a nav sidebar is usually read.
  const menuButton = document.createElement('button');
  menuButton.type = 'button';
  menuButton.className = 'ysg-rail__btn ysg-rail__btn--foot';
  menuButton.title = 'Help, feedback & legal';
  menuButton.setAttribute('aria-label', 'Help, feedback and legal');
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.append(icon(ICONS.more));
  rail.append(menuButton);

  const menu = el('div', 'ysg-menu');
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  for (const item of menuItems()) {
    const entry = document.createElement('button');
    entry.type = 'button';
    entry.className = 'ysg-menu__item';
    entry.setAttribute('role', 'menuitem');
    entry.append(icon(item.icon, 15));
    const label = document.createElement('span');
    label.textContent = item.label;
    entry.append(label);
    entry.addEventListener('click', () => {
      menu.hidden = true;
      menuButton.setAttribute('aria-expanded', 'false');
      item.run();
    });
    menu.append(entry);
  }

  const screens: Record<ScreenId, HTMLElement> = {
    groups: groupsScreen,
    data: dataScreen,
    settings: settingsScreen,
  };

  /* Channel hover card — one element, reused for every row. */
  const cardRoot = el('div', 'ysg-card');
  cardRoot.hidden = true;
  const cardAvatar = document.createElement('img');
  cardAvatar.className = 'ysg-card__avatar';
  cardAvatar.alt = '';
  const cardName = el('p', 'ysg-card__name');
  const cardHandle = el('p', 'ysg-card__handle');
  const cardStats = el('p', 'ysg-card__stats');
  const cardLatest = el('p', 'ysg-card__latest');
  const cardView = button('View channel', 'ysg-btn ysg-btn--primary ysg-card__view');

  const cardHead = el('div', 'ysg-card__head');
  const cardText = el('div', 'ysg-card__text');
  cardText.append(cardName, cardHandle);
  cardHead.append(cardAvatar, cardText);
  cardRoot.append(cardHead, cardStats, cardLatest, cardView);

  const body = el('div', 'ysg-body');
  const screensWrap = el('div', 'ysg-screens');
  screensWrap.append(groupsScreen, dataScreen, settingsScreen);
  body.append(screensWrap, rail);

  // A version is the first thing any bug report needs and the last thing anyone
  // can find. One line, always visible, costs 20px.
  //
  // The account id sits beside it for the same reason. Which YouTube account a
  // panel is showing is otherwise invisible — the groups on screen are the only
  // clue, and "these are the wrong groups" is exactly the report where you
  // cannot trust that clue.
  const foot = el('div', 'ysg-foot');
  const manifest = chrome.runtime.getManifest();
  const version = document.createElement('span');
  version.className = 'ysg-foot__version';
  version.textContent = `v${manifest.version}`;
  const studio = document.createElement('button');
  studio.type = 'button';
  studio.className = 'ysg-foot__link';
  studio.textContent = 'CoolSoftware';
  studio.addEventListener('click', () => void chrome.tabs.create({ url: `${SITE}${PRODUCT_PATH}` }));
  foot.append(version, studio);

  /*
   * Signed-out scrim.
   *
   * Everything behind it is furniture for data we cannot fetch: an empty group
   * list, a channel search with nothing to search, a Refresh that will fail the
   * same way again. Dimming the lot and lighting one card says "this first"
   * far better than a banner above a working-looking screen does. Last in the
   * DOM so it sits over the menus too.
   */
  const signIn = el('div', 'ysg-signin');
  signIn.hidden = true;
  const signInCard = el('div', 'ysg-signin__card');
  const signInTitle = el('h3', 'ysg-signin__title');
  signInTitle.textContent = 'Sign in to YouTube';
  const signInBody = el('p', 'ysg-signin__body');
  signInBody.textContent =
    'Your groups live in this browser, but the subscription list itself comes from YouTube — and YouTube only hands it to a signed-in session. Sign in, then try again.';
  const signInActions = el('div', 'ysg-signin__actions');
  const signInGo = document.createElement('button');
  signInGo.type = 'button';
  signInGo.className = 'ysg-signin__go';
  signInGo.textContent = 'Sign in to YouTube';
  const signInRetry = document.createElement('button');
  signInRetry.type = 'button';
  signInRetry.className = 'ysg-signin__retry';
  signInRetry.textContent = 'Try again';
  signInActions.append(signInGo, signInRetry);
  signInCard.append(signInTitle, signInBody, signInActions);
  signIn.append(signInCard);

  root.append(head, banner, body, foot, menu, cardRoot, signIn);

  return {
    root,
    title,
    status,
    settingsStatus,
    close,
    banner,
    signIn,
    signInGo,
    signInRetry,
    screens,
    toolbars,
    railButtons,
    refreshButtons,
    refreshInfoButtons,
    refreshNote,
    exportBtn,
    backupInfo,
    backupNote,
    importBtn,
    importFile,
    addGroup,
    periodBox,
    periodButton,
    periodMenu,
    periodOptions,
    periodLabel,
    periodRow,
    membersOnly,
    groupList,
    rowMenu,
    rowActions,
    rowConfirm,
    rowConfirmText,
    rowRename,
    rowDelete,
    rowCancel,
    rowConfirmDo,
    channelsTitle,
    sortBox,
    sortButton,
    sortMenu,
    sortOptions,
    search,
    searchBox,
    searchButton,
    channelsHead,
    hint,
    dataNote,
    channelList,
    promptToggle,
    themeButtons,
    languageSelect,
    menuButton,
    menu,
    version,
    helpButton,
    csvGroupList,
    csvChannelList,
    csvWindowBox,
    csvWindowButton,
    csvWindowMenu,
    csvWindowOptions,
    scopeRow,
    scopeLabel,
    vizSearchBox,
    vizSearchButton,
    vizSearch,
    fieldsBox,
    fieldsButton,
    fieldsLabel,
    fieldsMenu,
    fieldBoxes,
    vizActions,
    chartButton,
    tableButton,
    csvButton,
    card: {
      root: cardRoot,
      avatar: cardAvatar,
      name: cardName,
      handle: cardHandle,
      stats: cardStats,
      latest: cardLatest,
      view: cardView,
    },
  };
}

/**
 * Show the subscription feed, doing as little as possible to get there.
 *
 * In order: if a tab is already on the feed, just focus it — never navigate it.
 * Reloading a feed you are already looking at throws away your scroll position
 * and everything YouTube has lazily loaded, to arrive at the page you were
 * already on; the filter itself needs no reload, because the content script
 * re-applies it from a storage change. Otherwise reuse a YouTube tab, since
 * people live in one of those and stacking duplicates is its own clutter.
 */
export async function openSubscriptionFeed(): Promise<void> {
  const url = 'https://www.youtube.com/feed/subscriptions';

  const onFeed = await chrome.tabs.query({ url: '*://*.youtube.com/feed/subscriptions*' });
  const feedTab = onFeed[0];
  if (feedTab?.id !== undefined) {
    if (!feedTab.active) await chrome.tabs.update(feedTab.id, { active: true });
    if (feedTab.windowId !== undefined) {
      await chrome.windows.update(feedTab.windowId, { focused: true });
    }
    return;
  }

  const anyYouTube = await chrome.tabs.query({ url: '*://*.youtube.com/*' });
  const target = anyYouTube[0];
  if (target?.id !== undefined) {
    await chrome.tabs.update(target.id, { active: true, url });
    return;
  }

  await chrome.tabs.create({ url });
}

/** The most recent "seen" timestamp, as a cheap signature of the whole map. */
function seenStamp(store: StoreShape): number {
  let max = 0;
  for (const at of Object.values(store.channelSeenAt)) if (at > max) max = at;
  return max;
}

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function groupName(text: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = 'ysg-group__name';
  span.textContent = text;
  return span;
}

/** A labelled group of controls, so a screen reads as sections not a stack. */
function fieldset(title: string, help: string, body: HTMLElement): HTMLElement {
  const box = el('div', 'ysg-fieldset');
  const heading = el('p', 'ysg-fieldset__title');
  heading.textContent = title;
  const note = el('p', 'ysg-fieldset__help');
  note.textContent = help;
  box.append(heading, note, body);
  return box;
}

function settingRow(label: string, control: HTMLElement, help?: string): HTMLElement {
  const row = el('div', 'ysg-setting');
  const name = el('h3', 'ysg-setting__label');
  name.textContent = label;
  row.append(name, control);
  if (help) {
    const hint = el('p', 'ysg-setting__help');
    hint.textContent = help;
    row.append(hint);
  }
  return row;
}

function note(text: string): HTMLElement {
  const p = el('p', 'ysg-setting__value');
  p.textContent = text;
  return p;
}

/** A 24×24 stroked icon. Stroke, not fill, so one path serves both themes. */
/**
 * Did this click land on a control inside a clickable row, rather than on the
 * row itself?
 *
 * Asked at the row, once, instead of stopping propagation in every button —
 * the rows carry menus and toggles now, and the failure mode of forgetting is
 * silent: the row acts too, and the action you meant is undone by the one you
 * did not.
 */
function fromControl(event: Event): boolean {
  const target = event.target as Element | null;
  return target?.closest('button, select, input, .ysg-fields, .ysg-searchbox') !== null;
}

/** "SHOWING" — the one row the subscription feed is currently filtered to. */
function showingPill(): HTMLElement {
  const pill = el('span', 'ysg-showing');
  pill.textContent = 'Showing';
  pill.title = 'Your subscription feed is filtered to this';
  return pill;
}

function icon(path: string, size = 20): SVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const node = document.createElementNS(ns, 'path');
  node.setAttribute('d', path);
  svg.append(node);
  return svg;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** A button whose whole content is an icon; the label lives in the tooltip. */
function iconButton(
  path: string,
  label: string,
  className: string,
  onClick: (e: MouseEvent) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `ysg-btn ${className}`;
  btn.title = label;
  btn.setAttribute('aria-label', label);
  btn.append(icon(path, 15));
  btn.addEventListener('click', onClick);
  return btn;
}

function button(
  label: string,
  className: string,
  onClick?: (e: MouseEvent) => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = label;
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/* ── Formatting ──────────────────────────────────────────────────────── */

/**
 * Put the card beside its row, inside the panel.
 *
 * Anchored to the row's left edge and flipped above when there is no room
 * below — a panel is tall and narrow, so the bottom rows are exactly where a
 * naive "always below" card would be cut off.
 */
/**
 * Place the hover card near its row, without landing on the tick boxes.
 *
 * It opens below the row it describes, which means it covers the rows under
 * it — and those rows' checkboxes are the whole point of the list. Ticking a
 * channel is the job; reading about one is the aside, and the aside was
 * sitting on top of the job.
 *
 * So the card starts to the right of the checkbox column, measured from the
 * checkbox itself rather than from a guessed offset, so it stays right if the
 * row's grid ever changes. Rows without one — the channel picker on Charts &
 * data — keep the old left edge.
 */
function positionCard(card: HTMLElement, row: HTMLElement): void {
  const margin = 8;
  const rect = row.getBoundingClientRect();
  const width = card.offsetWidth || 260;
  const height = card.offsetHeight || 150;

  const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
  const from = box ? box.getBoundingClientRect().right + 8 : rect.left;
  const left = Math.min(Math.max(margin, from), window.innerWidth - width - margin);
  const below = rect.bottom + 6;
  const flip = below + height > window.innerHeight;

  card.style.left = `${left}px`;
  card.style.top = flip ? `${Math.max(margin, rect.top - height - 6)}px` : `${below}px`;
}

/**
 * An account, written out for the console.
 *
 * All three parts, because which one is missing is the diagnosis: two accounts
 * reporting the same `authuser` cannot be told apart by it, and a brand
 * account with no page id cannot be asked for at all.
 */
function describe(account: ActiveAccount | AccountIdentity | null): string {
  if (!account) return '(none)';
  return `${account.id} [authuser=${account.sessionIndex ?? '-'}, pageId=${account.pageId ?? '-'}]`;
}

/**
 * Prefer YouTube's own strings over our parsed numbers — they are already
 * localised and abbreviated the way the user expects to read them.
 */
export function statsLine(channel: Channel): string {
  const parts: string[] = [];
  if (channel.subscriberText) parts.push(channel.subscriberText);
  else if (channel.subscriberCount !== null) parts.push(`${channel.subscriberCount} subscribers`);
  if (channel.videoText) parts.push(channel.videoText);
  else if (channel.videoCount !== null) parts.push(`${channel.videoCount} videos`);
  return parts.join(' · ') || 'No stats available';
}

function relativeTime(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
