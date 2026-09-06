/**
 * The side panel: watched people, the posts collected from them, sort/filter,
 * notes, export and the data-ownership surface. Everything here reads
 * chrome.storage.local directly — there is no per-tab state to ask a content
 * script for, since collection is global, not per-page (PRD §4).
 */

import { buildFilename, daysSinceLastPost, toCsv, toMarkdown } from './export';
import { clearMetrics, readMetrics, track } from './metrics';
import { rateByAuthor } from './outliers';
import {
  clearAllData,
  exportBackup,
  importBackup,
  listPeople,
  listPosts,
  quotaStatus,
  readOptions,
  setPersonNote,
  setPostNote,
  unwatchPerson,
  writeOptions,
} from './storage';
import { CollectedPost, DEFAULT_EXPORT_OPTIONS, ExportOptions, RatedPost, SortMode, WatchedPerson } from './types';

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const els = {
  summary: $('summary'),
  refresh: $<HTMLButtonElement>('refresh'),
  people: $('people'),
  controls: $('controls'),
  sortRecency: $<HTMLButtonElement>('sort-recency'),
  sortOutlier: $<HTMLButtonElement>('sort-outlier'),
  optOutliersOnly: $<HTMLInputElement>('opt-outliers-only'),
  optNotes: $<HTMLInputElement>('opt-notes'),
  exportCsv: $<HTMLButtonElement>('export-csv'),
  exportMd: $<HTMLButtonElement>('export-md'),
  personDetail: $('person-detail'),
  personName: $('person-name'),
  personQuiet: $('person-quiet'),
  personHeadline: $('person-headline'),
  personNote: $<HTMLTextAreaElement>('person-note'),
  personUnwatch: $<HTMLButtonElement>('person-unwatch'),
  body: $('body'),
  state: $('state'),
  list: $<HTMLOListElement>('list'),
  status: $('status'),
  data: $<HTMLDialogElement>('data'),
  dataToggle: $<HTMLButtonElement>('data-toggle'),
  dataExport: $<HTMLButtonElement>('data-export'),
  dataImport: $<HTMLButtonElement>('data-import'),
  importFile: $<HTMLInputElement>('import-file'),
  dataClear: $<HTMLButtonElement>('data-clear'),
  dataClose: $<HTMLButtonElement>('data-close'),
  quota: $('quota'),
  stats: $<HTMLDialogElement>('stats'),
  statsToggle: $<HTMLButtonElement>('stats-toggle'),
  statsBody: $('stats-body'),
  statsClear: $<HTMLButtonElement>('stats-clear'),
  statsClose: $<HTMLButtonElement>('stats-close'),
};

let people: WatchedPerson[] = [];
let posts: CollectedPost[] = [];
let selectedPersonId: string | null = null;
let sortMode: SortMode = 'recency';
let options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };

function setStatus(message: string): void {
  els.status.textContent = message;
}

function showState(text: string, variant: '' | 'error' = ''): void {
  els.state.hidden = false;
  els.state.className = `state${variant ? ` state--${variant}` : ''}`;
  els.state.replaceChildren();
  const p = document.createElement('p');
  p.className = 'state__text';
  p.textContent = text;
  els.state.append(p);
  els.list.hidden = true;
}

/** The empty state shown when nothing can be shown yet — same shape across the portfolio. */
function showGate(title: string, body: string, actionLabel?: string, action?: () => void): void {
  els.list.hidden = true;
  els.state.hidden = false;
  els.state.className = 'state state--gate';
  els.state.replaceChildren();

  const icon = document.createElement('img');
  icon.className = 'gate__icon';
  icon.src = chrome.runtime.getURL('icons/icon-128.png');
  icon.alt = '';

  const heading = document.createElement('strong');
  heading.className = 'gate__title';
  heading.textContent = title;

  const text = document.createElement('p');
  text.className = 'gate__body';
  text.textContent = body;

  els.state.append(icon, heading, text);

  if (actionLabel && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn--primary gate__action';
    button.textContent = actionLabel;
    button.addEventListener('click', action);
    els.state.append(button);
  }
}

/* ── Loading + refresh ───────────────────────────────────────────────── */

async function refresh(): Promise<void> {
  try {
    [people, posts] = await Promise.all([listPeople(), listPosts()]);
  } catch {
    // Never surface the raw storage error — just say what the user can do.
    showState('Something went wrong loading your watchlist. Try reopening the panel.', 'error');
    els.people.hidden = true;
    els.controls.hidden = true;
    els.personDetail.hidden = true;
    return;
  }

  if (!people.length) {
    els.people.hidden = true;
    els.controls.hidden = true;
    els.personDetail.hidden = true;
    els.summary.textContent = '';
    showGate(
      'Watch someone to get started',
      'Open a profile or a post on LinkedIn and click "+ Watch" next to their name. Their posts will start showing up here as you browse.',
      'Open LinkedIn',
      () => void chrome.tabs.create({ url: 'https://www.linkedin.com/feed/' })
    );
    return;
  }

  if (selectedPersonId && !people.some(p => p.id === selectedPersonId)) selectedPersonId = null;

  els.controls.hidden = false;
  renderChips();
  renderPersonDetail();
  renderList();
}

/* ── Watched-people chips ───────────────────────────────────────────── */

function renderChips(): void {
  els.people.hidden = false;
  els.people.replaceChildren();

  const allChip = document.createElement('button');
  allChip.type = 'button';
  allChip.className = `chip chip--all${selectedPersonId === null ? ' chip--on' : ''}`;
  allChip.setAttribute('aria-pressed', String(selectedPersonId === null));
  allChip.textContent = `All people (${people.length})`;
  allChip.addEventListener('click', () => {
    selectedPersonId = null;
    renderChips();
    renderPersonDetail();
    renderList();
  });
  els.people.append(allChip);

  for (const person of people) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${selectedPersonId === person.id ? ' chip--on' : ''}`;
    chip.setAttribute('aria-pressed', String(selectedPersonId === person.id));

    const personPosts = posts.filter(post => post.personId === person.id);
    const quietDays = daysSinceLastPost(personPosts);
    if (quietDays !== null && quietDays >= 30) {
      const dot = document.createElement('span');
      dot.className = 'chip__quiet';
      dot.title = `No posts seen in ${quietDays} days`;
      chip.append(dot);
    }

    const name = document.createElement('span');
    name.className = 'chip__name';
    name.textContent = person.name;
    chip.append(name);

    chip.addEventListener('click', () => {
      selectedPersonId = selectedPersonId === person.id ? null : person.id;
      renderChips();
      renderPersonDetail();
      renderList();
    });
    els.people.append(chip);
  }
}

/* ── Selected-person detail ─────────────────────────────────────────── */

function renderPersonDetail(): void {
  const person = people.find(p => p.id === selectedPersonId) ?? null;
  els.personDetail.hidden = !person;
  if (!person) return;

  els.personName.textContent = person.name;
  els.personHeadline.textContent = person.headline;
  if (document.activeElement !== els.personNote) els.personNote.value = person.note;

  const personPosts = posts.filter(post => post.personId === person.id);
  const quietDays = daysSinceLastPost(personPosts);
  els.personQuiet.hidden = quietDays === null || quietDays < 30;
  if (quietDays !== null && quietDays >= 30) {
    els.personQuiet.textContent = `No posts seen in ${quietDays} days`;
  }
}

/* ── Post list ───────────────────────────────────────────────────────── */

function visiblePosts(): RatedPost[] {
  const scoped = selectedPersonId ? posts.filter(post => post.personId === selectedPersonId) : posts;
  const rated = rateByAuthor(scoped);
  const filtered = els.optOutliersOnly.checked ? rated.filter(post => post.ratio !== null && post.ratio >= 2) : rated;

  return [...filtered].sort((a, b) => {
    if (sortMode === 'outlier') {
      const ra = a.ratio ?? -1;
      const rb = b.ratio ?? -1;
      if (ra !== rb) return rb - ra;
    }
    return (b.postedAt ?? b.firstSeenAt) - (a.postedAt ?? a.firstSeenAt);
  });
}

function formatDate(post: RatedPost): string {
  if (post.postedAt) return new Date(post.postedAt).toLocaleDateString();
  return post.postedAtLabel || 'undated';
}

function renderList(): void {
  const rows = visiblePosts();
  const peopleById = new Map(people.map(p => [p.id, p]));

  els.summary.textContent = selectedPersonId
    ? `Collected from ${posts.filter(p => p.personId === selectedPersonId).length} post${posts.filter(p => p.personId === selectedPersonId).length === 1 ? '' : 's'} you've seen.`
    : `Watching ${people.length} ${people.length === 1 ? 'person' : 'people'} · collected from ${posts.length} post${posts.length === 1 ? '' : 's'} you've seen.`;

  els.list.replaceChildren();

  if (!rows.length) {
    els.list.hidden = true;
    els.state.hidden = false;
    els.state.className = 'state';
    els.state.replaceChildren();
    const p = document.createElement('p');
    p.className = 'state__text';
    p.textContent = els.optOutliersOnly.checked
      ? 'No posts clear the 2× outlier bar yet.'
      : 'No posts collected yet — browse the feed, a profile or search, and posts from people you watch will show up here.';
    els.state.append(p);
    setStatus('');
    return;
  }

  els.state.hidden = true;
  els.list.hidden = false;

  for (const post of rows) {
    const item = document.createElement('li');
    item.className = `item${post.seenAsRepost ? ' item--repost' : ''}`;

    const head = document.createElement('div');
    head.className = 'item__head';

    if (!selectedPersonId) {
      const author = document.createElement('span');
      author.className = 'item__author';
      author.textContent = peopleById.get(post.personId)?.name ?? 'Unknown';
      head.append(author);
    }

    if (post.ratio !== null && post.ratio >= 2) {
      const ratio = document.createElement('span');
      ratio.className = 'item__ratio';
      ratio.textContent = `${post.ratio.toFixed(1)}× outlier`;
      head.append(ratio);
    }

    const meta = document.createElement('span');
    meta.className = 'item__meta';
    meta.textContent = `${formatDate(post)}${post.seenAsRepost ? ' · via repost' : ''}`;
    head.append(meta);
    item.append(head);

    const quote = document.createElement('p');
    quote.className = `item__quote${post.text ? '' : ' item__quote--empty'}`;
    quote.textContent = post.text || '[No text on this post]';
    item.append(quote);

    const metrics = document.createElement('p');
    metrics.className = 'item__metrics';
    metrics.textContent = `${post.reactions} reactions · ${post.comments} comments · ${post.reposts} reposts`;
    item.append(metrics);

    if (post.note.trim()) {
      const note = document.createElement('p');
      note.className = 'item__note';
      note.textContent = post.note;
      item.append(note);
    }

    const editor = document.createElement('textarea');
    editor.className = 'item__note-edit';
    editor.rows = 2;
    editor.value = post.note;
    editor.placeholder = 'Note on this post…';
    editor.addEventListener('blur', () => {
      if (editor.value === post.note) return;
      void setPostNote(post.id, editor.value).then(() => {
        void track('post_note_saved');
        void refresh();
      });
    });

    const actions = document.createElement('div');
    actions.className = 'item__actions';

    if (post.url) {
      const link = document.createElement('a');
      link.href = post.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.className = 'link-btn';
      link.textContent = 'Open post';
      actions.append(link);
    }

    const noteButton = document.createElement('button');
    noteButton.type = 'button';
    noteButton.className = 'link-btn';
    noteButton.textContent = post.note.trim() ? 'Edit note' : 'Add note';
    noteButton.addEventListener('click', () => {
      editor.classList.toggle('item__note-edit--open');
      editor.focus();
    });
    actions.append(noteButton);

    item.append(actions, editor);
    els.list.append(item);
  }

  setStatus(`${rows.length} post${rows.length === 1 ? '' : 's'} shown`);
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
  const peopleById = new Map(people.map(p => [p.id, p]));
  const rated = rateByAuthor(posts);
  try {
    await download(
      new Blob([toCsv(peopleById, rated, options)], { type: 'text/csv;charset=utf-8' }),
      buildFilename('csv')
    );
    setStatus('Saved .csv');
    void track('export_csv');
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'Could not save the .csv file.'));
  }
}

async function exportMarkdown(): Promise<void> {
  const rated = rateByAuthor(posts);
  const byPerson = new Map<string, RatedPost[]>();
  for (const post of rated) {
    const list = byPerson.get(post.personId) ?? [];
    list.push(post);
    byPerson.set(post.personId, list);
  }
  try {
    await download(
      new Blob([toMarkdown(people, byPerson, options)], { type: 'text/markdown;charset=utf-8' }),
      buildFilename('md')
    );
    setStatus('Saved .md');
    void track('export_md');
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'Could not save the .md file.'));
  }
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/* ── Data ownership ──────────────────────────────────────────────────── */

async function openData(): Promise<void> {
  const quota = await quotaStatus();
  const mb = (quota.bytes / (1024 * 1024)).toFixed(2);
  els.quota.textContent = quota.warn
    ? `Storage ${mb} MB — over 80% full. Export your data and consider clearing some of it.`
    : `Storage in use: ${mb} MB`;
  els.data.showModal();
}

async function exportAllData(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const stamp = new Date().toISOString().slice(0, 10);
  try {
    await download(blob, `linkedin-watchlist-backup-${stamp}.json`);
    setStatus(`Exported ${backup.people.length} people, ${backup.posts.length} posts`);
    void track('data_exported');
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'Could not save the backup.'));
  }
}

async function importData(file: File): Promise<void> {
  try {
    const result = await importBackup(JSON.parse(await file.text()));
    setStatus(`Imported ${result.people} people, ${result.posts} posts`);
    void track('data_imported');
    await refresh();
  } catch (error: unknown) {
    setStatus(errorMessage(error, 'That file could not be read.'));
  }
}

/* ── Usage counters ──────────────────────────────────────────────────── */

async function openStats(): Promise<void> {
  const metrics = await readMetrics();
  const lines = [
    `Active days: ${metrics.activeDays.length}`,
    `People watched now: ${people.length}`,
    `Posts collected: ${posts.length}`,
    '',
    ...Object.entries(metrics.counts)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([key, value]) => `${key}: ${value}`),
  ];
  els.statsBody.textContent = lines.join('\n');
  els.stats.showModal();
}

/* ── Wiring ──────────────────────────────────────────────────────────── */

function setSort(next: SortMode): void {
  sortMode = next;
  els.sortRecency.classList.toggle('seg--on', next === 'recency');
  els.sortRecency.setAttribute('aria-pressed', String(next === 'recency'));
  els.sortOutlier.classList.toggle('seg--on', next === 'outlier');
  els.sortOutlier.setAttribute('aria-pressed', String(next === 'outlier'));
  void track('sort_changed');
  renderList();
}

els.refresh.addEventListener('click', () => void refresh());
els.sortRecency.addEventListener('click', () => setSort('recency'));
els.sortOutlier.addEventListener('click', () => setSort('outlier'));
els.optOutliersOnly.addEventListener('change', () => {
  void track('filter_changed');
  renderList();
});
els.optNotes.addEventListener('change', () => {
  options = { ...options, includeNotes: els.optNotes.checked };
  void writeOptions(options);
});
els.exportCsv.addEventListener('click', () => void exportCsv());
els.exportMd.addEventListener('click', () => void exportMarkdown());

els.personNote.addEventListener('blur', () => {
  if (!selectedPersonId) return;
  const person = people.find(p => p.id === selectedPersonId);
  if (!person || els.personNote.value === person.note) return;
  void setPersonNote(selectedPersonId, els.personNote.value).then(() => {
    void track('person_note_saved');
    void refresh();
  });
});

els.personUnwatch.addEventListener('click', () => {
  const person = people.find(p => p.id === selectedPersonId);
  if (!person) return;
  if (!confirm(`Stop watching ${person.name}? This also removes the posts collected from them.`)) return;
  void unwatchPerson(person.id).then(() => {
    void track('watch_removed');
    selectedPersonId = null;
    void refresh();
  });
});

els.dataToggle.addEventListener('click', () => void openData());
els.dataClose.addEventListener('click', () => els.data.close());
els.dataExport.addEventListener('click', () => void exportAllData());
els.dataImport.addEventListener('click', () => els.importFile.click());
els.importFile.addEventListener('change', () => {
  const file = els.importFile.files?.[0];
  els.importFile.value = '';
  if (file) void importData(file);
});

els.dataClear.addEventListener('click', () => {
  if (!confirm('Delete every watched person and every collected post? Export first if you want a copy.')) return;
  void clearAllData().then(() => {
    els.data.close();
    setStatus('All data cleared.');
    selectedPersonId = null;
    void refresh();
  });
});

els.statsToggle.addEventListener('click', () => void openStats());
els.statsClose.addEventListener('click', () => els.stats.close());
els.statsClear.addEventListener('click', () => {
  void clearMetrics().then(() => {
    els.statsBody.textContent = 'Counters reset.';
  });
});

// Content scripts write directly to storage as the user browses; the panel
// should pick that up without the user having to press refresh.
let liveRefreshTimer: number | undefined;
chrome.storage.onChanged.addListener(changes => {
  const relevant = Object.keys(changes).some(key => key.startsWith('lcw:person:') || key.startsWith('lcw:post:'));
  if (!relevant) return;
  window.clearTimeout(liveRefreshTimer);
  liveRefreshTimer = window.setTimeout(() => void refresh(), 300);
});

void (async () => {
  options = await readOptions(DEFAULT_EXPORT_OPTIONS);
  els.optNotes.checked = options.includeNotes;
  void track('panel_opened');
  await refresh();

  const quota = await quotaStatus();
  if (quota.warn) setStatus('Local storage is over 80% full — export your data from "Data".');
})();
