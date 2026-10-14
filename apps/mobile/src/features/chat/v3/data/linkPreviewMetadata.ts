import type { LinkPreview } from '../model/chatRow.types';
import { apiPost } from '@/src/services/apiClient';

export type LinkPreviewMetadata = {
  url: string;
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
  favicon?: string;
};

export type LinkPreviewMetadataResponse = {
  success: boolean;
  data?: LinkPreviewMetadata;
};

type Listener = () => void;

const MAX_CACHE_ENTRIES = 256;
const metadataCache = new Map<string, LinkPreview>();
const metadataInflight = new Map<string, Promise<LinkPreview | null>>();
const listenersByUrl = new Map<string, Set<Listener>>();

const nonEmpty = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const notify = (url: string): void => {
  listenersByUrl.get(url)?.forEach(listener => listener());
};

const cacheAt = (url: string, preview: LinkPreview): void => {
  metadataCache.delete(url);
  metadataCache.set(url, preview);
  while (metadataCache.size > MAX_CACHE_ENTRIES) {
    const oldestUrl = metadataCache.keys().next().value;
    if (oldestUrl === undefined) {
      return;
    }
    metadataCache.delete(oldestUrl);
  }
};

const cache = (preview: LinkPreview): void => cacheAt(preview.url, preview);

const mergeMetadata = (
  preview: LinkPreview,
  metadata: LinkPreviewMetadata | undefined,
): LinkPreview | null => {
  const values: Partial<LinkPreviewMetadata> = metadata ?? {};
  const url = nonEmpty(values.url);
  if (!url || !/^https?:\/\//i.test(url)) {
    return null;
  }

  let host = preview.host;
  try {
    host = new URL(url).hostname.replace(/^www\./i, '');
  } catch {
    return null;
  }

  return {
    ...preview,
    url,
    host,
    title: nonEmpty(values.title) ?? preview.title,
    description: nonEmpty(values.description) ?? preview.description,
    siteName: nonEmpty(values.siteName) ?? preview.siteName,
    image: nonEmpty(values.image) ?? preview.image,
    favicon: nonEmpty(values.favicon) ?? preview.favicon,
    needsMetadataFetch: false,
    source: 'metadata',
    status: 'ready',
  };
};

export const getResolvedLinkPreview = (preview: LinkPreview): LinkPreview => {
  const cached = metadataCache.get(preview.url);
  return cached ?? preview;
};

export const subscribeToLinkPreview = (url: string, listener: Listener): (() => void) => {
  const listeners = listenersByUrl.get(url) ?? new Set<Listener>();
  listeners.add(listener);
  listenersByUrl.set(url, listeners);

  return (): void => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      listenersByUrl.delete(url);
    }
  };
};

export const loadLinkPreviewMetadata = (preview: LinkPreview): Promise<LinkPreview | null> => {
  const cached = metadataCache.get(preview.url);
  if (cached) {
    return Promise.resolve(cached);
  }

  const inflight = metadataInflight.get(preview.url);
  if (inflight) {
    return inflight;
  }

  const request = apiPost<LinkPreviewMetadataResponse>('/link-preview', { url: preview.url })
    .then(response => {
      const resolved = response.success ? mergeMetadata(preview, response.data) : null;
      // Keep failed requests uncached, matching V2: a later mount may retry
      // metadata resolution while the row still renders its local fallback.
      if (resolved) {
        cache(resolved);
        // The API may canonicalize the URL (for example by removing tracking
        // parameters). Keep the request URL as an alias so the mounted row's
        // subscription can observe the resolved preview on the next snapshot.
        if (resolved.url !== preview.url) {
          cacheAt(preview.url, resolved);
        }
      }
      notify(preview.url);
      return resolved;
    })
    .catch(() => {
      notify(preview.url);
      return null;
    })
    .finally(() => {
      metadataInflight.delete(preview.url);
    });

  metadataInflight.set(preview.url, request);
  return request;
};
