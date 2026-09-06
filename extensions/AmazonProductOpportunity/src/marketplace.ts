/**
 * The Amazon marketplaces this build supports — kept in sync by hand with the
 * `content_scripts.matches` / `host_permissions` arrays in scripts/build.mjs.
 * PRD §5 names .com, .co.uk and .de as the ones to verify first; the rest are
 * the same seller-facing storefronts on the same domain family, not a new
 * site, so listing them costs nothing extra in review scope.
 */
export const AMAZON_HOSTS = [
  'amazon.com',
  'amazon.co.uk',
  'amazon.de',
  'amazon.fr',
  'amazon.it',
  'amazon.es',
  'amazon.ca',
  'amazon.com.au',
  'amazon.co.jp',
  'amazon.in',
  'amazon.com.mx',
  'amazon.nl',
  'amazon.se',
  'amazon.pl',
  'amazon.com.br',
] as const;

export function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, '');
}

export function isAmazonHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return AMAZON_HOSTS.includes(host as (typeof AMAZON_HOSTS)[number]);
}
