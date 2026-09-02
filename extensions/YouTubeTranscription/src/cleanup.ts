/**
 * Making auto-captions readable.
 *
 * YouTube's automatic captions arrive as a stream of lowercase fragments with
 * no sentence punctuation, and its manual ones are often littered with the `>>`
 * markers broadcast captioners use for a change of speaker. Pasted into a
 * document either way, the result reads like a transcript of a transcript.
 *
 * Everything here is deliberately conservative. The rule is: only change what
 * is unambiguous. A cleanup that guesses wrong puts words in someone's mouth,
 * which is far worse than leaving a lowercase "i" alone.
 */

/**
 * `>>` and `>>>` at the start of a fragment mean "new speaker".
 *
 * Kept as an em dash rather than deleted outright: the speaker really did
 * change, and silently running two people's sentences together is a
 * misquotation waiting to happen.
 */
const SPEAKER = /(^|\s)>>+\s*/g;

/** Caption tracks carry these for non-speech audio. Not speech, so not prose. */
const SOUND_CUE = /\[(music|applause|laughter|inaudible|silence)\]/gi;

export interface CleanupOptions {
  /** Turn `>>` into a speaker break rather than dropping it. */
  markSpeakers?: boolean;
  /** Drop [Music], [Applause] and friends. */
  dropSoundCues?: boolean;
}

/**
 * Tidy one caption line.
 *
 * Capitalisation is applied at sentence starts only — after `.`, `?`, `!`, or
 * at the beginning — and the standalone pronoun "i" is raised, because those
 * are the two cases with no false positives. Nothing else is touched: no
 * invented punctuation, no guessed proper nouns.
 */
export function cleanLine(text: string, options: CleanupOptions = {}): string {
  return finishText(cleanFragment(text, options));
}

/**
 * The half that must happen while a caption fragment is still its own line:
 * speaker markers, sound cues, whitespace.
 *
 * `>>` only means "new speaker" where it appears, and once fragments are merged
 * into a paragraph that position is gone.
 */
export function cleanFragment(text: string, options: CleanupOptions = {}): string {
  const { markSpeakers = true, dropSoundCues = false } = options;

  let out = text;

  if (dropSoundCues) out = out.replace(SOUND_CUE, ' ');

  out = out.replace(SPEAKER, (_match, lead: string) => (markSpeakers ? `${lead}— ` : lead));

  // Collapse the whitespace the substitutions above leave behind.
  out = out.replace(/\s+/g, ' ').trim();

  // A leading dash with nothing before it is a speaker break at the very start
  // of a line, which says nothing — the line break already said it.
  return out.replace(/^—\s*/, '');
}

/**
 * The half that must wait until the text is whole: sentence casing.
 *
 * Applied per fragment, this was the bug that made exports read like ransom
 * notes — "trying to figure out what will Work for me" — because every caption
 * fragment starts mid-sentence and each one got a capital. A sentence starts
 * after a full stop, not after an arbitrary two-second boundary in the caption
 * track, so this runs once the fragments have been joined.
 */
export function finishText(text: string): string {
  return raiseSentenceStarts(text).replace(/\bi\b/g, 'I');
}

function raiseSentenceStarts(text: string): string {
  let out = '';
  let expectCapital = true;

  for (const ch of text) {
    if (expectCapital && /[a-z]/.test(ch)) {
      out += ch.toUpperCase();
      expectCapital = false;
      continue;
    }
    // A letter or digit means we are inside a sentence again.
    if (/[a-z0-9]/i.test(ch)) expectCapital = false;
    if (/[.!?]/.test(ch)) expectCapital = true;
    out += ch;
  }

  return out;
}

/** Phase one over a whole transcript, before the fragments are grouped. */
export function cleanSegments<T extends { text: string }>(
  segments: T[],
  options: CleanupOptions = {},
): T[] {
  return segments
    .map(segment => ({ ...segment, text: cleanFragment(segment.text, options) }))
    .filter(segment => segment.text !== '');
}

/** Phase two, once the lines are whatever length they are going to be. */
export function finishSegments<T extends { text: string }>(segments: T[]): T[] {
  return segments.map(segment => ({ ...segment, text: finishText(segment.text) }));
}
