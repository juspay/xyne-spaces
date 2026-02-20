/**
 * Extract YouTube video ID from common URL formats.
 * Supports: youtube.com/watch?v=ID, youtu.be/ID, youtube.com/embed/ID
 */
export function getYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');

    if (host === 'youtube.com' || host === 'youtu.be') {
      if (host === 'youtu.be') {
        const id = parsed.pathname.slice(1).split('/')[0];
        return id && !id.includes('?') ? id : null;
      }
      if (parsed.pathname === '/watch' && parsed.searchParams.has('v')) {
        return parsed.searchParams.get('v');
      }
      const embedMatch = parsed.pathname.match(/^\/embed\/([a-zA-Z0-9_-]+)/);
      const embedId = embedMatch?.[1];
      if (embedId) return embedId;
    }
    return null;
  } catch {
    return null;
  }
}

export function isYoutubeUrl(url: string): boolean {
  return getYoutubeVideoId(url) !== null;
}

export function getYoutubeEmbedUrl(videoId: string): string {
  return `https://www.youtube.com/embed/${videoId}?rel=0`;
}
