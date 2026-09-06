/**
 * A small, dependency-free HTML string → `GenericNode` parser.
 *
 * This is a test/fixture utility, not the production extraction path — the
 * live content script (`dom-adapter.ts`) walks the browser's own already-parsed
 * `document`, which is far more robust against real-world malformed markup
 * than any hand-rolled parser could be. This one only has to handle
 * reasonably well-formed HTML (the fixtures in `scripts/selftest.mjs`), which
 * is what makes `extract-core.ts`'s heuristics genuinely unit-testable without
 * a browser or a dependency like jsdom. See PRD-39 §5 and this extension's
 * README for the honest tradeoff.
 */

import { GenericElement, GenericNode, element, text } from './dom-tree';

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const RAW_TEXT_TAGS = new Set(['script', 'style']);

function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|[^\s"'=<>`]+))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(raw))) {
    const name = match[1].toLowerCase();
    const value = match[3] ?? match[4] ?? match[2] ?? '';
    attrs[name] = decodeEntities(value);
  }
  return attrs;
}

/** Parses an HTML fragment/document into a single root `<root>` element. */
export function parseHtml(html: string): GenericElement {
  const root = element('root');
  const stack: GenericElement[] = [root];
  const top = () => stack[stack.length - 1];

  let i = 0;
  const n = html.length;

  while (i < n) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      const chunk = html.slice(i);
      if (chunk) top().children.push(text(decodeEntities(chunk)));
      break;
    }
    if (lt > i) top().children.push(text(decodeEntities(html.slice(i, lt))));

    // Comments: <!-- ... -->
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end === -1 ? n : end + 3;
      continue;
    }
    // Doctype / other declarations: <!...>
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end === -1 ? n : end + 1;
      continue;
    }
    // Closing tag: </tag>
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt + 2);
      if (end === -1) {
        i = n;
        break;
      }
      const name = html.slice(lt + 2, end).trim().toLowerCase();
      // Pop back to the matching open tag, if any is still on the stack.
      const idx = stack.map(e => e.tag).lastIndexOf(name);
      if (idx > 0) stack.length = idx;
      i = end + 1;
      continue;
    }

    // Opening tag: <tag attr="value" ...> or <tag .../>
    const tagMatch = /^<([a-zA-Z][-a-zA-Z0-9]*)/.exec(html.slice(lt));
    if (!tagMatch) {
      // A bare '<' that isn't a real tag; treat as text and move on.
      top().children.push(text('<'));
      i = lt + 1;
      continue;
    }
    const tagName = tagMatch[1].toLowerCase();
    const tagEnd = html.indexOf('>', lt);
    if (tagEnd === -1) {
      i = n;
      break;
    }
    const rawTag = html.slice(lt + 1 + tagName.length, tagEnd);
    const selfClosing = /\/\s*$/.test(rawTag);
    const attrsRaw = rawTag.replace(/\/\s*$/, '');
    const attrs = parseAttrs(attrsRaw);
    const el = element(tagName, attrs);
    top().children.push(el);

    if (RAW_TEXT_TAGS.has(tagName)) {
      const closeTag = `</${tagName}`;
      const closeIdx = html.toLowerCase().indexOf(closeTag, tagEnd + 1);
      const rawEnd = closeIdx === -1 ? n : closeIdx;
      const raw = html.slice(tagEnd + 1, rawEnd);
      if (raw) el.children.push(text(raw));
      const afterClose = closeIdx === -1 ? n : html.indexOf('>', closeIdx);
      i = afterClose === -1 ? n : afterClose + 1;
      continue;
    }

    if (!selfClosing && !VOID_TAGS.has(tagName)) stack.push(el);
    i = tagEnd + 1;
  }

  return root;
}
