/**
 * The three style templates (PRD S4). Plain data — no canvas, no DOM — so
 * layout.ts and render.ts both consume the same numbers and this file can
 * be imported by scripts/selftest.mjs with zero setup.
 */

import { TemplateConfig, TemplateId } from './types';

export const CARD_WIDTH = 640;

export const TEMPLATES: Record<TemplateId, TemplateConfig> = {
  light: {
    id: 'light',
    label: 'Light',
    background: '#ffffff',
    cardText: '#0f1419',
    mutedText: '#536471',
    accent: '#1d9bf0',
    showMetrics: true,
    maxLines: 10,
  },
  dark: {
    id: 'dark',
    label: 'Dark',
    background: '#15202b',
    cardText: '#f7f9f9',
    mutedText: '#8899a6',
    accent: '#1d9bf0',
    showMetrics: true,
    maxLines: 10,
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal',
    background: '#faf9f6',
    cardText: '#111111',
    mutedText: '#6b6b6b',
    accent: '#111111',
    // Minimal deliberately drops the metrics row for a clean pull-quote
    // look (PRD S4 - a fixed template property, not a per-export toggle).
    showMetrics: false,
    maxLines: 12,
  },
};

export const DEFAULT_TEMPLATE: TemplateId = 'light';

export function isTemplateId(value: unknown): value is TemplateId {
  return value === 'light' || value === 'dark' || value === 'minimal';
}

export const TEMPLATE_ORDER: TemplateId[] = ['light', 'dark', 'minimal'];
