/**
 * The export layer: one page state in, four formats out.
 *
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * every format headlessly. HTML→Markdown conversion happens before this file
 * sees anything (see markdown.ts); here we only assemble documents.
 */

import { ExportOptions, ExportScope, PageMeta, PageState, ResolvedHighlight } from './types';

const MAX_FILENAME_LENGTH = 120;

export interface ExportInput {
  state: PageState;
  options: ExportOptions;
  scope: ExportScope;
  /** Required for scope 'page': the cleaned article, already converted. */
  article?: { markdown: string; html: string; text: string; fallback: boolean };
}

function orderedHighlights(state: PageState): ResolvedHighlight[] {
  // Document order for everything we could anchor; the ones we could not go
  // last, in creation order, so they are never silently lost (PRD §7).
  const anchored = state.highlights.filter(h => h.anchored).sort((a, b) => a.order - b.order);
  const orphans = state.highlights.filter(h => !h.anchored).sort((a, b) => a.createdAt - b.createdAt);
  return [...anchored, ...orphans];
}

function metaLines(meta: PageMeta, captured: string): Array<[string, string]> {
  return [
    ['title', meta.title],
    ['source', meta.url],
    ['author', meta.author],
    ['site', meta.site],
    ['published', meta.published],
    ['captured', captured],
  ].filter(([, value]) => Boolean(value)) as Array<[string, string]>;
}

function yamlValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/* ── Markdown ────────────────────────────────────────────────────────── */

export function toMarkdown(input: ExportInput): string {
  const { state, options, scope } = input;
  const parts: string[] = [];

  if (options.includeMeta) {
    // YAML front matter — this is what makes the file land properly in
    // Obsidian/Logseq, which is the whole point of the format.
    parts.push('---');
    for (const [key, value] of metaLines(state.meta, state.meta.captured)) {
      parts.push(`${key}: ${yamlValue(value)}`);
    }
    parts.push('---', '');
  }

  parts.push(`# ${state.meta.title}`, '');

  if (state.pageNote.trim()) {
    parts.push(state.pageNote.trim(), '');
  }

  if (scope === 'page') {
    parts.push(input.article?.markdown?.trim() || '_Nothing could be extracted from this page._');
    parts.push('');
  } else {
    const highlights = orderedHighlights(state);
    if (!highlights.length) {
      parts.push('_No highlights on this page yet._', '');
    }
    for (const highlight of highlights) {
      const quote = highlight.exact
        .trim()
        .split('\n')
        .map(line => `> ${line}`)
        .join('\n');
      parts.push(quote);
      if (!highlight.anchored) parts.push('>', '> _(could not be located on the page this visit)_');
      parts.push('');

      if (options.includeNotes && highlight.note.trim()) {
        parts.push(highlight.note.trim(), '');
      }
      if (options.includeSourceUrl) {
        parts.push(`[Source](${state.meta.url})`, '');
      }
    }
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Plain text ──────────────────────────────────────────────────────── */

export function toPlainText(input: ExportInput): string {
  const { state, options, scope } = input;
  const parts: string[] = [state.meta.title];

  if (options.includeMeta) {
    for (const [key, value] of metaLines(state.meta, state.meta.captured)) {
      if (key === 'title') continue;
      parts.push(`${key[0].toUpperCase()}${key.slice(1)}: ${value}`);
    }
  }
  parts.push('', '-'.repeat(60), '');

  if (state.pageNote.trim()) parts.push(state.pageNote.trim(), '');

  if (scope === 'page') {
    parts.push(input.article?.text?.trim() || 'Nothing could be extracted from this page.');
  } else {
    const highlights = orderedHighlights(state);
    if (!highlights.length) parts.push('No highlights on this page yet.');
    highlights.forEach((highlight, i) => {
      parts.push(`${i + 1}. ${highlight.exact.trim()}`);
      if (!highlight.anchored) parts.push('   (could not be located on the page this visit)');
      if (options.includeNotes && highlight.note.trim()) parts.push(`   Note: ${highlight.note.trim()}`);
      if (options.includeSourceUrl) parts.push(`   ${state.meta.url}`);
      parts.push('');
    });
  }

  return parts.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/* ── Clean HTML ──────────────────────────────────────────────────────── */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const HTML_STYLES = `
  :root { color-scheme: light dark; }
  body { max-width: 42rem; margin: 2rem auto; padding: 0 1rem;
         font: 16px/1.65 Georgia, "Iowan Old Style", serif; }
  h1, h2, h3 { font-family: -apple-system, "Segoe UI", sans-serif; line-height: 1.25; }
  img { max-width: 100%; height: auto; }
  pre { overflow-x: auto; padding: .75rem; background: rgba(127,127,127,.12); border-radius: 6px; }
  code { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: .9em; }
  blockquote { margin: 1rem 0; padding-left: 1rem; border-left: 3px solid rgba(127,127,127,.4); }
  table { border-collapse: collapse; } td, th { border: 1px solid rgba(127,127,127,.4); padding: .35rem .5rem; }
  mark { background: #ffe680; color: #0f0f0f; border-radius: 2px; }
  .wh-meta { font-family: -apple-system, "Segoe UI", sans-serif; font-size: .85rem;
             color: #666; border-bottom: 1px solid rgba(127,127,127,.3); padding-bottom: .75rem; }
  .wh-note { font-family: -apple-system, "Segoe UI", sans-serif; font-size: .95rem;
             margin: .25rem 0 1.5rem 1rem; color: #444; }
  @media (prefers-color-scheme: dark) { .wh-meta, .wh-note { color: #aaa; } }
`;

/**
 * Self-contained: no scripts, no external stylesheets, no trackers. That claim
 * is part of the product's positioning, so the document is assembled here
 * rather than copied out of the page.
 */
export function toHtml(input: ExportInput): string {
  const { state, options, scope } = input;
  const body: string[] = [`<h1>${escapeHtml(state.meta.title)}</h1>`];

  if (options.includeMeta) {
    const rows = metaLines(state.meta, state.meta.captured)
      .filter(([key]) => key !== 'title')
      .map(([key, value]) =>
        key === 'source'
          ? `<div>Source: <a href="${escapeHtml(value)}">${escapeHtml(value)}</a></div>`
          : `<div>${escapeHtml(key[0].toUpperCase() + key.slice(1))}: ${escapeHtml(value)}</div>`
      );
    body.push(`<div class="wh-meta">${rows.join('')}</div>`);
  }

  if (state.pageNote.trim()) body.push(`<p class="wh-note">${escapeHtml(state.pageNote.trim())}</p>`);

  if (scope === 'page') {
    body.push(input.article?.html || '<p><em>Nothing could be extracted from this page.</em></p>');
  } else {
    const highlights = orderedHighlights(state);
    if (!highlights.length) body.push('<p><em>No highlights on this page yet.</em></p>');
    for (const highlight of highlights) {
      body.push(`<blockquote><mark>${escapeHtml(highlight.exact.trim())}</mark>`);
      if (!highlight.anchored) body.push('<br><em>(could not be located on the page this visit)</em>');
      body.push('</blockquote>');
      if (options.includeNotes && highlight.note.trim()) {
        body.push(`<p class="wh-note">${escapeHtml(highlight.note.trim())}</p>`);
      }
      if (options.includeSourceUrl) {
        body.push(`<p class="wh-note"><a href="${escapeHtml(state.meta.url)}">Source</a></p>`);
      }
    }
  }

  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(state.meta.title)}</title>`,
    `<style>${HTML_STYLES}</style>`,
    '</head>',
    '<body>',
    body.join('\n'),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

/* ── PDF input ───────────────────────────────────────────────────────── */

export function toPdfDocument(input: ExportInput) {
  const { state, options, scope } = input;
  const header = options.includeMeta
    ? metaLines(state.meta, state.meta.captured)
        .filter(([key]) => key !== 'title')
        .map(([key, value]) => `${key[0].toUpperCase()}${key.slice(1)}: ${value}`)
    : [];

  const lines: Array<{ label: string; text: string }> = [];
  if (state.pageNote.trim()) lines.push({ label: 'Note:', text: state.pageNote.trim() });

  if (scope === 'page') {
    const source = input.article?.text?.trim() || 'Nothing could be extracted from this page.';
    for (const paragraph of source.split(/\n+/)) {
      if (paragraph.trim()) lines.push({ label: '', text: paragraph.trim() });
    }
  } else {
    orderedHighlights(state).forEach((highlight, i) => {
      lines.push({ label: `${i + 1}.`, text: highlight.exact.trim() });
      if (!highlight.anchored) lines.push({ label: '', text: '(could not be located on the page this visit)' });
      if (options.includeNotes && highlight.note.trim()) lines.push({ label: '', text: `Note: ${highlight.note.trim()}` });
      if (options.includeSourceUrl) lines.push({ label: '', text: state.meta.url });
    });
    if (!lines.length) lines.push({ label: '', text: 'No highlights on this page yet.' });
  }

  return { title: state.meta.title, header, lines };
}

/* ── Filenames ───────────────────────────────────────────────────────── */

/** `{site} - {page title}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(meta: PageMeta, ext: string): string {
  const stripControlChars = (value: string): string =>
    Array.from(value)
      .filter(ch => {
        const code = ch.codePointAt(0) ?? 0;
        return code >= 32 && code !== 127;
      })
      .join('');

  const clean = (value: string): string =>
    stripControlChars(value)
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\.+$/, '')
      .replace(/\s+/g, ' ')
      .trim();

  const suffix = `.${ext}`;
  const site = clean(meta.site);
  const title = clean(meta.title);

  let stem = [site, title].filter(Boolean).join(' - ') || 'highlights';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd().replace(/[-\s]+$/, '');

  return stem + suffix;
}
