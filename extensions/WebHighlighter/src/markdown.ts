/**
 * HTML → Markdown, dependency-free.
 *
 * The Obsidian/Logseq wedge (PRD §4) is the sharpest one this product has, and
 * those users can tell clean Markdown from soup instantly. So this walks the
 * parsed DOM rather than running regexes over a string: headings, lists,
 * blockquotes, tables, code and — crucially — `<mark>` survive intact, and
 * code blocks are never mangled.
 *
 * Runs in the panel, which parses the content script's cleaned HTML with
 * DOMParser. Nothing here executes page script: DOMParser documents are inert.
 */

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'SECTION',
  'ARTICLE',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'TR',
  'HR',
  'FIGURE',
  'FIGCAPTION',
]);

/** Escapes the characters that would otherwise become accidental Markdown. */
function escapeText(text: string): string {
  return text.replace(/([\\`*_{}\[\]#+])/g, '\\$1').replace(/^(\s*)([->])/gm, '$1\\$2');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

interface Context {
  /** Inside <pre>: whitespace is content, nothing is escaped. */
  pre: boolean;
  /** Blockquote depth, rendered as leading '> '. */
  quote: number;
  /** Enclosing list stack — an ordered list needs its own counter. */
  list: Array<{ ordered: boolean; index: number }>;
  /** Keep <mark> as ==highlight== rather than dropping it. */
  keepMarks: boolean;
}

function indent(context: Context): string {
  return '  '.repeat(Math.max(0, context.list.length - 1));
}

function renderChildren(node: Node, context: Context): string {
  let out = '';
  for (const child of Array.from(node.childNodes)) out += renderNode(child, context);
  return out;
}

function renderTable(table: HTMLTableElement, context: Context): string {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return '';

  const cellsOf = (row: Element) =>
    Array.from(row.querySelectorAll('th, td')).map(cell => collapse(renderChildren(cell, context)).trim() || ' ');

  const header = cellsOf(rows[0]);
  const body = rows.slice(1).map(cellsOf);
  const width = Math.max(header.length, ...body.map(r => r.length), 1);
  const pad = (cells: string[]) => [...cells, ...Array(Math.max(0, width - cells.length)).fill(' ')];

  const lines = [
    `| ${pad(header).join(' | ')} |`,
    `| ${Array(width).fill('---').join(' | ')} |`,
    ...body.map(row => `| ${pad(row).join(' | ')} |`),
  ];
  return '\n' + lines.join('\n') + '\n\n';
}

function renderNode(node: Node, context: Context): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = node.nodeValue ?? '';
    if (context.pre) return value;
    if (!value.trim()) return /\s/.test(value) ? ' ' : '';
    return escapeText(collapse(value));
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;

  switch (el.tagName) {
    case 'H1':
    case 'H2':
    case 'H3':
    case 'H4':
    case 'H5':
    case 'H6': {
      const level = Number(el.tagName[1]);
      const text = collapse(renderChildren(el, context)).trim();
      return text ? `\n${'#'.repeat(level)} ${text}\n\n` : '';
    }

    case 'P': {
      const text = renderChildren(el, context).trim();
      return text ? `\n${text}\n\n` : '';
    }

    case 'BR':
      return context.pre ? '\n' : '  \n';

    case 'HR':
      return '\n---\n\n';

    case 'STRONG':
    case 'B': {
      const text = renderChildren(el, context).trim();
      return text ? `**${text}**` : '';
    }

    case 'EM':
    case 'I': {
      const text = renderChildren(el, context).trim();
      return text ? `*${text}*` : '';
    }

    case 'DEL':
    case 'S': {
      const text = renderChildren(el, context).trim();
      return text ? `~~${text}~~` : '';
    }

    case 'MARK': {
      const text = renderChildren(el, context).trim();
      if (!text) return '';
      return context.keepMarks ? `==${text}==` : text;
    }

    case 'CODE': {
      if (el.closest('pre')) return renderChildren(el, { ...context, pre: true });
      const text = (el.textContent || '').trim();
      // Pick a fence longer than any backtick run inside the snippet.
      const longest = Math.max(0, ...(text.match(/`+/g) || []).map(run => run.length));
      const fence = '`'.repeat(longest + 1);
      return text ? `${fence}${text}${fence}` : '';
    }

    case 'PRE': {
      const text = (el.textContent || '').replace(/\n+$/, '');
      const language = (el.querySelector('code')?.className || '').match(/language-([\w+-]+)/)?.[1] ?? '';
      return `\n\`\`\`${language}\n${text}\n\`\`\`\n\n`;
    }

    case 'A': {
      const text = renderChildren(el, context).trim();
      const href = el.getAttribute('href') || '';
      if (!text) return '';
      return href && !href.startsWith('javascript:') ? `[${text}](${href})` : text;
    }

    case 'IMG': {
      const src = el.getAttribute('src') || '';
      const alt = (el.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      return src ? `![${alt}](${src})` : '';
    }

    case 'BLOCKQUOTE': {
      const inner = renderChildren(el, { ...context, quote: context.quote + 1 }).trim();
      if (!inner) return '';
      const quoted = inner
        .split('\n')
        .map(line => (line.trim() ? `> ${line}` : '>'))
        .join('\n');
      return `\n${quoted}\n\n`;
    }

    case 'UL':
    case 'OL': {
      const ordered = el.tagName === 'OL';
      const start = Number(el.getAttribute('start') || '1');
      const nested = { ...context, list: [...context.list, { ordered, index: start }] };
      const inner = renderChildren(el, nested).replace(/\n{3,}/g, '\n\n');
      return `\n${inner.trim()}\n\n`;
    }

    case 'LI': {
      const frame = context.list[context.list.length - 1];
      const bullet = frame?.ordered ? `${frame.index++}.` : '-';
      const inner = renderChildren(el, context).trim();
      if (!inner) return '';
      // Continuation lines of a multi-line item line up under its bullet.
      const body = inner.split('\n').join(`\n${indent(context)}  `);
      return `${indent(context)}${bullet} ${body}\n`;
    }

    case 'TABLE':
      return renderTable(el as HTMLTableElement, context);

    case 'FIGCAPTION': {
      const text = collapse(renderChildren(el, context)).trim();
      return text ? `\n*${text}*\n\n` : '';
    }

    default: {
      const inner = renderChildren(el, context);
      return BLOCK_TAGS.has(el.tagName) && inner.trim() ? `\n${inner.trim()}\n\n` : inner;
    }
  }
}

export function htmlToMarkdown(html: string, options: { keepMarks?: boolean } = {}): string {
  const doc = new DOMParser().parseFromString(`<div id="wh-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('wh-root');
  if (!root) return '';

  const markdown = renderChildren(root, {
    pre: false,
    quote: 0,
    list: [],
    keepMarks: options.keepMarks ?? true,
  });

  return markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text from cleaned HTML, used by the .txt export. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
