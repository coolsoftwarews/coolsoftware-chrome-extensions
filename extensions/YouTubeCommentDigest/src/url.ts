/** True for a YouTube watch page — the only page type this panel has anything to show for. */
export function isWatchPage(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return false;
    return url.pathname === '/watch';
  } catch {
    return false;
  }
}
