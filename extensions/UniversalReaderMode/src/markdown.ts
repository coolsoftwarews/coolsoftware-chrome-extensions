/**
 * `GenericNode` → Markdown, dependency-free.
 *
 * Ported from WebHighlighter's `markdown.ts`, adapted to walk a `GenericNode`
 * tree instead of a real DOM `Node`. That swap is what makes this module run
 * identically in the browser and in `scripts/selftest.mjs` — no `DOMParser`
 * needed anywhere. Headings, lists, blockquotes, tables, code and images
 * (kept as `![alt](src)`, PRD-39 §7's "keep the reference, don't embed the
 * image" rule) all survive; code blocks are never mangled.
 */

import { GenericElement, GenericNode, attr } from './dom-tree';

const BLOCK_TAGS = new Set([
  'p',
  'div',
  'section',
  'article',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'table',
  'tr',
  'hr',
  'figure',
  'figcaption',
]);

function escapeText(value: string): string {
  return value.replace(/([\\`*_{}\[\]#+])/g, '\\$1').replace(/^(\s*)([->])/gm, '$1\\$2');
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ');
}

interface Context {
  pre: boolean;
  list: Array<{ ordered: boolean; index: number }>;
}

function indent(context: Context): string {
  return '  '.repeat(Math.max(0, context.list.length - 1));
}

function renderChildren(node: GenericNode, context: Context): string {
  if (node.type !== 'element') return '';
  let out = '';
  for (const child of node.children) out += renderNode(child, context);
  return out;
}

function cellsOf(row: GenericElement, context: Context): string[] {
  const cells: string[] = [];
  for (const child of row.children) {
    if (child.type === 'element' && (child.tag === 'th' || child.tag === 'td')) {
      cells.push(collapse(renderChildren(child, context)).trim() || ' ');
    }
  }
  return cells;
}

function renderTable(table: GenericElement, context: Context): string {
  const rows: GenericElement[] = [];
  const collectRows = (node: GenericElement) => {
    for (const child of node.children) {
      if (child.type !== 'element') continue;
      if (child.tag === 'tr') rows.push(child);
      else collectRows(child);
    }
  };
  collectRows(table);
  if (!rows.length) return '';

  const header = cellsOf(rows[0], context);
  const body = rows.slice(1).map(row => cellsOf(row, context));
  const width = Math.max(header.length, ...body.map(r => r.length), 1);
  const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill(' ')];

  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map(row => `| ${pad(row).join(' | ')} |`),
  ];
  return '\n' + lines.join('\n') + '\n\n';
}

function renderNode(node: GenericNode, context: Context): string {
  if (node.type === 'text') {
    const value = node.value;
    if (context.pre) return value;
    if (!value.trim()) return /\s/.test(value) ? ' ' : '';
    return escapeText(collapse(value));
  }

  const el = node;

  switch (el.tag) {
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const level = Number(el.tag[1]);
      const value = collapse(renderChildren(el, context)).trim();
      return value ? `\n${'#'.repeat(level)} ${value}\n\n` : '';
    }

    case 'p': {
      const value = renderChildren(el, context).trim();
      return value ? `\n${value}\n\n` : '';
    }

    case 'br':
      return context.pre ? '\n' : '  \n';

    case 'hr':
      return '\n---\n\n';

    case 'strong':
    case 'b': {
      const value = renderChildren(el, context).trim();
      return value ? `**${value}**` : '';
    }

    case 'em':
    case 'i': {
      const value = renderChildren(el, context).trim();
      return value ? `*${value}*` : '';
    }

    case 'del':
    case 's': {
      const value = renderChildren(el, context).trim();
      return value ? `~~${value}~~` : '';
    }

    case 'code': {
      const value = collapse(renderChildren(el, { ...context, pre: false })).trim();
      const longest = Math.max(0, ...(value.match(/`+/g) || []).map(run => run.length));
      const fence = '`'.repeat(longest + 1);
      return value ? `${fence}${value}${fence}` : '';
    }

    case 'pre': {
      const value = renderChildren(el, { ...context, pre: true }).replace(/\n+$/, '');
      const codeChild = el.children.find((c): c is GenericElement => c.type === 'element' && c.tag === 'code');
      const language = (codeChild ? attr(codeChild, 'class') : '').match(/language-([\w+-]+)/)?.[1] ?? '';
      return `\n\`\`\`${language}\n${value}\n\`\`\`\n\n`;
    }

    case 'a': {
      const value = renderChildren(el, context).trim();
      const href = attr(el, 'href');
      if (!value) return '';
      return href && !href.startsWith('javascript:') ? `[${value}](${href})` : value;
    }

    case 'img': {
      const src = attr(el, 'src');
      const alt = attr(el, 'alt').replace(/[\[\]]/g, '');
      return src ? `![${alt}](${src})` : '';
    }

    case 'blockquote': {
      const inner = renderChildren(el, context).trim();
      if (!inner) return '';
      const quoted = inner
        .split('\n')
        .map(line => (line.trim() ? `> ${line}` : '>'))
        .join('\n');
      return `\n${quoted}\n\n`;
    }

    case 'ul':
    case 'ol': {
      const ordered = el.tag === 'ol';
      const start = Number(attr(el, 'start') || '1');
      const nested = { ...context, list: [...context.list, { ordered, index: start }] };
      const inner = renderChildren(el, nested).replace(/\n{3,}/g, '\n\n');
      return `\n${inner.trim()}\n\n`;
    }

    case 'li': {
      const frame = context.list[context.list.length - 1];
      const bullet = frame?.ordered ? `${frame.index++}.` : '-';
      const inner = renderChildren(el, context).trim();
      if (!inner) return '';
      const body = inner.split('\n').join(`\n${indent(context)}  `);
      return `${indent(context)}${bullet} ${body}\n`;
    }

    case 'table':
      return renderTable(el, context);

    case 'figcaption': {
      const value = collapse(renderChildren(el, context)).trim();
      return value ? `\n*${value}*\n\n` : '';
    }

    default: {
      const inner = renderChildren(el, context);
      return BLOCK_TAGS.has(el.tag) && inner.trim() ? `\n${inner.trim()}\n\n` : inner;
    }
  }
}

export function treeToMarkdown(root: GenericNode): string {
  const markdown = renderChildren(root, { pre: false, list: [] });
  return markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
