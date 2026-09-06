/**
 * Client-side sorting over whatever comments are currently loaded. Pure,
 * stable, and null-safe: a comment whose sort field failed to parse (PRD §5)
 * sorts to the end rather than colliding at 0 with genuinely low values.
 */

import { Comment, SortMode } from './types';

function byNullableDesc(getValue: (c: Comment) => number | null) {
  return (a: Comment, b: Comment): number => {
    const av = getValue(a);
    const bv = getValue(b);
    if (av === null && bv === null) return a.domOrder - b.domOrder;
    if (av === null) return 1;
    if (bv === null) return -1;
    if (av !== bv) return bv - av;
    return a.domOrder - b.domOrder;
  };
}

export function sortComments(comments: Comment[], mode: SortMode): Comment[] {
  const copy = [...comments];
  switch (mode) {
    case 'top':
      // Preserves the order YouTube itself rendered them in — "top" per
      // whatever sort the user has selected on the page (PRD §4).
      return copy.sort((a, b) => a.domOrder - b.domOrder);
    case 'likes':
      return copy.sort(byNullableDesc(c => c.likeCount));
    case 'replies':
      return copy.sort(byNullableDesc(c => c.replyCount));
    case 'newest':
      return copy.sort(byNullableDesc(c => c.publishedAt));
    default:
      return copy;
  }
}
