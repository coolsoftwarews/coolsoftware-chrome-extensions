/**
 * Filename builder, following the portfolio's shared convention (sanitize,
 * cap length, keep the extension after truncation - see WebHighlighter's
 * buildFilename and the frontend-specialist build memory).
 */

function sanitize(part: string): string {
  return part
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MAX_LENGTH = 120;

function capWithExtension(name: string, ext: string): string {
  const suffix = `.${ext}`;
  if (name.length + suffix.length <= MAX_LENGTH) return name + suffix;
  return name.slice(0, MAX_LENGTH - suffix.length) + suffix;
}

/** `{handle} - {first 60 chars of text}.png`, e.g. "@gabler - Antifragile things.png" */
export function buildCardFilename(handle: string, text: string): string {
  const handlePart = sanitize(handle || 'post');
  const textPart = sanitize(text).slice(0, 60);
  const base = textPart ? `${handlePart} - ${textPart}` : handlePart;
  return capWithExtension(base || 'x-card', 'png');
}

/** Sequential thread filenames (PRD S4 V1 decision - N separate PNGs, not a
 *  stacked image or a ZIP): "{handle} - thread - 2 of 5.png". */
export function buildThreadFilename(handle: string, index: number, total: number): string {
  const handlePart = sanitize(handle || 'thread');
  const base = `${handlePart} - thread - ${index} of ${total}`;
  return capWithExtension(base, 'png');
}
