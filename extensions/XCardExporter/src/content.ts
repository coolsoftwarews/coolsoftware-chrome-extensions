/**
 * Runs on x.com/twitter.com. Jobs:
 *   1. float a small "Save as image" (and, when the post has a visible
 *      thread beneath it, "Save thread") badge near every rendered post's
 *      action row (PRD S4)
 *   2. on click, extract the post(s) from the live DOM, open the export
 *      panel with a live preview and template picker
 *   3. render + relay the download to the background worker (chrome.
 *      downloads isn't available in content scripts - see the portfolio
 *      build memory)
 *
 * Never inserted into X's own React-owned DOM subtree (badges float over
 * the page via one shadow host per tweet, same shape as XConversationSaver
 * in this portfolio) because X recycles list-cell nodes as the user
 * scrolls and would otherwise wipe anything appended inside them.
 */

import { CardInput, DownloadMessage, DownloadResponse, ScrapedPost, TemplateId } from './types';
import { collectThread, extractPost, findActionRow, findTweetArticles, TWEET_SELECTOR } from './scrape';
import { formatDateLabel } from './text';
import { CARD_WIDTH, TEMPLATES, TEMPLATE_ORDER } from './templates';
import { renderCard } from './render';
import { buildCardFilename, buildThreadFilename } from './filenames';
import { readPreferences, recordUsage, writeLastTemplate } from './storage';
import { CSS } from './styles';

interface Badge {
  host: HTMLElement;
  saveBtn: HTMLButtonElement;
  threadBtn: HTMLButtonElement;
}

const badges = new Map<HTMLElement, Badge>();
let rafPending = false;

function scheduleReposition(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    repositionAll();
  });
}

function createBadge(article: HTMLElement): Badge {
  const host = document.createElement('div');
  host.setAttribute('data-xce-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'xce-badge';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'xce-badge-btn';
  saveBtn.title = 'Save as image';
  saveBtn.setAttribute('aria-label', 'Save this post as an image');
  saveBtn.textContent = '\u{1F5BC}️'; // framed-picture glyph
  saveBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleSaveSingle(article, saveBtn);
  });

  const threadBtn = document.createElement('button');
  threadBtn.type = 'button';
  threadBtn.className = 'xce-badge-btn';
  threadBtn.title = 'Save thread as images';
  threadBtn.setAttribute('aria-label', 'Save this thread as a series of images');
  threadBtn.textContent = '\u{1F4DA}'; // stacked-books glyph, stands in for "multiple cards"
  threadBtn.disabled = true;
  threadBtn.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleSaveThread(article, threadBtn);
  });

  wrap.appendChild(saveBtn);
  wrap.appendChild(threadBtn);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  return { host, saveBtn, threadBtn };
}

function positionBadge(article: HTMLElement, badge: Badge): void {
  const rect = article.getBoundingClientRect();
  const actionRow = findActionRow(article);
  const anchor = (actionRow ?? article).getBoundingClientRect();

  const visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
  const shadow = badge.host.shadowRoot;
  const wrap = shadow?.querySelector<HTMLElement>('.xce-badge');
  if (!wrap) return;

  if (!visible) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  wrap.style.top = `${Math.max(4, anchor.top - 4)}px`;
  wrap.style.left = `${Math.min(window.innerWidth - 70, anchor.right + 6)}px`;
}

function repositionAll(): void {
  badges.forEach((badge, article) => {
    if (!article.isConnected) {
      badge.host.remove();
      badges.delete(article);
      return;
    }
    positionBadge(article, badge);
  });
}

function threadHasMorePosts(article: HTMLElement, allArticles: HTMLElement[]): boolean {
  return collectThread(article, 25, allArticles).articles.length > 1;
}

function syncBadges(): void {
  const articles = findTweetArticles(document);
  const seen = new Set<HTMLElement>();

  for (const article of articles) {
    seen.add(article);
    if (badges.has(article)) continue;
    const badge = createBadge(article);
    badges.set(article, badge);
  }

  // Prune badges whose article left the DOM (X recycled the node).
  badges.forEach((badge, article) => {
    if (!seen.has(article) || !article.isConnected) {
      badge.host.remove();
      badges.delete(article);
    }
  });

  // One shared articles array for every badge's thread check, instead of
  // each badge re-querying the whole document (see collectThread's own
  // comment on the O(n^2) risk this avoids).
  badges.forEach((badge, article) => {
    badge.threadBtn.disabled = !threadHasMorePosts(article, articles);
  });

  scheduleReposition();
}

/* ── Extraction -> CardInput ─────────────────────────────────────────── */

function toCardInput(post: ScrapedPost): CardInput {
  return {
    author: post.author,
    handle: post.handle,
    text: post.text,
    dateLabel: formatDateLabel(post.postDate),
    metrics: post.metrics,
  };
}

/* ── Export panel ────────────────────────────────────────────────────── */

interface PanelController {
  close: () => void;
}

function openPanel(posts: ScrapedPost[], kind: 'single' | 'thread', invoker: HTMLElement): PanelController {
  const host = document.createElement('div');
  host.setAttribute('data-xce-ui', '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const overlay = document.createElement('div');
  overlay.className = 'xce-overlay';

  const panel = document.createElement('div');
  panel.className = 'xce-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', kind === 'thread' ? 'Export thread as images' : 'Export post as image');

  const heading = document.createElement('h2');
  heading.textContent = kind === 'thread' ? `Export ${posts.length} posts as images` : 'Export post as image';
  const sub = document.createElement('p');
  sub.className = 'xce-sub';
  sub.textContent = 'Rendered on this device. Nothing is uploaded.';

  const previewWrap = document.createElement('div');
  previewWrap.className = 'xce-preview';
  const previewImg = document.createElement('img');
  previewImg.alt = 'Preview of the exported card';
  previewImg.width = CARD_WIDTH / 2;
  previewWrap.appendChild(previewImg);

  const templateRow = document.createElement('div');
  templateRow.className = 'xce-templates';
  templateRow.setAttribute('role', 'group');
  templateRow.setAttribute('aria-label', 'Card style');

  const status = document.createElement('div');
  status.className = 'xce-status';
  status.setAttribute('role', 'status');

  const actions = document.createElement('div');
  actions.className = 'xce-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'xce-btn';
  cancelBtn.textContent = 'Cancel';
  const downloadBtn = document.createElement('button');
  downloadBtn.type = 'button';
  downloadBtn.className = 'xce-btn xce-btn-primary';
  downloadBtn.textContent = kind === 'thread' ? `Download ${posts.length} PNGs` : 'Download PNG';
  actions.appendChild(cancelBtn);
  actions.appendChild(downloadBtn);

  panel.appendChild(heading);
  panel.appendChild(sub);
  panel.appendChild(previewWrap);
  panel.appendChild(templateRow);
  panel.appendChild(status);
  panel.appendChild(actions);
  overlay.appendChild(panel);
  shadow.appendChild(overlay);
  document.documentElement.appendChild(host);

  let selectedTemplate: TemplateId = 'light';
  let lastRenderDataUrl: string | null = null;
  let lastRenderFallbackAvatar = false;
  let closed = false;

  function setStatus(message: string, isError = false): void {
    status.textContent = message;
    status.classList.toggle('xce-status-error', isError);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKeydown, true);
    host.remove();
    invoker.focus();
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>('button')).filter(el => !el.hasAttribute('disabled'));
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function renderPreview(): Promise<void> {
    setStatus('Rendering preview…');
    try {
      const config = TEMPLATES[selectedTemplate];
      const first = posts[0];
      const result = await renderCard(toCardInput(first), config, first.avatarUrl);
      lastRenderDataUrl = result.dataUrl;
      lastRenderFallbackAvatar = result.usedFallbackAvatar;
      previewImg.src = result.dataUrl;
      setStatus(result.usedFallbackAvatar ? 'Preview ready (avatar unavailable — used initials).' : 'Preview ready.');
    } catch {
      setStatus("Couldn't render a preview. Try again, or pick a different template.", true);
    }
  }

  TEMPLATE_ORDER.forEach(id => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xce-template-btn';
    btn.textContent = TEMPLATES[id].label;
    btn.setAttribute('aria-pressed', String(id === selectedTemplate));
    btn.addEventListener('click', () => {
      selectedTemplate = id;
      templateRow.querySelectorAll('.xce-template-btn').forEach(el => el.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      void renderPreview();
    });
    templateRow.appendChild(btn);
  });

  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeydown, true);

  downloadBtn.addEventListener('click', () => {
    void runExport();
  });

  async function runExport(): Promise<void> {
    downloadBtn.setAttribute('disabled', 'true');
    try {
      if (kind === 'single') {
        if (!lastRenderDataUrl) await renderPreview();
        if (!lastRenderDataUrl) throw new Error('no render');
        const first = posts[0];
        const filename = buildCardFilename(first.handle, first.text);
        await sendDownload(lastRenderDataUrl, filename);
        if (lastRenderFallbackAvatar) await recordUsage('avatar_fallback');
        await recordUsage('export_single', selectedTemplate);
        await writeLastTemplate(selectedTemplate);
        setStatus('Downloaded.');
      } else {
        setStatus(`Rendering and downloading ${posts.length} images…`);
        const config = TEMPLATES[selectedTemplate];
        for (let i = 0; i < posts.length; i++) {
          const post = posts[i];
          const result = await renderCard(toCardInput(post), config, post.avatarUrl);
          if (result.usedFallbackAvatar) await recordUsage('avatar_fallback');
          const filename = buildThreadFilename(posts[0].handle, i + 1, posts.length);
          await sendDownload(result.dataUrl, filename);
          setStatus(`Downloaded ${i + 1} of ${posts.length}…`);
        }
        await recordUsage('export_thread', selectedTemplate);
        await writeLastTemplate(selectedTemplate);
        setStatus(`Downloaded ${posts.length} images.`);
      }
      setTimeout(close, 900);
    } catch {
      await recordUsage('export_failed');
      setStatus("Something went wrong exporting this — the post may have changed on the page. Try again.", true);
    } finally {
      downloadBtn.removeAttribute('disabled');
    }
  }

  void readPreferences().then(prefs => {
    selectedTemplate = prefs.lastTemplate;
    templateRow.querySelectorAll('.xce-template-btn').forEach((el, i) => {
      el.setAttribute('aria-pressed', String(TEMPLATE_ORDER[i] === selectedTemplate));
    });
    void renderPreview();
  });

  cancelBtn.focus();

  return { close };
}

/* ── Download relay (chrome.downloads is not available in content scripts) ── */

function sendDownload(dataUrl: string, filename: string): Promise<void> {
  const message: DownloadMessage = { type: 'XCE_DOWNLOAD', dataUrl, filename };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response: DownloadResponse | undefined) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error ?? 'download failed'));
        return;
      }
      resolve();
    });
  });
}

/* ── Button handlers ─────────────────────────────────────────────────── */

async function handleSaveSingle(article: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const post = extractPost(article);
  if (!post) {
    flashDisabled(button, "Can't read this post yet");
    return;
  }
  openPanel([post], 'single', button);
}

async function handleSaveThread(article: HTMLElement, button: HTMLButtonElement): Promise<void> {
  const { articles } = collectThread(article);
  const posts = articles.map(a => extractPost(a)).filter((p): p is ScrapedPost => p !== null);
  if (posts.length < 2) {
    flashDisabled(button, "Can't read this thread yet");
    return;
  }
  openPanel(posts, 'thread', button);
}

function flashDisabled(button: HTMLButtonElement, title: string): void {
  const original = button.title;
  button.title = title;
  button.disabled = true;
  setTimeout(() => {
    button.disabled = false;
    button.title = original;
  }, 1500);
}

/* ── Boot ─────────────────────────────────────────────────────────────── */

let observer: MutationObserver | null = null;

function boot(): void {
  syncBadges();
  observer = new MutationObserver(() => {
    scheduleSync();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });
}

let syncPending = false;
function scheduleSync(): void {
  if (syncPending) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    syncBadges();
  });
}

if (document.querySelector(TWEET_SELECTOR)) {
  boot();
} else {
  const ready = new MutationObserver(() => {
    if (document.querySelector(TWEET_SELECTOR)) {
      ready.disconnect();
      boot();
    }
  });
  ready.observe(document.body, { childList: true, subtree: true });
}
