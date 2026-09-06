/**
 * Injected on demand (background calls `chrome.scripting.executeScript` on a
 * toolbar click or the keyboard shortcut — there is no always-on content
 * script, per PRD-39 §6's "foreground only" spirit: nothing runs on a page
 * until the user actually asks for it).
 *
 * All UI lives inside one shadow root (`data-urm-host`), so the host page's
 * CSS can never reach in and the overlay can never leak into it either. The
 * overlay never writes to the live page's own DOM — closing it (Escape, the
 * close button, or invoking the extension again) leaves the page exactly as
 * it was. Four states, same as any AI/async feature in this portfolio:
 * loading ("Reading page…"), success (the reader view), empty (the honest
 * "this doesn't look like an article" message), error (extraction threw).
 */

import { GenericElement, serializeHtml } from './dom-tree';
import { pickArticleRoot, cleanTree } from './extract-core';
import { treeToMarkdown } from './markdown';
import { buildFilename, toPdfDocument, treeToText } from './formatters';
import { generatePdf } from './pdf';
import { countWords, estimateReadingMinutes } from './reading';
import { readPreferences, writePreferences } from './storage';
import { track } from './metrics';
import { buildBodyTree, pageIsSupported, readPageMeta } from './dom-adapter';
import {
  BackgroundResponse,
  ContentToBackground,
  DEFAULT_PREFERENCES,
  ExportFormat,
  ExtractReason,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_STEP,
  PageMeta,
  ReaderFont,
  ReaderPreferences,
  ReaderTheme,
  ReaderWidth,
} from './types';

const HOST_ATTR = 'data-urm-host';

/* ── Idempotent toggle: re-running this script closes an open overlay ──── */

const existing = document.querySelector(`[${HOST_ATTR}]`);
if (existing) {
  existing.remove();
  restoreFocus();
} else {
  void openReader();
}

/* ── Focus handling ──────────────────────────────────────────────────── */

let previouslyFocused: Element | null = null;

function restoreFocus(): void {
  if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
  previouslyFocused = null;
}

/* ── Shell ───────────────────────────────────────────────────────────── */

const REASON_MESSAGES: Record<ExtractReason, string> = {
  ok: '',
  'no-content-found': "This page doesn't look like an article — there's no readable content block here.",
  'insufficient-content': "This page doesn't look like an article — reader mode works best on articles and long-form posts.",
  'too-few-paragraphs': "This page doesn't look like an article — not enough of it reads as body text.",
};

async function openReader(): Promise<void> {
  previouslyFocused = document.activeElement;

  if (!pageIsSupported()) {
    // Toolbar/scripting injection already keeps this from firing on
    // chrome://, but file:// pages can still reach here.
    window.alert('Reader mode is not available on this type of page.');
    return;
  }

  const host = document.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);

  const dialog = document.createElement('div');
  dialog.className = 'urm-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Reader mode');
  shadow.appendChild(dialog);

  dialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      trapFocus(e, dialog);
    }
  });

  function close(): void {
    host.remove();
    restoreFocus();
  }

  renderLoading(dialog, close);

  let article: GenericElement | null = null;
  let reason: ExtractReason = 'ok';

  try {
    const first = pickArticleRoot(buildBodyTree());
    if (first.confidence === 'high') {
      article = first.root;
    } else {
      // A single-page app may still be hydrating when the user opens reader
      // mode (PRD-39 §7). Give it one short window to settle, then commit to
      // whatever the DOM shows.
      await delay(600);
      const retry = pickArticleRoot(buildBodyTree());
      article = retry.root;
      reason = retry.reason;
    }
  } catch {
    renderError(dialog, close, retry => {
      dialog.replaceChildren();
      void openReader();
      void retry;
    });
    void track('extraction_low_confidence');
    return;
  }

  if (!article) {
    void track('extraction_low_confidence');
    renderEmpty(dialog, close, REASON_MESSAGES[reason] || REASON_MESSAGES['insufficient-content']);
    return;
  }

  void track('extraction_high_confidence');
  void track('reader_opened');

  const meta = readPageMeta();
  const cleaned = cleanTree(article);
  const prefs = await readPreferences();
  renderReader(dialog, close, cleaned, meta, prefs);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function trapFocus(e: KeyboardEvent, container: HTMLElement): void {
  const focusable = Array.from(container.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
    el => !el.hasAttribute('disabled')
  );
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = container.getRootNode() instanceof ShadowRoot ? (container.getRootNode() as ShadowRoot).activeElement : document.activeElement;

  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/* ── States ──────────────────────────────────────────────────────────── */

function renderLoading(dialog: HTMLElement, close: () => void): void {
  dialog.replaceChildren();
  const box = document.createElement('div');
  box.className = 'urm-state';
  box.innerHTML = `<div class="urm-spinner" aria-hidden="true"></div><p>Reading page…</p>`;
  dialog.appendChild(box);
  dialog.appendChild(closeButton(close));
}

function renderEmpty(dialog: HTMLElement, close: () => void, message: string): void {
  dialog.replaceChildren();
  const box = document.createElement('div');
  box.className = 'urm-state';
  const p = document.createElement('p');
  p.textContent = message;
  const hint = document.createElement('p');
  hint.className = 'urm-hint';
  hint.textContent = 'If this page is still loading, wait a moment and try again.';
  box.append(p, hint);
  dialog.appendChild(box);
  dialog.appendChild(closeButton(close));
  dialog.querySelector<HTMLButtonElement>('.urm-close')?.focus();
}

function renderError(dialog: HTMLElement, close: () => void, onRetry: (x?: unknown) => void): void {
  dialog.replaceChildren();
  const box = document.createElement('div');
  box.className = 'urm-state';
  const p = document.createElement('p');
  p.textContent = 'Something went wrong reading this page.';
  const retry = document.createElement('button');
  retry.className = 'urm-btn';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => onRetry());
  box.append(p, retry);
  dialog.appendChild(box);
  dialog.appendChild(closeButton(close));
}

function closeButton(close: () => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'urm-close';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Close reader mode');
  btn.textContent = '✕';
  btn.addEventListener('click', close);
  return btn;
}

/* ── The reader view itself ──────────────────────────────────────────── */

function applyPreferences(dialog: HTMLElement, prefs: ReaderPreferences): void {
  dialog.style.setProperty('--urm-size', `${prefs.fontSize}px`);
  dialog.style.setProperty('--urm-font', FONT_STACKS[prefs.font]);
  dialog.style.setProperty('--urm-width', WIDTHS[prefs.width]);
  dialog.dataset.theme = prefs.theme;
}

const FONT_STACKS: Record<ReaderFont, string> = {
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", serif',
  sans: '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
};

const WIDTHS: Record<ReaderWidth, string> = { narrow: '560px', medium: '720px', wide: '900px' };

function renderReader(dialog: HTMLElement, close: () => void, article: GenericElement, meta: PageMeta, prefsIn: ReaderPreferences): void {
  let prefs = { ...prefsIn };
  dialog.replaceChildren();
  applyPreferences(dialog, prefs);

  const text = treeToText(article);
  const wordCount = countWords(text);
  const minutes = estimateReadingMinutes(wordCount);

  const toolbar = document.createElement('div');
  toolbar.className = 'urm-toolbar';

  const status = document.createElement('span');
  status.className = 'urm-status';
  status.setAttribute('aria-live', 'polite');

  toolbar.appendChild(buildFontControl(prefs, next => {
    prefs = { ...prefs, font: next };
    applyPreferences(dialog, prefs);
    void writePreferences(prefs);
    void track('font_changed');
  }));
  toolbar.appendChild(buildSizeControl(prefs, next => {
    prefs = { ...prefs, fontSize: next };
    applyPreferences(dialog, prefs);
    void writePreferences(prefs);
    void track('font_size_changed');
  }));
  toolbar.appendChild(buildThemeControl(prefs, next => {
    prefs = { ...prefs, theme: next };
    applyPreferences(dialog, prefs);
    void writePreferences(prefs);
    void track('theme_changed');
  }));
  toolbar.appendChild(buildWidthControl(prefs, next => {
    prefs = { ...prefs, width: next };
    applyPreferences(dialog, prefs);
    void writePreferences(prefs);
    void track('width_changed');
  }));
  toolbar.appendChild(buildExportControl(meta, article, status));
  toolbar.appendChild(closeButton(close));

  const header = document.createElement('header');
  header.className = 'urm-header';
  const h1 = document.createElement('h1');
  h1.tabIndex = -1;
  h1.textContent = meta.title;
  const byline = document.createElement('p');
  byline.className = 'urm-byline';
  const parts = [meta.author, meta.site, `${wordCount.toLocaleString('en-US')} words`, minutes ? `~${minutes} min read` : ''].filter(Boolean);
  byline.textContent = parts.join(' · ');
  header.append(h1, byline);

  const body = document.createElement('div');
  body.className = 'urm-body';
  body.innerHTML = serializeHtml(article, KEEP_ATTRS);

  dialog.append(toolbar, status); // status is visually hidden (aria-live region only)
  const scroller = document.createElement('div');
  scroller.className = 'urm-scroller';
  scroller.append(header, body);
  dialog.appendChild(scroller);

  h1.focus();
}

const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);

function buildFontControl(prefs: ReaderPreferences, onChange: (font: ReaderFont) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'urm-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Font');
  (['serif', 'sans', 'mono'] as ReaderFont[]).forEach(font => {
    const btn = document.createElement('button');
    btn.className = 'urm-btn urm-btn--icon';
    btn.type = 'button';
    btn.textContent = 'Aa';
    btn.title = `${font[0].toUpperCase()}${font.slice(1)} font`;
    btn.style.fontFamily = FONT_STACKS[font];
    btn.setAttribute('aria-pressed', String(prefs.font === font));
    btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      onChange(font);
    });
    group.appendChild(btn);
  });
  return group;
}

function buildSizeControl(prefs: ReaderPreferences, onChange: (size: number) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'urm-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Font size');

  const minus = document.createElement('button');
  minus.className = 'urm-btn';
  minus.type = 'button';
  minus.textContent = 'A−';
  minus.setAttribute('aria-label', 'Decrease font size');

  const plus = document.createElement('button');
  plus.className = 'urm-btn';
  plus.type = 'button';
  plus.textContent = 'A+';
  plus.setAttribute('aria-label', 'Increase font size');

  let size = prefs.fontSize;
  const clamp = (v: number) => Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, v));
  minus.addEventListener('click', () => {
    size = clamp(size - FONT_SIZE_STEP);
    onChange(size);
  });
  plus.addEventListener('click', () => {
    size = clamp(size + FONT_SIZE_STEP);
    onChange(size);
  });

  group.append(minus, plus);
  return group;
}

function buildThemeControl(prefs: ReaderPreferences, onChange: (theme: ReaderTheme) => void): HTMLElement {
  const group = document.createElement('div');
  group.className = 'urm-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Theme');
  (['light', 'sepia', 'dark'] as ReaderTheme[]).forEach(theme => {
    const btn = document.createElement('button');
    btn.className = `urm-btn urm-swatch urm-swatch--${theme}`;
    btn.type = 'button';
    btn.title = `${theme[0].toUpperCase()}${theme.slice(1)} theme`;
    btn.setAttribute('aria-pressed', String(prefs.theme === theme));
    btn.addEventListener('click', () => {
      group.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      onChange(theme);
    });
    group.appendChild(btn);
  });
  return group;
}

function buildWidthControl(prefs: ReaderPreferences, onChange: (width: ReaderWidth) => void): HTMLElement {
  const select = document.createElement('select');
  select.className = 'urm-select';
  select.setAttribute('aria-label', 'Line width');
  (['narrow', 'medium', 'wide'] as ReaderWidth[]).forEach(width => {
    const option = document.createElement('option');
    option.value = width;
    option.textContent = `${width[0].toUpperCase()}${width.slice(1)}`;
    option.selected = prefs.width === width;
    select.appendChild(option);
  });
  select.addEventListener('change', () => onChange(select.value as ReaderWidth));
  return select;
}

function buildExportControl(meta: PageMeta, article: GenericElement, status: HTMLElement): HTMLElement {
  const group = document.createElement('div');
  group.className = 'urm-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'Export');

  (['md', 'pdf', 'txt'] as ExportFormat[]).forEach(format => {
    const btn = document.createElement('button');
    btn.className = 'urm-btn';
    btn.type = 'button';
    btn.textContent = format.toUpperCase();
    btn.addEventListener('click', () => void doExport(format, meta, article, status));
    group.appendChild(btn);
  });

  return group;
}

async function doExport(format: ExportFormat, meta: PageMeta, article: GenericElement, status: HTMLElement): Promise<void> {
  status.textContent = 'Preparing export…';
  try {
    const filename = buildFilename(meta, format);
    let dataUrl: string;

    if (format === 'md') {
      const front = [
        '---',
        `title: "${meta.title.replace(/"/g, '\\"')}"`,
        `source: "${meta.url}"`,
        meta.author ? `author: "${meta.author.replace(/"/g, '\\"')}"` : '',
        `captured: "${meta.captured}"`,
        '---',
        '',
      ]
        .filter(line => line !== '')
        .join('\n');
      const md = `${front}\n${treeToMarkdown(article)}\n`;
      dataUrl = `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`;
    } else if (format === 'txt') {
      const txt = `${meta.title}\n${meta.url}\n\n${treeToText(article)}\n`;
      dataUrl = `data:text/plain;charset=utf-8,${encodeURIComponent(txt)}`;
    } else {
      const pdf = generatePdf(toPdfDocument(article, meta));
      dataUrl = await blobToDataUrl(pdf.blob);
      if (pdf.unsupportedCharacters.length) {
        status.textContent = 'Some characters could not be included in the PDF — try Markdown or TXT for full fidelity.';
      }
    }

    const response = await sendDownload({ type: 'URM_DOWNLOAD', filename, dataUrl });
    if (response.ok) {
      status.textContent = `Exported ${filename}`;
      void track(format === 'md' ? 'export_md' : format === 'pdf' ? 'export_pdf' : 'export_txt');
    } else {
      status.textContent = "Couldn't save the file — try again.";
    }
  } catch {
    status.textContent = "Couldn't build that export — try a different format.";
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

function sendDownload(message: ContentToBackground): Promise<BackgroundResponse> {
  return new Promise(resolve => {
    try {
      chrome.runtime.sendMessage(message, (response: BackgroundResponse | undefined) => {
        if (chrome.runtime.lastError || !response) resolve({ ok: false, error: 'no response' });
        else resolve(response);
      });
    } catch {
      resolve({ ok: false, error: 'send failed' });
    }
  });
}

/* ── Styles ──────────────────────────────────────────────────────────── */

const SHADOW_CSS = `
  :host, .urm-dialog, .urm-dialog * { box-sizing: border-box; }
  .urm-dialog {
    position: fixed; inset: 0; overflow: hidden;
    background: #0f0f0fcc;
    font: 15px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; flex-direction: column; align-items: center;
    --urm-size: 18px; --urm-font: Georgia, serif; --urm-width: 720px;
  }
  .urm-dialog[data-theme="light"] { --urm-bg: #ffffff; --urm-fg: #1f1f1f; --urm-muted: #5b5b5b; }
  .urm-dialog[data-theme="sepia"] { --urm-bg: #f4ecd8; --urm-fg: #2b2313; --urm-muted: #6b5d3f; }
  .urm-dialog[data-theme="dark"] { --urm-bg: #14181c; --urm-fg: #e8e8e8; --urm-muted: #9aa0a6; }
  .urm-scroller {
    background: var(--urm-bg, #fff); color: var(--urm-fg, #1f1f1f);
    width: 100%; max-width: var(--urm-width); height: 100%;
    overflow-y: auto; padding: 72px 32px 64px;
  }
  .urm-header h1 { font: 700 1.6em/1.25 var(--urm-font); margin: 0 0 8px; outline: none; }
  .urm-byline { color: var(--urm-muted, #666); font-size: 0.85em; margin: 0 0 28px; }
  .urm-body { font-family: var(--urm-font); font-size: var(--urm-size); }
  .urm-body p { margin: 0 0 1.1em; }
  .urm-body img { max-width: 100%; height: auto; border-radius: 6px; }
  .urm-body pre { overflow-x: auto; padding: 12px; background: rgba(127,127,127,.12); border-radius: 6px; }
  .urm-body blockquote { margin: 0 0 1.1em; padding-left: 14px; border-left: 3px solid rgba(127,127,127,.4); color: var(--urm-muted); }
  .urm-body a { color: inherit; }
  .urm-toolbar {
    position: fixed; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 10px;
    padding: 10px 16px; background: #1f1f1fee; backdrop-filter: blur(6px);
    z-index: 1;
  }
  .urm-group { display: flex; gap: 4px; align-items: center; }
  .urm-btn {
    border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.06); color: #fff;
    border-radius: 6px; padding: 6px 10px; font: inherit; cursor: pointer; line-height: 1;
  }
  .urm-btn:hover { background: rgba(255,255,255,.16); }
  .urm-btn:focus-visible, .urm-select:focus-visible, .urm-close:focus-visible { outline: 2px solid #6cb2ff; outline-offset: 2px; }
  .urm-btn[aria-pressed="true"] { background: #fff; color: #14181c; }
  .urm-btn--icon { font-weight: 600; }
  .urm-select { background: rgba(255,255,255,.06); color: #fff; border: 1px solid rgba(255,255,255,.25); border-radius: 6px; padding: 6px; font: inherit; }
  .urm-swatch { width: 26px; height: 26px; padding: 0; border-radius: 50%; }
  .urm-swatch--light { background: #ffffff; }
  .urm-swatch--sepia { background: #f4ecd8; }
  .urm-swatch--dark { background: #14181c; }
  .urm-swatch[aria-pressed="true"] { outline: 2px solid #6cb2ff; outline-offset: 2px; }
  .urm-close {
    margin-left: auto; border: none; background: none; color: #fff; font-size: 1.1em; cursor: pointer;
    width: 32px; height: 32px; border-radius: 50%;
  }
  .urm-close:hover { background: rgba(255,255,255,.14); }
  .urm-status { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .urm-state {
    color: #fff; text-align: center; max-width: 420px; margin: auto;
    display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px;
  }
  .urm-hint { color: #b8b8b8; font-size: 0.9em; }
  .urm-spinner {
    width: 28px; height: 28px; border-radius: 50%;
    border: 3px solid rgba(255,255,255,.25); border-top-color: #fff;
    animation: urm-spin 0.8s linear infinite;
  }
  @keyframes urm-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .urm-spinner { animation: none; } }
`;
