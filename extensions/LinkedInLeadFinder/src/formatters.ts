/**
 * Export layer. CSV is the deliverable (PRD §4 — "it goes into a CRM or a
 * sequence tool"); Markdown is the readable second format. Both are pure
 * functions over Lead[] so they are fully covered by scripts/selftest.mjs —
 * no browser needed. Filenames follow the same convention as
 * WebHighlighter/YouTubeTranscription.
 */

import { seenOnCount } from './dedupe';
import { evaluateLead } from './rules';
import { Lead, Rule } from './types';

const MAX_FILENAME_LENGTH = 120;

function latestCapture(lead: Lead) {
  return [...lead.captures].sort((a, b) => b.collectedAt - a.collectedAt)[0];
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/* ── CSV ─────────────────────────────────────────────────────────────── */

/** RFC 4180: quote whenever the field contains a comma, quote or newline; double up internal quotes. */
export function csvCell(value: string | number | boolean | null): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

const CSV_COLUMNS = [
  'Name',
  'Headline',
  'Profile URL',
  'Type',
  'Status',
  'Qualified',
  'Matched Keywords',
  'Seen On (posts)',
  'Post URLs',
  'Latest Comment',
  'Latest Comment Date',
  'Latest Reaction Count',
  'Note',
  'First Collected',
  'Last Collected',
] as const;

export function toCsv(leads: Lead[], rules: Rule[]): string {
  const rows = [CSV_COLUMNS.join(',')];

  for (const lead of leads) {
    const { qualified, matchedKeywords } = evaluateLead(lead, rules);
    const latest = latestCapture(lead);
    const type = lead.isCompany ? 'Company' : lead.isAnonymized ? 'Anonymized' : 'Person';

    rows.push(
      [
        csvCell(lead.name),
        csvCell(lead.headline),
        csvCell(lead.profileUrl),
        csvCell(type),
        csvCell(lead.status),
        csvCell(qualified ? 'Yes' : 'No'),
        csvCell(matchedKeywords.join('; ')),
        csvCell(seenOnCount(lead)),
        csvCell(lead.captures.map(c => c.postUrl).join('; ')),
        csvCell(latest?.commentText ?? ''),
        csvCell(latest?.commentDate ?? ''),
        csvCell(latest?.reactionCount ?? ''),
        csvCell(lead.note),
        csvCell(isoDate(lead.firstCollectedAt)),
        csvCell(isoDate(lead.lastCollectedAt)),
      ].join(','),
    );
  }

  return rows.join('\r\n') + '\r\n';
}

/* ── Markdown ────────────────────────────────────────────────────────── */

export function toMarkdown(leads: Lead[], rules: Rule[]): string {
  if (!leads.length) return '# LinkedIn leads\n\nNothing collected yet.\n';

  const parts: string[] = [
    '# LinkedIn leads',
    '',
    `Exported ${isoDate(Date.now())} · ${leads.length} lead${leads.length === 1 ? '' : 's'}`,
    '',
  ];

  for (const lead of leads) {
    const { qualified, matchedKeywords } = evaluateLead(lead, rules);
    const seen = seenOnCount(lead);
    const type = lead.isCompany ? ' · Company page' : lead.isAnonymized ? ' · Anonymized' : '';

    parts.push(`## ${qualified ? '⭐ ' : ''}${lead.name}${type}`);
    if (lead.headline) parts.push(lead.headline);
    if (lead.profileUrl) parts.push(lead.profileUrl);
    parts.push('');
    parts.push(`**Status:** ${lead.status}  `);
    parts.push(`**Seen on ${seen} post${seen === 1 ? '' : 's'}**  `);
    if (qualified) parts.push(`**Matched:** ${matchedKeywords.join(', ')}  `);
    if (lead.note.trim()) parts.push(`**Note:** ${lead.note.trim()}  `);
    parts.push('');

    for (const capture of [...lead.captures].sort((a, b) => b.collectedAt - a.collectedAt)) {
      const reactions = capture.reactionCount === null ? '' : ` · ${capture.reactionCount} reaction${capture.reactionCount === 1 ? '' : 's'}`;
      parts.push(`> ${capture.commentText || '(no comment text captured)'}`);
      parts.push(`— ${capture.commentDate || 'undated'}${reactions} · [source](${capture.postUrl})`);
      parts.push('');
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}

/* ── Filenames ───────────────────────────────────────────────────────── */

function sanitizeStem(value: string): string {
  return Array.from(value)
    .filter(ch => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 32 && code !== 127;
    })
    .join('')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildFilename(prefix: string, ext: string, when = new Date()): string {
  const date = when.toISOString().slice(0, 10);
  let stem = sanitizeStem(`${prefix} ${date}`);
  const suffix = `.${ext}`;
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd();
  return stem + suffix;
}
