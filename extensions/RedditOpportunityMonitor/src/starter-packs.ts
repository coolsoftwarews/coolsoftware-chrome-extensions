/**
 * Starter rule packs, one per row of the PRD's target-user table (§3): SaaS
 * founders, freelancers/agencies, marketers, indie hackers. "A blank rule box
 * is where retention dies" (PRD §10) — the first thing the panel offers is
 * one of these, editable afterward like any other rule.
 */

import { Rule } from './types';

export interface StarterPack {
  id: string;
  label: string;
  description: string;
  rules: Array<Pick<Rule, 'name' | 'matchPhrases' | 'topicWords'> & Partial<Pick<Rule, 'ignoreWords'>>>;
}

/** The PRD's own example set (§4), reused across every pack — these are how
 * Reddit actually phrases a request, not a guess. */
const INTENT_PHRASES = [
  'looking for',
  'recommend',
  'any alternative to',
  'how do you handle',
  'what do you use for',
  'anyone know a good',
];

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'saas-founder',
    label: 'SaaS founder',
    description: "The PRD's own example — invoicing, time tracking, freelance tooling.",
    rules: [
      {
        name: 'Invoicing tool',
        matchPhrases: [...INTENT_PHRASES],
        topicWords: ['invoicing', 'billing software', 'invoice template'],
        ignoreWords: ['free only'],
      },
      {
        name: 'Time tracking',
        matchPhrases: [...INTENT_PHRASES],
        topicWords: ['time tracking', 'timesheet', 'track my hours'],
        ignoreWords: ['free only'],
      },
    ],
  },
  {
    id: 'freelancer-agency',
    label: 'Freelancer / agency',
    description: '"Can anyone recommend a…" threads for hired help.',
    rules: [
      {
        name: 'Freelance hire',
        matchPhrases: ['looking for', 'can anyone recommend', 'hiring a', 'in need of'],
        topicWords: ['freelance developer', 'freelance designer', 'copywriter', 'virtual assistant'],
        ignoreWords: ['unpaid', 'volunteer'],
      },
      {
        name: 'Client tools',
        matchPhrases: [...INTENT_PHRASES],
        topicWords: ['client management', 'proposal software', 'contract template'],
      },
    ],
  },
  {
    id: 'marketer',
    label: 'Marketer',
    description: 'How a market talks about the tools it uses.',
    rules: [
      {
        name: 'Marketing tool',
        matchPhrases: ['what do you use for', 'best tool for', 'recommend', 'any alternative to'],
        topicWords: ['social media scheduling', 'email marketing', 'analytics tool', 'seo tool'],
      },
      {
        name: 'Ad platform',
        matchPhrases: [...INTENT_PHRASES],
        topicWords: ['ad spend', 'ad platform', 'landing page builder'],
      },
    ],
  },
  {
    id: 'indie-hacker',
    label: 'Indie hacker',
    description: 'Validate a problem before building it.',
    rules: [
      {
        name: 'Build vs buy',
        matchPhrases: ['looking for', 'any alternative to', 'how do you validate', 'what do you use for'],
        topicWords: ['landing page builder', 'payments integration', 'no-code tool'],
      },
      {
        name: 'Solo founder pain',
        matchPhrases: ['how do you handle', 'looking for', 'recommend'],
        topicWords: ['solo founder', 'side project', 'mvp tool'],
      },
    ],
  },
];
