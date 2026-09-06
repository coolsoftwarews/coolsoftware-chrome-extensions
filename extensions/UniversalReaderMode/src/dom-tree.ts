/**
 * A minimal, dependency-free HTML tree shape (`GenericNode`) that stands in
 * for a real DOM tree.
 *
 * Why not just use the real DOM? Two producers build this exact same shape:
 * `dom-adapter.ts` walks the live `document` in the browser, and
 * `htmlparse.ts` parses a raw HTML string in Node (fixtures for
 * `scripts/selftest.mjs`). Everything that actually decides what counts as
 * "the article" — `extract-core.ts` — is written once against this shape and
 * runs identically in both places, so the heuristic PRD-39 §5 calls the core
 * technical risk is genuinely covered by headless tests, not just exercised
 * live with no way to assert on it.
 */

export interface GenericElement {
  type: 'element';
  tag: string; // always lowercase
  attrs: Record<string, string>;
  children: GenericNode[];
}

export interface GenericText {
  type: 'text';
  value: string;
}

export type GenericNode = GenericElement | GenericText;

export function element(tag: string, attrs: Record<string, string> = {}, children: GenericNode[] = []): GenericElement {
  return { type: 'element', tag: tag.toLowerCase(), attrs, children };
}

export function text(value: string): GenericText {
  return { type: 'text', value };
}

export function isElement(node: GenericNode): node is GenericElement {
  return node.type === 'element';
}

export function attr(el: GenericElement, name: string): string {
  return el.attrs[name] ?? '';
}

export function className(el: GenericElement): string {
  return attr(el, 'class');
}

/** Concatenated text of a node and every descendant. */
export function textOf(node: GenericNode): string {
  if (node.type === 'text') return node.value;
  let out = '';
  for (const child of node.children) out += textOf(child);
  return out;
}

/** Depth-first collection of every descendant element matching `predicate`. */
export function findAll(node: GenericNode, predicate: (el: GenericElement) => boolean, out: GenericElement[] = []): GenericElement[] {
  if (node.type === 'element') {
    if (predicate(node)) out.push(node);
    for (const child of node.children) findAll(child, predicate, out);
  }
  return out;
}

/** First descendant (including the node itself) matching `predicate`, or null. */
export function find(node: GenericNode, predicate: (el: GenericElement) => boolean): GenericElement | null {
  if (node.type === 'element') {
    if (predicate(node)) return node;
    for (const child of node.children) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
  }
  return null;
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

/** Serializes a `GenericNode` back to an HTML string. Only `keepAttrs` survive. */
export function serializeHtml(node: GenericNode, keepAttrs: Set<string>): string {
  if (node.type === 'text') return escapeHtml(node.value);

  const kept = Object.entries(node.attrs).filter(([name]) => keepAttrs.has(name));
  const attrsStr = kept.map(([name, value]) => ` ${name}="${escapeAttr(value)}"`).join('');

  if (VOID_TAGS.has(node.tag)) return `<${node.tag}${attrsStr}>`;

  const inner = node.children.map(child => serializeHtml(child, keepAttrs)).join('');
  return `<${node.tag}${attrsStr}>${inner}</${node.tag}>`;
}

/** Clones a subtree, applying `mutate` to every element (return false to drop it). */
export function filterTree(node: GenericNode, keep: (el: GenericElement) => boolean): GenericNode | null {
  if (node.type === 'text') return node;
  if (!keep(node)) return null;
  const children: GenericNode[] = [];
  for (const child of node.children) {
    const kept = filterTree(child, keep);
    if (kept) children.push(kept);
  }
  return { ...node, children };
}
