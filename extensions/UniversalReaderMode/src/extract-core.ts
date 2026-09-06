/**
 * The extraction heuristic: given a parsed page tree, find the main article
 * content and say honestly how confident that finding is.
 *
 * This is a dependency-free Readability-in-miniature, the same spirit as
 * WebHighlighter's `extract.ts` — score block candidates by how much real
 * paragraph text they hold, take the winner, strip everything that is not
 * content. The difference from WebHighlighter (which silently falls back to
 * `document.body` when nothing scores well) is PRD-39 §5's own requirement:
 * when the extraction is not confident, this module says so explicitly
 * (`confidence: 'low'` + a reason) instead of handing back a mangled result.
 *
 * Pure — operates on `GenericNode`, not the real DOM — so it runs unchanged
 * against both the live page (via `dom-adapter.ts`) and the HTML fixtures in
 * `scripts/selftest.mjs` (via `htmlparse.ts`). That is what makes this
 * extension's core technical risk (PRD-39 §5) genuinely covered by headless
 * tests rather than only exercised live with no way to assert on it.
 */

import { GenericElement, GenericNode, attr, className, filterTree, findAll, isElement, textOf } from './dom-tree';
import { ExtractConfidence, ExtractReason } from './types';

const STRIP_TAGS = new Set([
  'script',
  'style',
  'noscript',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'svg',
  'canvas',
  'video',
  'audio',
  'nav',
  'aside',
  'footer',
  'header',
  'link',
  'meta',
  'template',
]);

/** Class/id fragments that almost always mark furniture rather than content. */
const JUNK_PATTERN =
  /(^|[-_ ])(ad|ads|advert|banner|breadcrumb|comment|complementary|cookie|disqus|footer|header|masthead|menu|modal|newsletter|nav|paywall|popup|promo|related|share|sidebar|social|sponsor|subscribe|toolbar|widget)([-_ ]|$)/i;

const CANDIDATE_TAGS = new Set(['article', 'main', 'section', 'div']);

/** 500 characters of paragraph text is roughly "a short blog post" — the floor. */
const CONTENT_FLOOR = 500;
const MIN_PARAGRAPHS = 2;
const CANDIDATE_CAP = 600;

function isJunk(el: GenericElement): boolean {
  const signature = `${className(el)} ${attr(el, 'id')}`;
  return JUNK_PATTERN.test(signature);
}

function isCandidate(el: GenericElement): boolean {
  if (CANDIDATE_TAGS.has(el.tag)) return true;
  if (attr(el, 'role') === 'main') return true;
  return false;
}

interface Scored {
  el: GenericElement;
  score: number;
  paragraphCount: number;
}

function scoreCandidate(el: GenericElement): Scored {
  if (isJunk(el)) return { el, score: 0, paragraphCount: 0 };

  const paragraphs = findAll(el, e => ['p', 'li', 'blockquote', 'pre'].includes(e.tag));
  let score = 0;
  let counted = 0;
  for (const p of paragraphs) {
    const length = textOf(p).trim().length;
    if (length < 25) continue;
    score += Math.min(length, 1000);
    counted++;
  }

  // Link-dense blocks are navigation dressed up as content.
  const totalText = textOf(el).trim().length || 1;
  const links = findAll(el, e => e.tag === 'a');
  const linkText = links.reduce((sum, a) => sum + textOf(a).length, 0);
  const linkDensity = linkText / totalText;
  if (linkDensity > 0.5) score *= 0.2;

  // A real <article> tag, or explicit schema.org Article markup, is a strong
  // structural signal worth a modest boost over an equally-sized <div>.
  const itemtype = attr(el, 'itemtype');
  if (el.tag === 'article' || /schema\.org\/(Article|NewsArticle|BlogPosting)/i.test(itemtype)) {
    score *= 1.15;
  }

  return { el, score, paragraphCount: counted };
}

export interface PickResult {
  root: GenericElement | null;
  confidence: ExtractConfidence;
  reason: ExtractReason;
}

/**
 * Picks the best candidate block and reports how confident that pick is.
 * Never guesses past the floor — a page with no article-shaped content gets
 * `confidence: 'low'` and a `root` of `null`, not a best-effort dump of
 * whatever scored highest among nothing much.
 */
export function pickArticleRoot(pageRoot: GenericNode): PickResult {
  const candidates = findAll(pageRoot, isCandidate).slice(0, CANDIDATE_CAP);

  let best: Scored | null = null;
  for (const candidate of candidates) {
    const scored = scoreCandidate(candidate);
    // Prefer a clearly-better candidate; a near-tie keeps the first (outer)
    // one found, which in document order tends to be the more complete block.
    if (!best || scored.score > best.score * 1.1) best = scored;
  }

  if (!best || best.score === 0) {
    return { root: null, confidence: 'low', reason: 'no-content-found' };
  }
  if (best.score < CONTENT_FLOOR) {
    return { root: null, confidence: 'low', reason: 'insufficient-content' };
  }
  if (best.paragraphCount < MIN_PARAGRAPHS) {
    return { root: null, confidence: 'low', reason: 'too-few-paragraphs' };
  }
  return { root: best.el, confidence: 'high', reason: 'ok' };
}

const KEEP_ATTRS = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan']);

/** Strips boilerplate tags, junk-classed elements and non-content attributes. */
export function cleanTree(root: GenericElement): GenericElement {
  const filtered = filterTree(root, el => !STRIP_TAGS.has(el.tag) && !isJunk(el));
  const cleaned = (filtered ?? { ...root, children: [] }) as GenericElement;
  return stripAttrs(dropEmptyWrappers(cleaned));
}

function stripAttrs(node: GenericElement): GenericElement {
  const attrs: Record<string, string> = {};
  for (const [name, value] of Object.entries(node.attrs)) {
    if (KEEP_ATTRS.has(name)) attrs[name] = value;
  }
  return { ...node, attrs, children: node.children.map(child => (isElement(child) ? stripAttrs(child) : child)) };
}

/** Collapses div/span/section wrappers the strip pass emptied out. */
function dropEmptyWrappers(node: GenericElement): GenericElement {
  const children: GenericNode[] = [];
  for (const child of node.children) {
    if (!isElement(child)) {
      children.push(child);
      continue;
    }
    const cleanedChild = dropEmptyWrappers(child);
    const isWrapper = ['div', 'span', 'section'].includes(cleanedChild.tag);
    const hasText = textOf(cleanedChild).trim().length > 0;
    const hasImg = !!findAll(cleanedChild, e => e.tag === 'img').length;
    if (isWrapper && !hasText && !hasImg) continue;
    children.push(cleanedChild);
  }
  return { ...node, children };
}
