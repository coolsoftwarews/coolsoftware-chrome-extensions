/**
 * The side panel: the whole research library, search, grouping, export and
 * data ownership. Unlike WebHighlighter this panel is not scoped to the
 * active tab — the library is global, so it reads chrome.storage.local
 * directly and re-renders on chrome.storage.onChanged, which also picks up
 * saves made by content.ts on a Pinterest tab in the background.
 */

import { defaultCollections, groupByDomain, matchesSearch } from './capture';
import { buildExportFilename, toCsv, toMarkdown } from './formatters';
import { clearMetrics, readMetrics, thumbnailCaptureRate, track } from './metrics';
import {
  addCollection,
  clearAllData,
  deleteCollection,
  deletePin,
  exportBackup,
  importBackup,
  quotaStatus,
  readAllPins,
  readCollections,
  renameCollection,
  updatePin,
} from './storage';
import { Collection, PinCapture } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  count: $('count'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  search: $<HTMLInputElement>('search'),
  viewCollection: $<HTMLButtonElement>('view-collection'),
  viewDomain: $<HTMLButtonElement>('view-domain'),
  chips: $('chips'),
  state: $('state'),
  list: $('list'),
  status: $('status'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  exportJson: $<HTMLButtonElement>('export-json'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  data: $<HTMLDialogElement>('data'),
  quota: $('quota'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  collectionManager: $('collection-manager'),
  newCollectionName: $<HTMLInputElement>('new-collection-name'),
  newCollectionAdd: $<HTMLButtonElement>('new-collection-add'),
  stats: $<HTMLDialogElement>('stats'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let pins: PinCapture[] = [];
let collections: Collection[] = [];
let query = '';
let view: 'collection' | 'domain' = 'collection';
let activeCollectionId: string | 'all' = 'all';
let searchDebounce: number | undefined;

function setStatus(message: string): void {
  els.status.textContent = message;
}

/* ── Loading ─────────────────────────────────────────────────────────── */

async function load(): Promise<void> {
  [pins, collections] = await Promise.all([readAllPins(), readCollections()]);
  render();
}

/* ── Rendering ───────────────────────────────────────────────────────── */

function collectionName(id: string): string {
  return collections.find(c => c.id === id)?.name ?? 'Uncategorized';
}

function renderChips(): void {
  els.chips.replaceChildren();
  if (view !== 'collection') {
    els.chips.hidden = true;
    return;
  }
  els.chips.hidden = false;

  const all = document.createElement('button');
  all.type = 'button';
  all.className = `chip${activeCollectionId === 'all' ? ' chip--on' : ''}`;
  all.textContent = `All · ${pins.length}`;
  all.setAttribute('role', 'tab');
  all.setAttribute('aria-selected', String(activeCollectionId === 'all'));
  all.addEventListener('click', () => {
    activeCollectionId = 'all';
    render();
  });
  els.chips.appendChild(all);

  for (const collection of collections) {
    const count = pins.filter(p => p.collectionId === collection.id).length;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${activeCollectionId === collection.id ? ' chip--on' : ''}`;
    chip.textContent = `${collection.name} · ${count}`;
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', String(activeCollectionId === collection.id));
    chip.addEventListener('click', () => {
      activeCollectionId = collection.id;
      render();
    });
    els.chips.appendChild(chip);
  }
}

function renderGroupHeader(text: string): HTMLElement {
  const header = document.createElement('div');
  header.className = 'group-header';
  header.textContent = text;
  return header;
}

function renderCard(pin: PinCapture): HTMLElement {
  const card = document.createElement('article');
  card.className = 'card';

  if (pin.imageUrl) {
    const img = document.createElement('img');
    img.className = 'card__thumb';
    img.src = pin.imageUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.width = 64;
    img.height = 64;
    card.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.className = 'card__thumb card__thumb--empty';
    placeholder.textContent = 'no image';
    card.appendChild(placeholder);
  }

  const body = document.createElement('div');
  body.className = 'card__body';

  const title = document.createElement('p');
  title.className = 'card__title';
  const titleLink = document.createElement('a');
  titleLink.href = pin.pinUrl;
  titleLink.target = '_blank';
  titleLink.rel = 'noopener noreferrer';
  titleLink.textContent = pin.title || 'Untitled pin';
  titleLink.addEventListener('click', () => void track('pin_opened'));
  title.appendChild(titleLink);
  body.appendChild(title);

  if (pin.destinationDomain) {
    const domain = document.createElement('a');
    domain.className = 'card__domain';
    domain.textContent = pin.destinationDomain;
    if (pin.destinationUrl) {
      domain.href = pin.destinationUrl;
      domain.target = '_blank';
      domain.rel = 'noopener noreferrer';
    } else {
      domain.removeAttribute('href');
    }
    body.appendChild(domain);
  }

  if (pin.description.trim()) {
    const desc = document.createElement('p');
    desc.className = 'card__desc';
    desc.textContent = pin.description;
    body.appendChild(desc);
  }

  if (pin.descriptionTruncated) {
    const flag = document.createElement('p');
    flag.className = 'card__flag';
    flag.textContent = pin.description.trim()
      ? 'Description may be incomplete — captured from the grid.'
      : 'No description captured — open the pin and save from its detail page for the full text.';
    body.appendChild(flag);
  }

  const metaParts = [pin.boardName, pin.creator, pin.savesRaw && `${pin.savesRaw} saves`, `seen ${pin.dateSeen}`].filter(
    Boolean
  );
  if (metaParts.length) {
    const meta = document.createElement('p');
    meta.className = 'card__meta';
    meta.textContent = metaParts.join(' · ');
    body.appendChild(meta);
  }

  const note = document.createElement('textarea');
  note.className = 'card__note';
  note.rows = 1;
  note.value = pin.note;
  note.placeholder = 'Why did you save this?';
  note.addEventListener('blur', () => {
    if (note.value === pin.note) return;
    void updatePin(pin.id, { note: note.value }).then(() => {
      void track('note_saved');
      void load();
    });
  });
  body.appendChild(note);

  const actions = document.createElement('div');
  actions.className = 'card__actions';

  const select = document.createElement('select');
  select.className = 'card__select';
  select.setAttribute('aria-label', `Move "${pin.title || 'this pin'}" to a different collection`);
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    option.selected = collection.id === pin.collectionId;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    void updatePin(pin.id, { collectionId: select.value }).then(() => {
      void track('move_collection');
      void load();
    });
  });
  actions.appendChild(select);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'link-btn';
  deleteButton.textContent = 'Delete';
  deleteButton.addEventListener('click', () => {
    if (!confirm('Remove this pin from your research?')) return;
    void deletePin(pin.id).then(() => {
      void track('pin_deleted');
      void load();
    });
  });
  actions.appendChild(deleteButton);

  body.appendChild(actions);
  card.appendChild(body);
  return card;
}

function render(): void {
  renderChips();

  const filtered = pins.filter(p => matchesSearch(p, query));
  els.count.textContent = query
    ? `${filtered.length} of ${pins.length} pin${pins.length === 1 ? '' : 's'}`
    : `${pins.length} pin${pins.length === 1 ? '' : 's'} saved`;

  const hasAnyExport = pins.length > 0;
  els.exportCsv.disabled = !hasAnyExport;
  els.exportMd.disabled = !hasAnyExport;
  els.exportJson.disabled = !hasAnyExport;

  if (!pins.length) {
    els.state.hidden = false;
    els.list.hidden = true;
    els.state.replaceChildren();
    const text = document.createElement('p');
    text.className = 'state__text';
    text.textContent =
      'Click "+ Save to research" on any pin in the grid, or on a pin\'s own page, to start building a research file.';
    els.state.appendChild(text);
    return;
  }

  if (!filtered.length) {
    els.state.hidden = false;
    els.list.hidden = true;
    els.state.replaceChildren();
    const text = document.createElement('p');
    text.className = 'state__text';
    text.textContent = `No saved pins match "${query}".`;
    els.state.appendChild(text);
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;
  els.list.replaceChildren();

  if (view === 'domain') {
    for (const group of groupByDomain(filtered)) {
      els.list.appendChild(renderGroupHeader(`${group.domain} · ${group.count}`));
      for (const pin of group.pins) els.list.appendChild(renderCard(pin));
    }
    return;
  }

  if (activeCollectionId === 'all') {
    for (const collection of collections) {
      const list = filtered.filter(p => p.collectionId === collection.id).sort((a, b) => b.savedAt - a.savedAt);
      if (!list.length) continue;
      els.list.appendChild(renderGroupHeader(`${collection.name} · ${list.length}`));
      for (const pin of list) els.list.appendChild(renderCard(pin));
    }
    const knownIds = new Set(collections.map(c => c.id));
    const orphans = filtered.filter(p => !knownIds.has(p.collectionId)).sort((a, b) => b.savedAt - a.savedAt);
    if (orphans.length) {
      els.list.appendChild(renderGroupHeader(`Uncategorized · ${orphans.length}`));
      for (const pin of orphans) els.list.appendChild(renderCard(pin));
    }
  } else {
    for (const pin of filtered.filter(p => p.collectionId === activeCollectionId).sort((a, b) => b.savedAt - a.savedAt)) {
      els.list.appendChild(renderCard(pin));
    }
  }
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function exportCsv(): Promise<void> {
  const csv = toCsv(pins, collections);
  try {
    await download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), buildExportFilename('csv'));
    setStatus(`Exported ${pins.length} pin${pins.length === 1 ? '' : 's'} as .csv`);
    void track('export_csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .csv file.');
  }
}

async function exportMd(): Promise<void> {
  const md = toMarkdown(pins, collections);
  try {
    await download(new Blob([md], { type: 'text/markdown;charset=utf-8' }), buildExportFilename('md'));
    setStatus(`Exported ${pins.length} pin${pins.length === 1 ? '' : 's'} as .md`);
    void track('export_md');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .md file.');
  }
}

async function exportJson(): Promise<void> {
  const backup = await exportBackup();
  try {
    await download(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }),
      buildExportFilename('json')
    );
    setStatus(`Exported ${backup.pins.length} pin${backup.pins.length === 1 ? '' : 's'} as .json`);
    void track('export_json');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .json file.');
  }
}

/* ── Data ownership ─────────────────────────────────────────────────── */

function renderCollectionManager(): void {
  els.collectionManager.replaceChildren();
  for (const collection of collections) {
    const li = document.createElement('li');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = collection.name;
    input.setAttribute('aria-label', `Rename collection "${collection.name}"`);
    input.addEventListener('blur', () => {
      if (input.value.trim() === collection.name || !input.value.trim()) return;
      void renameCollection(collection.id, input.value).then(() => {
        void track('collection_renamed');
        void load();
      });
    });
    li.appendChild(input);

    const count = pins.filter(p => p.collectionId === collection.id).length;
    const countEl = document.createElement('span');
    countEl.className = 'count';
    countEl.textContent = `${count}`;
    li.appendChild(countEl);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'link-btn';
    deleteButton.textContent = 'Delete';
    deleteButton.disabled = collections.length <= 1;
    deleteButton.title =
      collections.length <= 1 ? 'At least one collection is required' : `Delete — pins move to ${collections[0]?.name}`;
    deleteButton.addEventListener('click', () => {
      if (!confirm(`Delete "${collection.name}"? Its pins move to another collection — nothing is removed.`)) return;
      void deleteCollection(collection.id).then(() => {
        void track('collection_deleted');
        void load().then(renderCollectionManager);
      });
    });
    li.appendChild(deleteButton);

    els.collectionManager.appendChild(li);
  }
}

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your research and clear a few pins.`
    : `Storage in use: ${mb} MB`;
  renderCollectionManager();
  els.data.showModal();
}

async function importData(file: File): Promise<void> {
  try {
    const raw = JSON.parse(await file.text());
    const result = await importBackup(raw);
    setStatus(`Imported ${result.pins} pin${result.pins === 1 ? '' : 's'}, ${result.collections} new collection${result.collections === 1 ? '' : 's'}`);
    void track('data_imported');
    await load();
    renderCollectionManager();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

/* ── Usage counters ─────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const rate = thumbnailCaptureRate(metrics);
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    rate === null ? 'Thumbnail capture: no data yet' : `Thumbnail capture rate: ${rate}%`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

function setView(next: 'collection' | 'domain'): void {
  view = next;
  els.viewCollection.classList.toggle('seg--on', next === 'collection');
  els.viewDomain.classList.toggle('seg--on', next === 'domain');
  els.viewCollection.setAttribute('aria-pressed', String(next === 'collection'));
  els.viewDomain.setAttribute('aria-pressed', String(next === 'domain'));
  void track(next === 'domain' ? 'view_domain' : 'view_collection');
  render();
}

els.dataToggle.addEventListener('click', () => void openData());
els.viewCollection.addEventListener('click', () => setView('collection'));
els.viewDomain.addEventListener('click', () => setView('domain'));

els.search.addEventListener('input', () => {
  window.clearTimeout(searchDebounce);
  searchDebounce = window.setTimeout(() => {
    query = els.search.value;
    if (query.trim()) void track('search_used');
    render();
  }, 120);
});

els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportMd.addEventListener('click', () => void exportMd());
els.exportJson.addEventListener('click', () => void exportJson());
els.statsToggle.addEventListener('click', () => void openStats());

els.dataClose.addEventListener('click', () => els.data.close());
els.dataExport.addEventListener('click', () => void exportJson());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});
els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every saved pin? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    void load();
  });
});

els.newCollectionAdd.addEventListener('click', () => {
  const name = els.newCollectionName.value.trim();
  if (!name) return;
  void addCollection(name).then(() => {
    els.newCollectionName.value = '';
    void track('collection_created');
    void load().then(renderCollectionManager);
  });
});
els.newCollectionName.addEventListener('keydown', event => {
  if (event.key === 'Enter') els.newCollectionAdd.click();
});

els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

// Picks up saves made by content.ts on any Pinterest tab, and edits made in
// another copy of this panel, without any message passing.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  const relevant = Object.keys(changes).some(key => key.startsWith('pcr:'));
  if (relevant) void load();
});

void (async () => {
  void track('panel_opened');
  await load();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your research from the menu.');
})();
