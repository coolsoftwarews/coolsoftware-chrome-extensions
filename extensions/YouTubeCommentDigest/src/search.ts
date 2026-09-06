/** Keyword search across loaded comments — case-insensitive substring on author + body. */

import { Comment } from './types';

export function filterComments(comments: Comment[], query: string): Comment[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return comments;
  return comments.filter(c => {
    const haystack = `${c.author ?? ''} ${c.text}`.toLowerCase();
    return haystack.includes(needle);
  });
}
