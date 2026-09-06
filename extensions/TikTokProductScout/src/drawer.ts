/**
 * The product board (PRD §4 "Product board (side panel)"). Rendered as a
 * slide-in drawer inside the page's own shadow root rather than a
 * chrome.sidePanel page — that keeps the manifest's permission list at
 * exactly what PRD §6 asks for (`activeTab`, `storage`, `downloads` +
 * the TikTok host permission; no `sidePanel`, no `tabs`).
 *
 * The drawer owns no state of its own: every open/refresh re-reads storage,
 * the same "single source of truth, ask when something changes" shape
 * WebHighlighter's panel.ts uses for its side panel.
 */

import { countBoardsAtThreeCreators, rankProducts } from './aggregate';
import { groupKeyFor } from './markers';
import { computeOutlier, formatRatio } from './outlier';
import {
  addVideoToProduct,
  clearAllData,
  deleteProduct,
  exportBackup,
  findProductByGroupKey,
  importBackup,
  mutateProduct,
  quotaStatus,
  readAllBaselines,
  readAllProducts,
  readCoverage,
  readOptions,
  readProduct,
  writeOptions,
} from './storage';
import { buildFilename, toCsv, toMarkdownSummary } from './export';
import { track } from './metrics';
import { ui } from './shell';
import { BoardFilters, CreatorBaseline, DEFAULT_FILTERS, Product, ProductGroupType, ProductStats, ScannedVideo, TrackedVideo } from './types';

const DRAWER_CSS = `
  .tab {
    position: fixed; top: 50%; right: 0; transform: translateY(-50%);
    z-index: 2147483600; pointer-events: auto;
    background: #ff2c55; color: #fff; border: none; border-radius: 10px 0 0 10px;
    padding: 10px 6px; font: 600 12px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer; writing-mode: vertical-rl; letter-spacing: .02em;
  }
  .tab:hover { background: #e0264b; }
  .wrap {
    position: fixed; top: 0; right: 0; height: 100vh; width: min(380px, 92vw);
    background: #fff; color: #111; box-shadow: -8px 0 24px rgba(0,0,0,.25);
    display: flex; flex-direction: column; transform: translateX(100%);
    transition: transform .18s ease; z-index: 2147483610; pointer-events: auto;
    font: 13px/1.45 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .wrap--open { transform: translateX(0); }
  @media (prefers-reduced-motion: reduce) { .wrap { transition: none; } }
  @media (prefers-color-scheme: dark) { .wrap { background: #1c1c1e; color: #f0f0f0; } }

  .hd { padding: 12px 14px; border-bottom: 1px solid rgba(127,127,127,.25); }
  .hd h2 { margin: 0 0 2px; font-size: 15px; }
  .hd p { margin: 0; font-size: 12px; opacity: .7; }
  .close { position: absolute; top: 10px; right: 10px; border: none; background: none; font-size: 16px; cursor: pointer; color: inherit; }

  .filters { padding: 10px 14px; border-bottom: 1px solid rgba(127,127,127,.25); display: flex; flex-wrap: wrap; gap: 6px; }
  .filters label { display: flex; align-items: center; gap: 4px; font-size: 11px; opacity: .85; }
  .filters input[type="number"] { width: 56px; }
  .filters select, .filters input { font: inherit; border: 1px solid rgba(127,127,127,.35); border-radius: 6px; padding: 3px 5px; background: transparent; color: inherit; }

  .list { flex: 1; overflow-y: auto; padding: 8px 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .empty { padding: 32px 16px; text-align: center; opacity: .65; }

  .card { border: 1px solid rgba(127,127,127,.3); border-radius: 10px; padding: 10px; }
  .card__top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .card__name { font-weight: 600; font-size: 13px; overflow-wrap: anywhere; }
  .card__creators { font-size: 22px; font-weight: 700; color: #ff2c55; line-height: 1; }
  .card__creators-label { font-size: 10px; opacity: .7; display: block; text-align: right; }
  .card__stats { margin-top: 6px; font-size: 11.5px; opacity: .85; display: flex; flex-wrap: wrap; gap: 8px; }
  .card__pending { margin-top: 4px; font-size: 11px; color: #b8860b; }
  .card__actions { margin-top: 8px; display: flex; gap: 10px; }
  .link-btn { border: none; background: none; color: inherit; opacity: .75; text-decoration: underline; cursor: pointer; font: inherit; padding: 0; }
  .card__videos { margin-top: 8px; padding-top: 8px; border-top: 1px dashed rgba(127,127,127,.3); display: none; flex-direction: column; gap: 4px; }
  .card__videos--open { display: flex; }
  .card__video { display: flex; justify-content: space-between; gap: 8px; font-size: 11.5px; }
  .card__video a { color: inherit; }

  .ft { padding: 8px 12px; border-top: 1px solid rgba(127,127,127,.25); display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: space-between; }
  .ft__row { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn { border: 1px solid rgba(127,127,127,.35); background: transparent; color: inherit; border-radius: 8px; padding: 5px 9px; font: inherit; cursor: pointer; }
  .btn--danger { color: #d33; border-color: rgba(221,51,51,.4); }
  .status { font-size: 11px; opacity: .7; padding: 0 12px 8px; min-height: 14px; }

  .modal-scrim { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483620; display: none; }
  .modal-scrim--on { display: block; }
  .modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%,-50%); width: min(320px, 88vw);
    background: #fff; color: #111; border-radius: 12px; padding: 16px; z-index: 2147483630; display: none; }
  .modal--on { display: block; }
  @media (prefers-color-scheme: dark) { .modal { background: #1c1c1e; color: #f0f0f0; } }
  .modal h3 { margin: 0 0 8px; font-size: 14px; }
  .modal select, .modal input { width: 100%; box-sizing: border-box; font: inherit; border: 1px solid rgba(127,127,127,.35); border-radius: 6px; padding: 6px 8px; background: transparent; color: inherit; margin-bottom: 8px; }
  .modal__row { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
`;

let built = false;
let els: {
  tab: HTMLButtonElement;
  wrap: HTMLDivElement;
  status: HTMLSpanElement;
  coverage: HTMLParagraphElement;
  list: HTMLDivElement;
  minRatio: HTMLInputElement;
  onlyCommercial: HTMLInputElement;
  withinDays: HTMLSelectElement;
  minViews: HTMLInputElement;
  importFile: HTMLInputElement;
  scrim: HTMLDivElement;
  modal: HTMLDivElement;
  modalBody: HTMLDivElement;
};

let filters: BoardFilters = { ...DEFAULT_FILTERS };
let pendingTrackVideo: ScannedVideo | null = null;
let onTrackedCallback: ((videoId: string) => void) | null = null;

function setStatus(message: string): void {
  els.status.textContent = message;
}

function closeModal(): void {
  els.scrim.classList.remove('modal-scrim--on');
  els.modal.classList.remove('modal--on');
  pendingTrackVideo = null;
}

function build(): void {
  if (built) return;
  built = true;

  const root = ui();
  const style = document.createElement('style');
  style.textContent = DRAWER_CSS;
  root.appendChild(style);

  const tab = document.createElement('button');
  tab.type = 'button';
  tab.className = 'tab';
  tab.textContent = 'Product Scout';
  tab.setAttribute('aria-label', 'Open product board');
  tab.addEventListener('click', () => toggle());
  root.appendChild(tab);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-label', 'TikTok Product Scout board');
  root.appendChild(wrap);

  const hd = document.createElement('div');
  hd.className = 'hd';
  hd.style.position = 'relative';
  hd.innerHTML = '<h2>Product board</h2>';
  const coverage = document.createElement('p');
  hd.appendChild(coverage);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'close';
  close.textContent = '✕';
  close.setAttribute('aria-label', 'Close product board');
  close.addEventListener('click', () => close_());
  hd.appendChild(close);
  wrap.appendChild(hd);

  const filterRow = document.createElement('div');
  filterRow.className = 'filters';

  const minRatioLabel = document.createElement('label');
  minRatioLabel.textContent = 'Min ratio';
  const minRatio = document.createElement('input');
  minRatio.type = 'number';
  minRatio.min = '0';
  minRatio.step = '0.5';
  minRatio.placeholder = 'any';
  minRatioLabel.appendChild(minRatio);
  filterRow.appendChild(minRatioLabel);

  const onlyLabel = document.createElement('label');
  const onlyCommercial = document.createElement('input');
  onlyCommercial.type = 'checkbox';
  onlyLabel.appendChild(onlyCommercial);
  onlyLabel.append('Commercial only');
  filterRow.appendChild(onlyLabel);

  const daysLabel = document.createElement('label');
  daysLabel.textContent = 'Window';
  const withinDays = document.createElement('select');
  for (const [value, label] of [['', 'All time'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days']] as const) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = label;
    withinDays.appendChild(opt);
  }
  daysLabel.appendChild(withinDays);
  filterRow.appendChild(daysLabel);

  const viewsLabel = document.createElement('label');
  viewsLabel.textContent = 'Min views';
  const minViews = document.createElement('input');
  minViews.type = 'number';
  minViews.min = '0';
  minViews.placeholder = 'any';
  viewsLabel.appendChild(minViews);
  filterRow.appendChild(viewsLabel);

  wrap.appendChild(filterRow);

  const list = document.createElement('div');
  list.className = 'list';
  wrap.appendChild(list);

  const status = document.createElement('span');
  status.className = 'status';
  const statusHolder = document.createElement('div');
  statusHolder.className = 'status';
  statusHolder.appendChild(status);
  wrap.appendChild(statusHolder);

  const ft = document.createElement('div');
  ft.className = 'ft';
  const rowA = document.createElement('div');
  rowA.className = 'ft__row';
  const csvBtn = button('Export CSV', () => void doExportCsv());
  const mdBtn = button('Export MD', () => void doExportMarkdown());
  rowA.append(csvBtn, mdBtn);
  const rowB = document.createElement('div');
  rowB.className = 'ft__row';
  const backupBtn = button('Backup', () => void doExportBackup());
  const importBtn = button('Import', () => importFile.click());
  const clearBtn = button('Clear all', () => void doClearAll(), true);
  rowB.append(backupBtn, importBtn, clearBtn);
  ft.append(rowA, rowB);
  wrap.appendChild(ft);

  const importFile = document.createElement('input');
  importFile.type = 'file';
  importFile.accept = 'application/json,.json';
  importFile.hidden = true;
  importFile.addEventListener('change', () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (file) void doImport(file);
  });
  root.appendChild(importFile);

  // Track-product modal
  const scrim = document.createElement('div');
  scrim.className = 'modal-scrim';
  scrim.addEventListener('click', closeModal);
  root.appendChild(scrim);

  const modal = document.createElement('div');
  modal.className = 'modal';
  const modalBody = document.createElement('div');
  modal.appendChild(modalBody);
  root.appendChild(modal);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (els.modal.classList.contains('modal--on')) closeModal();
    else if (els.wrap.classList.contains('wrap--open')) close_();
  });

  els = { tab, wrap, status, coverage, list, minRatio, onlyCommercial, withinDays, minViews, importFile, scrim, modal, modalBody };

  const onFilterChange = (next: BoardFilters): void => {
    filters = next;
    void writeOptions(filters);
    void track('filter_applied');
    void refresh();
  };

  minRatio.addEventListener('change', () => {
    onFilterChange({ ...filters, minRatio: minRatio.value ? Number(minRatio.value) : null });
  });
  onlyCommercial.addEventListener('change', () => {
    onFilterChange({ ...filters, onlyCommercial: onlyCommercial.checked });
  });
  withinDays.addEventListener('change', () => {
    const value = withinDays.value ? (Number(withinDays.value) as 7 | 30 | 90) : null;
    onFilterChange({ ...filters, withinDays: value });
  });
  minViews.addEventListener('change', () => {
    onFilterChange({ ...filters, minViews: minViews.value ? Number(minViews.value) : null });
  });

  applyFiltersToInputs();
}

function applyFiltersToInputs(): void {
  els.minRatio.value = filters.minRatio === null ? '' : String(filters.minRatio);
  els.onlyCommercial.checked = filters.onlyCommercial;
  els.withinDays.value = filters.withinDays === null ? '' : String(filters.withinDays);
  els.minViews.value = filters.minViews === null ? '' : String(filters.minViews);
}

function button(label: string, onClick: () => void, danger = false): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = danger ? 'btn btn--danger' : 'btn';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function close_(): void {
  els.wrap.classList.remove('wrap--open');
}

export function isOpen(): boolean {
  return built && els.wrap.classList.contains('wrap--open');
}

let filtersLoaded: Promise<void> | null = null;

function ensureFiltersLoaded(): Promise<void> {
  if (!filtersLoaded) {
    filtersLoaded = readOptions(DEFAULT_FILTERS).then(stored => {
      filters = stored;
      applyFiltersToInputs();
    });
  }
  return filtersLoaded;
}

export function open(): void {
  build();
  els.wrap.classList.add('wrap--open');
  void track('board_opened');
  void ensureFiltersLoaded().then(refresh);
}

export function toggle(): void {
  build();
  if (isOpen()) close_();
  else open();
}

function newProductId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function toTrackedVideo(video: ScannedVideo): TrackedVideo {
  return {
    id: video.id,
    url: video.url,
    creatorHandle: video.creatorHandle,
    views: video.views,
    likes: video.likes,
    comments: video.comments,
    publishedAt: video.publishedAt,
    markers: video.markers,
    addedAt: Date.now(),
  };
}

/** Opens the "+ Track product" modal for a video the badge offered to track. */
export function promptTrack(video: ScannedVideo, onTracked: (videoId: string) => void): void {
  build();
  pendingTrackVideo = video;
  onTrackedCallback = onTracked;
  void renderTrackModal(video);
}

async function renderTrackModal(video: ScannedVideo): Promise<void> {
  const products = await readAllProducts();
  els.modalBody.replaceChildren();

  const heading = document.createElement('h3');
  heading.textContent = 'Track this product';
  els.modalBody.appendChild(heading);

  if (products.length) {
    const select = document.createElement('select');
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Add to existing product…';
    select.appendChild(blank);
    for (const product of products) {
      const opt = document.createElement('option');
      opt.value = product.id;
      opt.textContent = `${product.name} (${product.videos.length})`;
      select.appendChild(opt);
    }
    els.modalBody.appendChild(select);

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn';
    addBtn.textContent = 'Add to selected';
    addBtn.addEventListener('click', () => {
      if (select.value) void trackInto(select.value, video);
    });
    els.modalBody.appendChild(addBtn);
  }

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Name this product (e.g. "collapsible water bottle")';
  els.modalBody.appendChild(nameInput);

  const row = document.createElement('div');
  row.className = 'modal__row';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', closeModal);
  const create = document.createElement('button');
  create.type = 'button';
  create.className = 'btn';
  create.textContent = 'Create new';
  create.addEventListener('click', () => {
    const name = nameInput.value.trim() || guessName(video);
    void trackNew(name, video);
  });
  row.append(cancel, create);
  els.modalBody.appendChild(row);

  els.scrim.classList.add('modal-scrim--on');
  els.modal.classList.add('modal--on');
  nameInput.focus();
}

function guessName(video: ScannedVideo): string {
  const shop = video.markers.find(m => m.confidence === 'verified');
  if (shop) return `Shop item via ${video.creatorHandle}`;
  const heuristic = video.markers[0];
  return heuristic ? `${heuristic.label} — ${video.creatorHandle}` : `Untitled product (${video.creatorHandle})`;
}

async function trackNew(name: string, video: ScannedVideo): Promise<void> {
  const groupKey = groupKeyFor(video.markers);
  const groupType: ProductGroupType = groupKey?.startsWith('shop:') ? 'shop' : groupKey?.startsWith('caption:') ? 'caption' : 'manual';

  const existing = groupType !== 'manual' && groupKey ? await findProductByGroupKey(groupKey) : null;
  const id = existing?.id ?? newProductId();

  const seed: Product = existing ?? {
    id,
    name,
    groupType,
    groupKey: groupKey ?? id,
    videos: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const added = await mutateProduct(id, seed, product => addVideoToProduct(toTrackedVideo(video), product));
  void track('product_tracked');
  if (added) void track('video_tracked');
  onTrackedCallback?.(video.id);
  closeModal();
  setStatus(existing ? `Added to "${existing.name}"` : `Tracking "${name}"`);
  void refresh();
}

async function trackInto(productId: string, video: ScannedVideo): Promise<void> {
  const product = await readProduct(productId);
  if (!product) return;
  const added = await mutateProduct(productId, product, p => addVideoToProduct(toTrackedVideo(video), p));
  if (added) void track('video_tracked');
  onTrackedCallback?.(video.id);
  closeModal();
  setStatus(`Added to "${product.name}"`);
  void refresh();
}

function isVideoTracked(videoId: string, products: Product[]): boolean {
  return products.some(p => p.videos.some(v => v.id === videoId));
}

export async function isTracked(videoId: string): Promise<boolean> {
  const products = await readAllProducts();
  return isVideoTracked(videoId, products);
}

function renderCard(stats: ProductStats, baselines: Map<string, CreatorBaseline>): HTMLDivElement {
  const card = document.createElement('div');
  card.className = 'card';

  const top = document.createElement('div');
  top.className = 'card__top';
  const name = document.createElement('div');
  name.className = 'card__name';
  name.textContent = stats.product.name;
  const creators = document.createElement('div');
  const creatorsNum = document.createElement('div');
  creatorsNum.className = 'card__creators';
  creatorsNum.textContent = String(stats.distinctCreators);
  const creatorsLabel = document.createElement('span');
  creatorsLabel.className = 'card__creators-label';
  creatorsLabel.textContent = stats.distinctCreators === 1 ? 'creator' : 'creators';
  creators.append(creatorsNum, creatorsLabel);
  top.append(name, creators);
  card.appendChild(top);

  const statsRow = document.createElement('div');
  statsRow.className = 'card__stats';
  const videoCount = document.createElement('span');
  videoCount.textContent = `${stats.visibleVideos.length} video${stats.visibleVideos.length === 1 ? '' : 's'}`;
  const ratio = document.createElement('span');
  ratio.textContent = `median ${stats.medianRatio === null ? 'pending' : `${stats.medianRatio.toFixed(1)}×`}`;
  const dates = document.createElement('span');
  const fmt = (ms: number | null) => (ms === null ? '—' : new Date(ms).toLocaleDateString());
  dates.textContent = `${fmt(stats.firstSeen)} → ${fmt(stats.lastSeen)}`;
  statsRow.append(videoCount, ratio, dates);
  card.appendChild(statsRow);

  if (stats.pendingBaselines) {
    const pending = document.createElement('div');
    pending.className = 'card__pending';
    pending.textContent = `${stats.pendingBaselines} video(s) waiting on a creator baseline — visit their profile to resolve.`;
    card.appendChild(pending);
  }

  const actions = document.createElement('div');
  actions.className = 'card__actions';
  const toggleVideos = document.createElement('button');
  toggleVideos.type = 'button';
  toggleVideos.className = 'link-btn';
  toggleVideos.textContent = `Show ${stats.visibleVideos.length} video${stats.visibleVideos.length === 1 ? '' : 's'}`;
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'link-btn';
  remove.textContent = 'Remove product';
  remove.addEventListener('click', () => void removeProduct(stats.product.id, stats.product.name));
  actions.append(toggleVideos, remove);
  card.appendChild(actions);

  const videoList = document.createElement('div');
  videoList.className = 'card__videos';
  for (const video of stats.visibleVideos) {
    const row = document.createElement('div');
    row.className = 'card__video';
    const link = document.createElement('a');
    link.href = video.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = video.creatorHandle;
    const meta = document.createElement('span');
    const outlier = computeOutlier(video.views, baselines.get(video.creatorHandle) ?? null);
    meta.textContent = `${video.views === null ? 'views n/a' : video.views.toLocaleString('en-US')} · ${formatRatio(outlier)}`;
    row.append(link, meta);
    videoList.appendChild(row);
  }
  toggleVideos.addEventListener('click', () => videoList.classList.toggle('card__videos--open'));
  card.appendChild(videoList);

  return card;
}

async function removeProduct(id: string, name: string): Promise<void> {
  await deleteProduct(id);
  void track('product_removed');
  setStatus(`Removed "${name}"`);
  void refresh();
}

export async function refresh(): Promise<void> {
  if (!built) return;
  const [products, baselines, coverage, quota] = await Promise.all([
    readAllProducts(),
    readAllBaselines(),
    readCoverage(),
    quotaStatus(),
  ]);

  const boardsAtThree = countBoardsAtThreeCreators(products);
  els.coverage.textContent =
    `From ${coverage.videosViewedTotal.toLocaleString('en-US')} video${coverage.videosViewedTotal === 1 ? '' : 's'} you've viewed` +
    (products.length ? ` · ${boardsAtThree}/${products.length} boards at 3+ creators` : '');

  const ranked = rankProducts(products, filters, baselines);
  els.list.replaceChildren();

  if (!ranked.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = products.length
      ? 'No tracked products match these filters.'
      : 'Nothing tracked yet. Browse TikTok and use "+ Track" on a badge with a shop or commercial marker.';
    els.list.appendChild(empty);
  } else {
    for (const stats of ranked) els.list.appendChild(renderCard(stats, baselines));
  }

  if (quota.warn) setStatus('Local storage is over 80% full — export a backup and remove some products.');
}

async function computeCurrentRows(): Promise<ProductStats[]> {
  const [products, baselines] = await Promise.all([readAllProducts(), readAllBaselines()]);
  return rankProducts(products, filters, baselines);
}

async function download(blob: Blob, filename: string): Promise<void> {
  const url = URL.createObjectURL(blob);
  try {
    await chrome.downloads.download({ url, filename, saveAs: false });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

async function doExportCsv(): Promise<void> {
  const rows = await computeCurrentRows();
  if (!rows.length) {
    setStatus('Nothing to export with the current filters.');
    return;
  }
  try {
    await download(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), buildFilename('csv'));
    void track('export_csv');
    setStatus('Saved .csv');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .csv file.');
  }
}

async function doExportMarkdown(): Promise<void> {
  const rows = await computeCurrentRows();
  if (!rows.length) {
    setStatus('Nothing to export with the current filters.');
    return;
  }
  try {
    await download(new Blob([toMarkdownSummary(rows)], { type: 'text/markdown;charset=utf-8' }), buildFilename('md'));
    void track('export_md');
    setStatus('Saved .md');
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the .md file.');
  }
}

async function doExportBackup(): Promise<void> {
  const backup = await exportBackup();
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(
      new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' }),
      `tiktok-product-scout-backup-${stamp}.json`
    );
    void track('data_exported');
    setStatus(`Exported ${backup.products.length} product(s)`);
  } catch (error: any) {
    setStatus(error?.message || 'Could not save the backup.');
  }
}

async function doImport(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    void track('data_imported');
    setStatus(`Imported ${result.videos} video(s) across ${result.products} product(s)`);
    void refresh();
  } catch (error: any) {
    setStatus(error?.message || 'That file could not be read.');
  }
}

async function doClearAll(): Promise<void> {
  if (!confirm('Delete every tracked product and creator baseline? Export a backup first if you want a copy.')) return;
  await clearAllData();
  setStatus('All data cleared.');
  void refresh();
}
