import { getYoutubeVideoId } from '../Chat/LinkPreview/youtubeUtils';

export type VideoEmbedProvider = 'youtube' | 'vimeo' | 'loom';

export interface VideoEmbed {
  provider: VideoEmbedProvider;
  embedUrl: string;
}

/**
 * Whether a URL is served by `host` itself, or its www form.
 *
 * Compared whole rather than by suffix: `endsWith('loom.com')` also accepts
 * `evil-loom.com`, which would put an attacker's page in the iframe.
 */
const hostIs = (url: URL, host: string): boolean => {
  const hostname = url.hostname.toLowerCase();
  return hostname === host || hostname === `www.${host}`;
};

/**
 * A watch page is not a video file, so <video src> cannot play one. Each service
 * publishes its own embeddable URL instead, and the shapes have nothing in
 * common — hence a table rather than a rule. Adding a service is one entry.
 */
const RULES: ReadonlyArray<{
  provider: VideoEmbedProvider;
  toEmbedUrl: (url: URL) => string | null;
}> = [
  {
    provider: 'youtube',
    toEmbedUrl: (url): string | null => {
      const shortsId = hostIs(url, 'youtube.com')
        ? /^\/shorts\/([a-zA-Z0-9_-]+)/.exec(url.pathname)?.[1]
        : undefined;
      const videoId = getYoutubeVideoId(url.href) ?? shortsId;
      if (!videoId) return null;

      const embed = new URL(`https://www.youtube.com/embed/${videoId}`);
      embed.searchParams.set('rel', '0');
      // Carried over so a link copied from a playlist still plays as one, and a
      // link copied mid-video still starts where the reader left it.
      const list = url.searchParams.get('list');
      if (list) embed.searchParams.set('list', list);
      const start = url.searchParams.get('t') ?? url.searchParams.get('start');
      if (start) {
        const seconds = /^\d+$/.test(start) ? start : /^(\d+)s$/.exec(start)?.[1];
        if (seconds) embed.searchParams.set('start', seconds);
      }
      return embed.href;
    },
  },
  {
    provider: 'vimeo',
    toEmbedUrl: (url): string | null => {
      if (!hostIs(url, 'vimeo.com')) return null;
      const videoId = /^\/(\d+)/.exec(url.pathname)?.[1];
      return videoId ? `https://player.vimeo.com/video/${videoId}` : null;
    },
  },
  {
    provider: 'loom',
    toEmbedUrl: (url): string | null => {
      if (!hostIs(url, 'loom.com')) return null;
      const videoId = /^\/share\/([a-zA-Z0-9]+)/.exec(url.pathname)?.[1];
      return videoId ? `https://www.loom.com/embed/${videoId}` : null;
    },
  },
];

/** The embeddable form of a video URL, or null when it is not one we can play. */
export function resolveVideoEmbed(rawUrl: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  for (const rule of RULES) {
    const embedUrl = rule.toEmbedUrl(url);
    if (embedUrl) return { provider: rule.provider, embedUrl };
  }
  return null;
}

export const isVideoEmbedUrl = (rawUrl: string): boolean => resolveVideoEmbed(rawUrl) !== null;
