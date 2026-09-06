/**
 * Stable dedupe id for a captured post (PRD §7: "the same post reappearing in
 * the feed" and "posts can be identified stably enough to dedupe on
 * re-scroll"). Facebook's group feed exposes no reliable post id to a content
 * script, so the id is a hash of what should not change between two sightings
 * of the same post: the group, the author, and the first slice of the text.
 *
 * FNV-1a, not crypto.subtle — this only needs to be stable and fast, not
 * secure, and staying dependency-free keeps the bundle tiny.
 */

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(36);
}

/** The slice of text used for the id — long enough to disambiguate, short
 * enough that a caption typo added while the panel is open doesn't split the
 * id (PRD §7: "posts edited after capture" should not spawn a duplicate). */
const ID_TEXT_LENGTH = 160;

export function opportunityId(groupName: string, author: string, postText: string): string {
  const key = [
    groupName.trim().toLowerCase(),
    author.trim().toLowerCase(),
    postText.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, ID_TEXT_LENGTH),
  ].join('');
  return `fgo_${fnv1a(key)}`;
}
