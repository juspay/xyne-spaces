/**
 * useMtlsEmoji Hook for Lotus
 *
 * Loads custom emoji images using mTLS authentication by streaming bytes
 * to disk and returning a file:// URI.
 *
 * Same disk-first pattern as useMtlsImage but for the /emojis/:id/stream endpoint.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import { API_BASE_URL } from '@/src/config';
import { cacheMtlsRemoteFileByType } from '@/src/utils/mtlsDiskCache';

interface UseMtlsEmojiResult {
  uri: string | null;
  isLoading: boolean;
  error: Error | null;
}

const EMOJI_CACHE_EXTENSIONS = ['gif', 'webp', 'png', 'jpg', 'jpeg'] as const;
// The cache probe now shares this gate with the network fetch (previously
// only the network fetch was limited), so this covers both cheap disk checks
// and real downloads — raised slightly from 4 since disk checks are fast.
const MAX_CONCURRENT_EMOJI_FETCHES = 6;

// Shared in-flight deduplication across hook instances
const inflightRequests = new Map<string, Promise<string>>();
const queuedEmojiFetches: Array<() => void> = [];
let activeEmojiFetches = 0;
const DEFAULT_EMOJI_PREFETCH_CONCURRENCY = 3;

// Synchronous memory cache of already-resolved emojiId → file:// URI. Populated by
// getMtlsEmojiUri (on both cache-hit and fetch-success). Lets hooks seed their initial
// state on the FIRST render so an already-resolved emoji paints its image immediately
// instead of flashing a placeholder for a frame while the async effect runs.
//
// Bounded with a simple LRU (Map preserves insertion order; re-set on hit moves to newest)
// so a long session that renders many distinct emoji can't grow it without limit.
const RESOLVED_EMOJI_URI_CACHE_LIMIT = 512;
const resolvedEmojiUriCache = new Map<string, string>();
const emojiInvalidationListeners = new Set<(emojiId: string) => void>();

function rememberResolvedEmojiUri(emojiId: string, uri: string): void {
  if (resolvedEmojiUriCache.has(emojiId)) resolvedEmojiUriCache.delete(emojiId);
  resolvedEmojiUriCache.set(emojiId, uri);
  if (resolvedEmojiUriCache.size > RESOLVED_EMOJI_URI_CACHE_LIMIT) {
    const oldest = resolvedEmojiUriCache.keys().next().value;
    if (oldest !== undefined) resolvedEmojiUriCache.delete(oldest);
  }
}

/**
 * Synchronous lookup of an already-resolved emoji URI. Returns undefined if the emoji
 * has not been resolved yet this session (then the async path resolves it). Never does I/O.
 */
export function getResolvedEmojiUriSync(emojiId: string | undefined): string | undefined {
  if (!emojiId) return undefined;
  return resolvedEmojiUriCache.get(emojiId);
}

export function invalidateResolvedEmojiUri(
  emojiId: string | undefined,
  uri?: string | null | undefined,
): void {
  if (!emojiId) return;
  const cached = resolvedEmojiUriCache.get(emojiId);
  if (!cached) return;
  if (uri && cached !== uri) return;
  resolvedEmojiUriCache.delete(emojiId);
  inflightRequests.delete(emojiId);
  for (const listener of emojiInvalidationListeners) listener(emojiId);
}

/**
 * Clear the in-memory emoji caches and delete the on-disk emoji cache directory. Call on
 * sign-out so one user's custom emoji don't persist (RAM + FS) into the next session.
 */
export async function clearMtlsEmojiCache(): Promise<void> {
  resolvedEmojiUriCache.clear();
  inflightRequests.clear();
  const dir = new Directory(Paths.cache, 'emojis');
  emojiCacheDir = null;
  if (!dir.exists) return;
  try {
    dir.delete();
  } catch {
    // Best-effort; a leftover dir is re-validated per-file on next read.
  }
}

function seedResolvedEmojiUris(emojiIds: readonly string[]): Record<string, string> {
  const seed: Record<string, string> = {};
  for (const id of emojiIds) {
    const cached = resolvedEmojiUriCache.get(id);
    if (cached) seed[id] = cached;
  }
  return seed;
}

let emojiCacheDir: Directory | null = null;

/** Created once, not per lookup: every emoji cell on screen asks for it. */
function getEmojiCacheDir(): Directory {
  if (!emojiCacheDir) {
    emojiCacheDir = new Directory(Paths.cache, 'emojis');
    emojiCacheDir.create({ intermediates: true, idempotent: true });
  }
  return emojiCacheDir;
}

async function runWithEmojiFetchLimit<T>(task: () => Promise<T>): Promise<T> {
  if (activeEmojiFetches >= MAX_CONCURRENT_EMOJI_FETCHES) {
    await new Promise<void>(resolve => queuedEmojiFetches.push(resolve));
  }

  activeEmojiFetches += 1;
  try {
    return await task();
  } finally {
    activeEmojiFetches -= 1;
    queuedEmojiFetches.shift()?.();
  }
}

function extensionFromContentType(contentType: string | null): string {
  const ct = contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (ct === 'image/gif') return 'gif';
  if (ct === 'image/webp') return 'webp';
  if (ct === 'image/jpeg' || ct === 'image/jpg') return 'jpg';
  return 'png';
}

function findCachedEmojiPath(emojiId: string): string | null {
  const dir = getEmojiCacheDir();
  for (const ext of EMOJI_CACHE_EXTENSIONS) {
    const file = new File(dir, `${emojiId}.${ext}`);
    if (file.exists && file.size > 0) {
      return file.uri;
    }
  }
  return null;
}

function clearOtherEmojiCacheFiles(emojiId: string, keepExtension: string): void {
  const dir = getEmojiCacheDir();
  for (const ext of EMOJI_CACHE_EXTENSIONS) {
    if (ext === keepExtension) continue;
    const file = new File(dir, `${emojiId}.${ext}`);
    if (file.exists) {
      file.delete();
    }
  }
}

/**
 * Fetch (or read from cache) a custom emoji image and return a `file://` URI
 * pointing at the cached file. Throws on fetch / write failure.
 *
 * Used by `useMtlsEmoji` (single emoji) and `useMtlsEmojiUris` (many emojis,
 * e.g. resolving placeholders embedded in a message body).
 */
export async function getMtlsEmojiUri(emojiId: string): Promise<string> {
  if (!emojiId) throw new Error('emojiId required');

  const memo = resolvedEmojiUriCache.get(emojiId);
  if (memo) return memo;

  // Dedupe BEFORE queueing: two cells resolving the same emoji (a reaction
  // used on several messages, or a cell recycled back to an emoji already
  // in flight) share one queue slot instead of each taking their own.
  const existing = inflightRequests.get(emojiId);
  if (existing) return existing;

  // Cache probe and network fetch both go through the same concurrency gate
  // now — previously only the network fetch was queued, so the disk cache
  // check ran unbounded for every mounted cell and flooded the bridge with
  // dozens of concurrent FileSystem round trips during a fast scroll.
  const fetchPromise = runWithEmojiFetchLimit(async (): Promise<string> => {
    const cached = findCachedEmojiPath(emojiId);
    if (cached) {
      rememberResolvedEmojiUri(emojiId, cached);
      return cached;
    }

    const { uri, extension } = await cacheMtlsRemoteFileByType({
      url: `${API_BASE_URL}/emojis/${emojiId}/stream`,
      directory: getEmojiCacheDir(),
      baseName: emojiId,
      extensionFor: extensionFromContentType,
    });
    clearOtherEmojiCacheFiles(emojiId, extension);

    rememberResolvedEmojiUri(emojiId, uri);
    return uri;
  });

  inflightRequests.set(emojiId, fetchPromise);

  try {
    return await fetchPromise;
  } finally {
    inflightRequests.delete(emojiId);
  }
}

export async function prefetchMtlsEmojiUris(
  emojiIds: readonly string[],
  concurrency: number = DEFAULT_EMOJI_PREFETCH_CONCURRENCY,
): Promise<void> {
  const uniqueIds = Array.from(new Set(emojiIds.filter(Boolean)));
  if (uniqueIds.length === 0) return;

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(concurrency, uniqueIds.length));
  await Promise.all(
    Array.from({ length: workerCount }, async (): Promise<void> => {
      while (cursor < uniqueIds.length) {
        const id = uniqueIds[cursor];
        cursor += 1;
        if (!id) continue;
        try {
          await getMtlsEmojiUri(id);
        } catch {
          // Best-effort warmup. Row rendering keeps its existing fallback path.
        }
      }
    }),
  );
}

export function useMtlsEmoji(emojiId: string | undefined): UseMtlsEmojiResult {
  const [state, setState] = useState<{
    uri: string | null;
    isLoading: boolean;
    error: Error | null;
  }>(() => {
    const seeded = getResolvedEmojiUriSync(emojiId);
    return {
      uri: seeded ?? null,
      isLoading: !!emojiId && !seeded,
      error: null,
    };
  });

  const fetchEmoji = useCallback(async () => {
    if (!emojiId) {
      setState({ uri: null, isLoading: false, error: null });
      return;
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const uri = await getMtlsEmojiUri(emojiId);
      setState({ uri, isLoading: false, error: null });
    } catch (error) {
      setState({
        uri: null,
        isLoading: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [emojiId]);

  useEffect(() => {
    void fetchEmoji();
  }, [fetchEmoji]);

  useEffect(() => {
    if (!emojiId) return;
    const listener = (invalidatedEmojiId: string): void => {
      if (invalidatedEmojiId !== emojiId) return;
      setState(prev => (prev.uri === null && prev.isLoading ? prev : { ...prev, uri: null }));
      void fetchEmoji();
    };
    emojiInvalidationListeners.add(listener);
    return (): void => {
      emojiInvalidationListeners.delete(listener);
    };
  }, [emojiId, fetchEmoji]);

  return {
    uri: state.uri,
    isLoading: state.isLoading,
    error: state.error,
  };
}

/**
 * Resolve a list of emoji IDs to local `file://` URIs. Returns a map keyed by
 * emojiId with `string` (cached path), `null` (failed), or missing (still loading).
 *
 * Updates incrementally as each emoji resolves, so partial UIs paint as soon as
 * the first emoji is ready instead of waiting for the slowest one.
 */
export function useMtlsEmojiUris(emojiIds: readonly string[]): Record<string, string | null> {
  // Stable key: dedupe + sort so re-orderings don't trigger a re-fetch.
  const idsKey = useMemo(() => {
    if (!emojiIds.length) return '';
    return Array.from(new Set(emojiIds)).filter(Boolean).sort().join(',');
  }, [emojiIds]);

  // Seed synchronously from the resolved-URI memory cache so emoji already loaded this
  // session paint their image on the first frame (no placeholder flash on mount/recycle).
  const [uris, setUris] = useState<Record<string, string | null>>(() =>
    idsKey ? seedResolvedEmojiUris(idsKey.split(',')) : {},
  );

  useEffect(() => {
    if (!idsKey) {
      setUris(previous => (Object.keys(previous).length === 0 ? previous : {}));
      return;
    }
    let mounted = true;
    const ids = idsKey.split(',');

    // Re-seed on key change (recycled row pointing at a different emoji set).
    const seeded = seedResolvedEmojiUris(ids);
    if (Object.keys(seeded).length > 0) {
      setUris(prev => {
        let changed = false;
        for (const id of ids) {
          if (seeded[id] && prev[id] !== seeded[id]) {
            changed = true;
            break;
          }
        }
        return changed ? { ...prev, ...seeded } : prev;
      });
    }

    ids.forEach(id => {
      getMtlsEmojiUri(id)
        .then(uri => {
          if (mounted) setUris(prev => (prev[id] === uri ? prev : { ...prev, [id]: uri }));
        })
        .catch(() => {
          if (mounted) setUris(prev => (prev[id] === null ? prev : { ...prev, [id]: null }));
        });
    });

    const listener = (invalidatedEmojiId: string): void => {
      if (!ids.includes(invalidatedEmojiId)) return;
      setUris(prev => {
        if (!(invalidatedEmojiId in prev)) return prev;
        const next = { ...prev };
        delete next[invalidatedEmojiId];
        return next;
      });
      getMtlsEmojiUri(invalidatedEmojiId)
        .then(uri => {
          if (mounted) {
            setUris(prev =>
              prev[invalidatedEmojiId] === uri ? prev : { ...prev, [invalidatedEmojiId]: uri },
            );
          }
        })
        .catch(() => {
          if (mounted) {
            setUris(prev =>
              prev[invalidatedEmojiId] === null ? prev : { ...prev, [invalidatedEmojiId]: null },
            );
          }
        });
    };
    emojiInvalidationListeners.add(listener);

    return (): void => {
      mounted = false;
      emojiInvalidationListeners.delete(listener);
    };
  }, [idsKey]);

  return uris;
}
