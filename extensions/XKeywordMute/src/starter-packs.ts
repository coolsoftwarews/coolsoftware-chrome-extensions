/**
 * Bundled starter filter packs (PRD §4/§10). Static JSON-shaped data baked
 * into the extension at build time — **never fetched from a server, never
 * updated over the network**. A new pack ships in a new extension version,
 * exactly like any other bundled asset; that constraint is the whole reason
 * this file exists instead of a "browse community packs" fetch call.
 */

import { StarterPack } from './types';

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'spoilers',
    label: 'Spoilers (general)',
    description: 'Common spoiler-adjacent phrasing for shows, movies, games and season finales.',
    rules: [
      { value: 'spoiler', mode: 'whole-word', caseSensitive: false },
      { value: 'spoilers', mode: 'whole-word', caseSensitive: false },
      { value: 'no spoilers', mode: 'substring', caseSensitive: false },
      { value: 'season finale', mode: 'substring', caseSensitive: false },
      { value: 'series finale', mode: 'substring', caseSensitive: false },
      { value: 'plot twist', mode: 'substring', caseSensitive: false },
      { value: 'they die', mode: 'substring', caseSensitive: false },
      { value: 'dies at the end', mode: 'substring', caseSensitive: false },
    ],
  },
  {
    id: 'politics',
    label: 'Politics',
    description: 'Broad political-discourse terms — a blunt instrument, by design, for a full break.',
    rules: [
      { value: 'election', mode: 'whole-word', caseSensitive: false },
      { value: 'senator', mode: 'whole-word', caseSensitive: false },
      { value: 'congress', mode: 'whole-word', caseSensitive: false },
      { value: 'president', mode: 'whole-word', caseSensitive: false },
      { value: 'poll', mode: 'whole-word', caseSensitive: false },
      { value: 'ballot', mode: 'whole-word', caseSensitive: false },
      { value: 'republican', mode: 'whole-word', caseSensitive: false },
      { value: 'democrat', mode: 'whole-word', caseSensitive: false },
    ],
  },
  {
    id: 'crypto-spam',
    label: 'Crypto & NFT spam',
    description: 'The recurring "airdrop / giveaway / presale" pattern crypto spam accounts run.',
    rules: [
      { value: 'airdrop', mode: 'whole-word', caseSensitive: false },
      { value: 'presale', mode: 'whole-word', caseSensitive: false },
      { value: '\\bnfts?\\b', mode: 'regex', caseSensitive: false },
      { value: 'to the moon', mode: 'substring', caseSensitive: false },
      { value: 'giveaway', mode: 'whole-word', caseSensitive: false },
      { value: 'whitelist spot', mode: 'substring', caseSensitive: false },
      { value: 'defi', mode: 'whole-word', caseSensitive: false },
      { value: '100x gem', mode: 'substring', caseSensitive: false },
    ],
  },
  {
    id: 'engagement-bait',
    label: 'Engagement bait',
    description: 'The "reply guy" phrasing designed to farm replies rather than say anything.',
    rules: [
      { value: 'unpopular opinion', mode: 'substring', caseSensitive: false },
      { value: 'hot take', mode: 'substring', caseSensitive: false },
      { value: "here's why", mode: 'substring', caseSensitive: false },
      { value: 'nobody talks about this', mode: 'substring', caseSensitive: false },
      { value: 'rt if', mode: 'substring', caseSensitive: false },
      { value: 'thread 🧵', mode: 'substring', caseSensitive: false },
    ],
  },
];
