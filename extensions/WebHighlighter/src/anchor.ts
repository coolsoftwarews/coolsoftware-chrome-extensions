/**
 * The DOM half of anchoring: flatten the page to one string, translate between
 * that string and DOM ranges, and paint marks.
 *
 * The search itself lives in quote.ts and never sees a node — this file only
 * has to agree with it about what "the page's text" means.
 */

import { QuoteSelector, describeQuote, findQuote } from './quote';
import { HighlightColor } from './types';

export const MARK_ATTR = 'data-wh-id';
export const UI_ATTR = 'data-wh-ui';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'SVG', 'CANVAS', 'IFRAME', 'SELECT', 'HEAD']);

export interface TextIndex {
  text: string;
  nodes: Text[];
  /** starts[i] = offset of nodes[i] within `text`. */
  starts: number[];
}

/**
 * Walks the rendered text of the document in document order.
 * Our own injected UI carries `data-wh-ui` and is skipped, or the toolbar's
 * labels would end up inside people's quotes.
 */
export function buildIndex(root: Node = document.body): TextIndex {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (SKIP_TAGS.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
      if (parent.closest(`[${UI_ATTR}]`)) return NodeFilter.FILTER_REJECT;
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let current = walker.nextNode() as Text | null;
  while (current) {
    nodes.push(current);
    starts.push(text.length);
    text += current.nodeValue ?? '';
    current = walker.nextNode() as Text | null;
  }

  return { text, nodes, starts };
}

function nodeIndexAt(index: TextIndex, offset: number): number {
  // Binary search for the node containing `offset`.
  let low = 0;
  let high = index.starts.length - 1;
  let found = -1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (index.starts[mid] <= offset) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

function offsetOfNode(index: TextIndex, node: Text): number {
  const at = index.nodes.indexOf(node);
  return at === -1 ? -1 : index.starts[at];
}

/** Range → offsets in the flattened text. Null when the range is outside it. */
export function rangeToOffsets(index: TextIndex, range: Range): { start: number; end: number } | null {
  const startNode = range.startContainer;
  const endNode = range.endContainer;
  if (startNode.nodeType !== Node.TEXT_NODE || endNode.nodeType !== Node.TEXT_NODE) {
    // Selections that begin on an element boundary (triple-click, some editors)
    // still contain text nodes; take the first and last of them.
    const contained = index.nodes.filter(node => range.intersectsNode(node));
    if (!contained.length) return null;
    const first = contained[0];
    const last = contained[contained.length - 1];
    return {
      start: offsetOfNode(index, first),
      end: offsetOfNode(index, last) + (last.nodeValue?.length ?? 0),
    };
  }

  const startBase = offsetOfNode(index, startNode as Text);
  const endBase = offsetOfNode(index, endNode as Text);
  if (startBase === -1 || endBase === -1) return null;

  const start = startBase + range.startOffset;
  const end = endBase + range.endOffset;
  return end > start ? { start, end } : null;
}

/** Offsets in the flattened text → a live Range. */
export function offsetsToRange(index: TextIndex, start: number, end: number): Range | null {
  const startAt = nodeIndexAt(index, start);
  const endAt = nodeIndexAt(index, Math.max(start, end - 1));
  if (startAt === -1 || endAt === -1) return null;

  const range = document.createRange();
  range.setStart(index.nodes[startAt], start - index.starts[startAt]);
  range.setEnd(index.nodes[endAt], Math.min(end - index.starts[endAt], index.nodes[endAt].nodeValue?.length ?? 0));
  return range.collapsed ? null : range;
}

/** Builds the stored selector for the user's current selection. */
export function describeRange(index: TextIndex, range: Range): (QuoteSelector & { text: string }) | null {
  const offsets = rangeToOffsets(index, range);
  if (!offsets) return null;

  // Trim whitespace the browser tends to include at the edges of a selection.
  let { start, end } = offsets;
  while (start < end && /\s/.test(index.text[start])) start++;
  while (end > start && /\s/.test(index.text[end - 1])) end--;
  if (end - start < 1) return null;

  return { ...describeQuote(index.text, start, end), text: index.text.slice(start, end) };
}

export interface AnchorOutcome {
  range: Range | null;
  pass: 'exact' | 'whitespace' | 'fuzzy' | 'failed';
}

export function anchorSelector(index: TextIndex, selector: QuoteSelector): AnchorOutcome {
  const match = findQuote(index.text, selector);
  if (!match) return { range: null, pass: 'failed' };
  const range = offsetsToRange(index, match.start, match.end);
  return range ? { range, pass: match.pass } : { range: null, pass: 'failed' };
}

/* ── Painting ────────────────────────────────────────────────────────── */

/**
 * Light backgrounds with an explicit dark text colour, so a highlight stays
 * legible on dark-mode sites instead of turning into light-on-light (PRD §8).
 */
export const COLOR_VALUES: Record<HighlightColor, string> = {
  yellow: '#ffe680',
  green: '#b6f2c4',
  blue: '#b9dcff',
  pink: '#ffc4dd',
};

function markStyle(color: HighlightColor, active: boolean): string {
  return [
    `background-color:${COLOR_VALUES[color]}`,
    'color:#0f0f0f',
    'border-radius:2px',
    'padding:0',
    'margin:0',
    // The mark must not change metrics — PRD §6 asks for zero layout shift.
    'font:inherit',
    'line-height:inherit',
    'box-decoration-break:clone',
    '-webkit-box-decoration-break:clone',
    'cursor:pointer',
    active ? 'box-shadow:0 0 0 2px rgba(0,0,0,0.35)' : '',
  ]
    .filter(Boolean)
    .join(';');
}

function wrapTextNode(node: Text, from: number, to: number, id: string, color: HighlightColor): HTMLElement | null {
  const value = node.nodeValue ?? '';
  if (from >= to || !value.slice(from, to).trim()) return null;

  const middle = from > 0 ? node.splitText(from) : node;
  if (to - from < (middle.nodeValue?.length ?? 0)) middle.splitText(to - from);

  const mark = document.createElement('mark');
  mark.setAttribute(MARK_ATTR, id);
  mark.setAttribute('style', markStyle(color, false));
  middle.parentNode?.replaceChild(mark, middle);
  mark.appendChild(middle);
  return mark;
}

/**
 * Wraps every text node the range touches. Nodes are collected before any
 * splitting happens, since splitting invalidates the range's own offsets.
 */
export function paintRange(range: Range, id: string, color: HighlightColor): HTMLElement[] {
  const startNode = range.startContainer;
  const endNode = range.endContainer;

  const targets: Array<{ node: Text; from: number; to: number }> = [];
  const walker = document.createTreeWalker(
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? (range.commonAncestorContainer.parentNode as Node)
      : range.commonAncestorContainer,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest(`[${UI_ATTR}]`)) {
          return NodeFilter.FILTER_REJECT;
        }
        return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    }
  );

  let node = walker.nextNode() as Text | null;
  while (node) {
    const length = node.nodeValue?.length ?? 0;
    const from = node === startNode ? range.startOffset : 0;
    const to = node === endNode ? range.endOffset : length;
    if (to > from) targets.push({ node, from, to });
    node = walker.nextNode() as Text | null;
  }

  const marks: HTMLElement[] = [];
  for (const target of targets) {
    const mark = wrapTextNode(target.node, target.from, target.to, id, color);
    if (mark) marks.push(mark);
  }
  return marks;
}

export function findMarks(id: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`mark[${MARK_ATTR}="${CSS.escape(id)}"]`));
}

export function recolorMarks(id: string, color: HighlightColor): void {
  for (const mark of findMarks(id)) mark.setAttribute('style', markStyle(color, false));
}

export function flashMarks(id: string, color: HighlightColor): void {
  const marks = findMarks(id);
  for (const mark of marks) mark.setAttribute('style', markStyle(color, true));
  setTimeout(() => {
    for (const mark of marks) mark.setAttribute('style', markStyle(color, false));
  }, 1200);
}

/** Removes the wrapper but keeps the text, then re-joins the split text nodes. */
export function unpaint(id: string): void {
  for (const mark of findMarks(id)) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

export function unpaintAll(): void {
  for (const mark of Array.from(document.querySelectorAll<HTMLElement>(`mark[${MARK_ATTR}]`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}
