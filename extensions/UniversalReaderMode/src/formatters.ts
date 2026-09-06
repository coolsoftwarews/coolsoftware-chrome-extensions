/**
 * Export formatting: plain text, filenames, and the PDF line layout. Pure —
 * no DOM, no `chrome.*` — fully covered by `scripts/selftest.mjs`.
 */

import { GenericElement, GenericNode, attr } from './dom-tree';
import { PdfDocumentInput, PdfLine } from './pdf';
import { PageMeta } from './types';

/* ── Plain text ──────────────────────────────────────────────────────── */

const BLOCK_TAGS = new Set(['p', 'div', 'section', 'article', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote', 'pre', 'tr', 'figcaption']);

function walkText(node: GenericNode, out: string[]): void {
  if (node.type === 'text') {
    const value = node.value.replace(/[ \t]+/g, ' ');
    if (value.trim() || /\s/.test(value)) out.push(value);
    return;
  }
  if (node.tag === 'br') {
    out.push('\n');
    return;
  }
  if (node.tag === 'img') {
    const alt = attr(node, 'alt').trim();
    out.push(alt ? `[image: ${alt}]` : '[image]');
    return;
  }
  for (const child of node.children) walkText(child, out);
  if (BLOCK_TAGS.has(node.tag)) out.push('\n\n');
}

/** Plain text from a cleaned tree, no Markdown syntax. */
export function treeToText(root: GenericNode): string {
  const out: string[] = [];
  walkText(root, out);
  return out
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ── Filenames ───────────────────────────────────────────────────────── */

const FILENAME_MAX = 120;

function sanitize(part: string): string {
  return part
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `{site} - {title}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(meta: Pick<PageMeta, 'site' | 'title'>, ext: string): string {
  const site = sanitize(meta.site) || 'page';
  const title = sanitize(meta.title) || 'untitled';
  const base = `${site} - ${title}`;
  const suffix = `.${ext}`;
  const maxBase = FILENAME_MAX - suffix.length;
  const truncated = base.length > maxBase ? base.slice(0, maxBase).trim() : base;
  return `${truncated}${suffix}`;
}

/* ── PDF document shape ──────────────────────────────────────────────── */

function walkPdfLines(node: GenericNode, out: PdfLine[], listDepth = 0): void {
  if (node.type === 'text') return;

  switch (node.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const value = textOfShallow(node).trim();
      if (value) out.push({ label: '', text: value.toUpperCase() });
      return;
    }
    case 'p':
    case 'blockquote':
    case 'figcaption': {
      const value = textOfShallow(node).trim();
      if (value) out.push({ label: '', text: node.tag === 'blockquote' ? `"${value}"` : value });
      return;
    }
    case 'li': {
      const value = textOfShallow(node).trim();
      if (value) out.push({ label: '', text: `${'  '.repeat(listDepth)}- ${value}` });
      return;
    }
    case 'pre': {
      const value = textOfShallow(node).trim();
      if (value) out.push({ label: '', text: value });
      return;
    }
    case 'ul':
    case 'ol':
      for (const child of node.children) walkPdfLines(child, out, listDepth + 1);
      return;
    default:
      for (const child of node.children) walkPdfLines(child, out, listDepth);
  }
}

function textOfShallow(node: GenericElement): string {
  let out = '';
  for (const child of node.children) {
    if (child.type === 'text') out += child.value;
    else if (child.tag === 'img') out += attr(child, 'alt') ? ` [${attr(child, 'alt')}] ` : '';
    else out += textOfShallow(child) + ' ';
  }
  return out.replace(/\s+/g, ' ');
}

export function toPdfDocument(article: GenericNode, meta: PageMeta): PdfDocumentInput {
  const lines: PdfLine[] = [];
  walkPdfLines(article, lines);
  const header = [meta.author ? `By ${meta.author}` : '', meta.site, meta.url].filter(Boolean);
  return { title: meta.title || 'Untitled', header, lines };
}
