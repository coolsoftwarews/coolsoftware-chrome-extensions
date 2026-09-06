/**
 * Starter rule packs, by profession (PRD §10 open question, answered: "Ship
 * starter rule packs by profession... measure which get used"). Rule
 * authoring is the whole onboarding — most people will not invent good
 * keywords from a blank box, so the first thing the panel offers is one of
 * these, editable afterward like any other rule.
 */

import { Rule } from './types';

export interface StarterPack {
  id: string;
  label: string;
  description: string;
  rule: Pick<Rule, 'name' | 'matchPhrases' | 'topicWords' | 'ignoreWords'>;
}

const INTENT_PHRASES = [
  'looking for',
  'can anyone recommend',
  'does anyone know',
  'any recommendations for',
  'in need of',
  'who do you use for',
];

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'agency',
    label: 'Agency / marketing',
    description: 'Marketing, ads, branding and social media requests.',
    rule: {
      name: 'Agency leads',
      matchPhrases: [...INTENT_PHRASES],
      topicWords: [
        'marketing agency',
        'social media manager',
        'seo',
        'ads manager',
        'branding',
        'graphic designer',
        'copywriter',
      ],
      ignoreWords: ['free', 'intern', 'volunteer', 'hiring internally'],
    },
  },
  {
    id: 'bookkeeper',
    label: 'Bookkeeping / accounting',
    description: "The PRD's own example — bookkeepers, accountants, invoicing help.",
    rule: {
      name: 'Bookkeeping leads',
      matchPhrases: [...INTENT_PHRASES],
      topicWords: ['bookkeeper', 'accountant', 'invoicing', 'payroll', 'tax prep', 'cpa'],
      ignoreWords: ['free', 'intern'],
    },
  },
  {
    id: 'developer',
    label: 'Web / software developer',
    description: 'Websites, apps, and "my site is broken" posts.',
    rule: {
      name: 'Developer leads',
      matchPhrases: [...INTENT_PHRASES],
      topicWords: [
        'web developer',
        'website',
        'app developer',
        'shopify expert',
        'wordpress',
        'developer',
      ],
      ignoreWords: ['free', 'intern', 'volunteer', 'course', 'tutorial'],
    },
  },
  {
    id: 'photographer',
    label: 'Photography',
    description: 'Events, headshots, product and family shoots.',
    rule: {
      name: 'Photography leads',
      matchPhrases: [...INTENT_PHRASES],
      topicWords: ['photographer', 'headshots', 'photo shoot', 'wedding photographer', 'product photos'],
      ignoreWords: ['free', 'intern', 'model needed'],
    },
  },
];
