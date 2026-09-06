/**
 * The side panel: the whole research library, independent of whatever tab is
 * active. Unlike a per-page tool, this panel owns its own read of storage —
 * there is one writer (chrome.storage.local) and the panel simply reflects it,
 * refreshing on chrome.storage.onChanged so a save made from the content
 * script shows up here immediately without polling (PRD §7: foreground only).
 */

import { matchesSearch } from './capture';
import { buildExportFilename, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, thumbnailCaptureRate, track } from './metrics';
import {
  addCollection,
  clearAllData,
  deletePost,
  exportBackup,
  importBackup,
  quotaStatus,
  readAllPosts,
  readCollections,
  renameCollection,
  savePost,
} from './storage';
import { Collection, SavedPost } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  search: $<HTMLInputElement>('search'),
  newCollectionBtn: $<HTMLButtonElement>('new-collection'),
  newCollectionForm: $<HTMLFormElement>('new-collection-form'),
  newCollectionName: $<HTMLInputElement>('new-collection-name'),
  newCollectionCancel: $<HTMLButtonElement>('new-collection-cancel'),
  loading: $('loading'),
  state: $('state'),
  collections: $('collections'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataClose: $<HTMLButtonElement>('data-close'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  exportJson: $<HTMLButtonElement>('export-json'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let posts: SavedPost[] = [];
let collections: Collection[] = [];
let searchQuery = '';
let searchTracked = false;
let hasLoadedOnce = false;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(title: string, body: string): void {
  els.collections.hidden = true;
  els.state.hidden = false;
  els.state.replaceChildren();

  const icon = document.createElement('img');
  icon.className = 'state__icon';
  icon.src = chrome.runtime.getURL('icons/icon-128.png');
  icon.alt = '';
  icon.width = 44;
  icon.height = 44;

  const heading = document.createElement('strong');
  heading.className = 'state__title';
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'state__body';
  text.textContent = body;

  els.state.append(icon, heading, text);
}

/* ── Loading + fetching ──────────────────────────────────────────────── */

async function load(): Promise<void> {
  // Only show the loading skeleton on the very first read — a refresh
  // triggered by chrome.storage.onChanged should update in place, never
  // flash the panel back to a blank/loading state (no layout shift on
  // interactions the user just performed themselves).
  if (!hasLoadedOnce) {
    els.loading.hidden = false;
    els.state.hidden = true;
    els.collections.hidden = true;
  }

  [posts, collections] = await Promise.all([readAllPosts(), readCollections()]);
  hasLoadedOnce = true;

  els.loading.hidden = true;
  render();

  const quota = await quotaStatus();
  if (quota.warn) {
    const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
    setStatus(`Local storage ${mb} MB — over 80% full. Export from “Data” before it fills up.`);
  }
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toLocaleString('en-US');
}

function buildCardItem(post: SavedPost): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'card-item';

  const thumb = document.createElement('img');
  thumb.className = 'card-item__thumb';
  thumb.src = post.thumbnail || chrome.runtime.getURL('icons/icon-128.png');
  thumb.alt = '';
  thumb.width = 64;
  thumb.height = 64;
  thumb.loading = 'lazy';
  thumb.decoding = 'async';
  li.appendChild(thumb);

  const body = document.createElement('div');
  body.className = 'card-item__body';

  const head = document.createElement('div');
  head.className = 'card-item__head';

  const handle = document.createElement('a');
  handle.className = 'card-item__handle';
  handle.href = post.postUrl;
  handle.target = '_blank';
  handle.rel = 'noopener noreferrer';
  handle.textContent = `@${post.creatorHandle || 'unknown'}`;
  handle.addEventListener('click', () => void track('post_opened'));
  head.appendChild(handle);

  if (post.mediaType === 'reel') {
    const badge = document.createElement('span');
    badge.className = 'card-item__badge';
    badge.textContent = 'Reel';
    head.appendChild(badge);
  }
  if (post.carouselCount) {
    const badge = document.createElement('span');
    badge.className = 'card-item__badge';
    badge.textContent = `${post.carouselCount} slides`;
    head.appendChild(badge);
  }
  body.appendChild(head);

  const metrics = document.createElement('p');
  metrics.className = 'card-item__metrics';
  metrics.textContent = `${formatMetric(post.metrics.views)} views · ${formatMetric(post.metrics.likes)} likes · ${formatMetric(post.metrics.comments)} comments`;
  body.appendChild(metrics);

  if (post.caption.trim()) {
    const caption = document.createElement('p');
    caption.className = 'card-item__caption';
    caption.textContent = post.caption;
    caption.title = 'Click to expand';
    caption.addEventListener('click', () => caption.classList.toggle('card-item__caption--full'));
    body.appendChild(caption);
  }

  const note = document.createElement('textarea');
  note.className = 'card-item__note';
  note.rows = 1;
  note.placeholder = 'Note…';
  note.value = post.note;
  note.setAttribute('aria-label', `Note on @${post.creatorHandle || 'this post'}`);
  note.addEventListener('blur', () => {
    if (note.value === post.note) return;
    void savePost(post.id, existing => ({ ...(existing ?? post), note: note.value })).then(() => {
      void track('note_saved');
      void load();
    });
  });
  body.appendChild(note);

  const row = document.createElement('div');
  row.className = 'card-item__row';

  const select = document.createElement('select');
  select.className = 'card-item__select';
  select.setAttribute('aria-label', `Move @${post.creatorHandle || 'this post'} to a different collection`);
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    option.selected = collection.id === post.collectionId;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    void savePost(post.id, existing => ({ ...(existing ?? post), collectionId: select.value })).then(() => {
      void track('move_collection');
      void load();
    });
  });
  row.appendChild(select);

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'link-btn';
  del.textContent = 'Delete';
  del.style.marginLeft = 'auto';
  del.addEventListener('click', () => {
    if (!confirm(`Remove the saved post from @${post.creatorHandle || 'this creator'}?`)) return;
    void deletePost(post.id).then(() => {
      void track('save_deleted');
      void load();
    });
  });
  row.appendChild(del);

  body.appendChild(row);
  li.appendChild(body);
  return li;
}

function render(): void {
  const filtered = posts.filter(post => matchesSearch(post, searchQuery));

  els.summary.textContent = posts.length
    ? `${posts.length} saved post${posts.length === 1 ? '' : 's'} across ${collections.length} collection${collections.length === 1 ? '' : 's'}`
    : '';

  if (!posts.length) {
    showState(
      'Nothing saved yet',
      'Browse Instagram and hover a post or Reel, or open one, then click “+ Save to Research”.'
    );
    return;
  }

  if (searchQuery.trim() && !filtered.length) {
    showState('No matches', `No saved posts match “${searchQuery.trim()}”.`);
    return;
  }

  els.state.hidden = true;
  els.collections.hidden = false;
  els.collections.replaceChildren();

  const byCollection = new Map<string, SavedPost[]>();
  for (const post of filtered) {
    const list = byCollection.get(post.collectionId) ?? [];
    list.push(post);
    byCollection.set(post.collectionId, list);
  }

  for (const collection of collections) {
    const list = (byCollection.get(collection.id) ?? []).sort((a, b) => b.savedAt - a.savedAt);
    // While searching, an empty collection is noise; hide it rather than pad
    // the results with sections that have nothing to show.
    if (searchQuery.trim() && !list.length) continue;

    const section = document.createElement('section');
    section.className = 'collection';

    const header = document.createElement('div');
    header.className = 'collection__header';

    const nameBtn = document.createElement('button');
    nameBtn.type = 'button';
    nameBtn.className = 'collection__name';
    nameBtn.textContent = collection.name;
    nameBtn.title = 'Click to rename';
    nameBtn.addEventListener('click', () => startRename(collection, header, nameBtn));
    header.appendChild(nameBtn);

    const count = document.createElement('span');
    count.className = 'collection__count';
    count.textContent = String(list.length);
    header.appendChild(count);

    section.appendChild(header);

    if (!list.length) {
      const empty = document.createElement('p');
      empty.className = 'collection__empty';
      empty.textContent = 'No posts yet — move one here from another collection.';
      section.appendChild(empty);
    } else {
      const ul = document.createElement('ul');
      ul.className = 'cards';
      for (const post of list) ul.appendChild(buildCardItem(post));
      section.appendChild(ul);
    }

    els.collections.appendChild(section);
  }
}

function startRename(collection: Collection, header: HTMLElement, nameBtn: HTMLButtonElement): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'collection__name-edit';
  input.value = collection.name;
  header.replaceChild(input, nameBtn);
  input.focus();
  input.select();

  const commit = () => {
    const next = input.value.trim();
    if (next && next !== collection.name) {
      void renameCollection(collection.id, next).then(() => {
        void track('collection_renamed');
        void load();
      });
    } else {
      void load();
    }
  };

  input.addEventListener('blur', commit);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.blur();
    if (event.key === 'Escape') {
      input.value = collection.name;
      input.blur();
    }
  });
}

/* ── Export / import / clear ────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportCsv(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(
      new Blob([toCsv(backup.posts, backup.collections)], { type: 'text/csv;charset=utf-8' }),
      buildExportFilename('csv')
    );
    setStatus(`Exported ${backup.posts.length} post${backup.posts.length === 1 ? '' : 's'} as CSV`);
    void track('export_csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the CSV file.');
  }
}

async function exportMd(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(
      new Blob([toMarkdown(backup.posts, backup.collections)], { type: 'text/markdown;charset=utf-8' }),
      buildExportFilename('md')
    );
    setStatus(`Exported ${backup.posts.length} post${backup.posts.length === 1 ? '' : 's'} as Markdown`);
    void track('export_md');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the Markdown file.');
  }
}

async function exportJson(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }),
      buildExportFilename('json')
    );
    setStatus(`Exported ${backup.posts.length} post${backup.posts.length === 1 ? '' : 's'} as a full backup`);
    void track('export_json');
    void track('data_exported');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.posts} post${result.posts === 1 ? '' : 's'} and ${result.collections} new collection${result.collections === 1 ? '' : 's'}`);
    void track('data_imported');
    await load();
  } catch (error: any) {
    // Never surface a raw parse error — plain language only.
    setStatus(error?.message || 'That file could not be read. Make sure it is a Research Saver backup.');
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const rate = thumbnailCaptureRate(metrics);
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    rate === null
      ? 'Thumbnail capture: no data yet'
      : `Thumbnail capture: ${rate}% saved as a local image (rest fall back to the remote URL)`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

els.search.addEventListener('input', () => {
  searchQuery = els.search.value;
  render();
});
els.search.addEventListener('change', () => {
  if (els.search.value.trim() && !searchTracked) {
    searchTracked = true;
    void track('search_used');
  }
});

els.newCollectionBtn.addEventListener('click', () => {
  els.newCollectionForm.hidden = !els.newCollectionForm.hidden;
  if (!els.newCollectionForm.hidden) els.newCollectionName.focus();
});
els.newCollectionCancel.addEventListener('click', () => {
  els.newCollectionForm.hidden = true;
  els.newCollectionName.value = '';
});
els.newCollectionForm.addEventListener('submit', event => {
  event.preventDefault();
  const name = els.newCollectionName.value.trim();
  if (!name) return;
  void addCollection(name).then(() => {
    void track('collection_created');
    els.newCollectionForm.hidden = true;
    els.newCollectionName.value = '';
    void load();
  });
});

els.dataToggle.addEventListener('click', async () => {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and remove a few posts.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
});
els.dataClose.addEventListener('click', () => els.data.close());
els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportMd.addEventListener('click', () => void exportMd());
els.exportJson.addEventListener('click', () => void exportJson());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every saved post and collection? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void load();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

// The content script's saves land straight in storage; reflect them live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (Object.keys(changes).some(key => key.startsWith('irs:post:') || key === 'irs:collections')) {
    void load();
  }
});

void (async () => {
  void track('panel_opened');
  await load();
})();
