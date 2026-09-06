/** Pulls a video id out of any YouTube watch/shorts/embed/live/youtu.be URL. */
export function extractVideoId(urlStr: string): string | null {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');

    if (host === 'youtube.com') {
      const v = url.searchParams.get('v');
      if (v) return v;
      const match = url.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
      if (match) return match[2];
    }

    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split(/[/?]/)[0];
      if (id) return id;
    }
  } catch {
    /* not a URL we understand */
  }
  return null;
}

export function isYouTubeUrl(urlStr: string | undefined | null): boolean {
  if (!urlStr) return false;
  try {
    const host = new URL(urlStr).hostname.replace(/^www\./, '').replace(/^m\./, '');
    return host === 'youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}
