import { useEffect, useMemo, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { InteractionManager } from 'react-native';
import { createMMKV } from 'react-native-mmkv';

import {
  isHttpUrl,
  resolveProfilePictureRequestUrl,
  sanitizeCacheKey,
} from '@/src/components/ui/avatar/avatar.utils';
import CallNotificationDataModule from '@/src/modules/CallNotificationDataModule';
import { cacheMtlsRemoteFileByType } from '@/src/utils/mtlsDiskCache';

type CacheEntry = {
  uri: string;
  picturePath: string;
};

type FetchedAvatarState = {
  requestKey: string | null;
  uri: string | null;
};

const memoryCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

const AVATAR_CACHE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

/**
 * Where each avatar ended up on disk: `${userId}:${picturePath}` -> `file://…`.
 *
 * Its own MMKV store rather than `lotusStorage`. This is an index over the
 * avatar file cache, so it should live and die with those files rather than on
 * the general cache store's schedule, and `lotusStorage` resolves a
 * non-handoff read through the cache store and then the App Group store —
 * work this path would pay on every row of a scrolling list.
 *
 * MMKV is memory-mapped and synchronous, which is the entire point: a list can
 * ask for fifty of these inside one frame without touching the filesystem.
 */
const avatarIndex = createMMKV({ id: 'lotus-avatars' });

let avatarCacheDir: Directory | null = null;

function getAvatarCacheDir(): Directory {
  if (!avatarCacheDir) {
    avatarCacheDir = new Directory(Paths.cache, 'lotus-avatars');
    avatarCacheDir.create({ intermediates: true, idempotent: true });
  }
  return avatarCacheDir;
}

function guessExtension(picturePath: string, contentType?: string): string {
  const lowerPath = picturePath.toLowerCase();
  if (lowerPath.endsWith('.png')) return 'png';
  if (lowerPath.endsWith('.webp')) return 'webp';
  if (lowerPath.endsWith('.gif')) return 'gif';
  if (lowerPath.endsWith('.jpeg') || lowerPath.endsWith('.jpg')) return 'jpg';

  const ct = contentType?.toLowerCase() ?? '';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  return 'jpg';
}

function cacheKeyFor(userId: string, picturePath: string): string {
  return `${userId}:${picturePath}`;
}

/** Records a resolved location everywhere that can answer for it later. */
function rememberAvatarUri(
  userId: string,
  cacheKey: string,
  picturePath: string,
  uri: string,
): void {
  memoryCache.set(cacheKey, { uri, picturePath });
  avatarIndex.set(cacheKey, uri);
  CallNotificationDataModule.cacheCallerAvatar(userId, uri);
}

/**
 * Forgets a resolved location, so the next request re-finds or re-downloads it.
 *
 * The index is trusted without checking the file is still there — see
 * `readKnownAvatarUri` — so this is how an evicted file gets noticed. Callers
 * are whoever discovers the URI no longer loads, which in practice is the
 * avatar's own image error handler.
 */
export function forgetProfilePictureUri(
  userId: string,
  picturePath: string | null | undefined,
): void {
  const trimmedPath = picturePath?.trim();
  if (!userId || !trimmedPath) return;

  const cacheKey = cacheKeyFor(userId, trimmedPath);
  memoryCache.delete(cacheKey);
  avatarIndex.remove(cacheKey);
}

/**
 * The location of an already-resolved avatar, without touching the filesystem.
 *
 * Deliberately does not confirm the file exists. `File.exists` is a blocking
 * native call in expo-file-system, and a list mounting a screenful of avatars
 * while it scrolls cannot afford one per row — which is the cost this index
 * exists to remove. A file that has since been evicted fails to load instead,
 * and `forgetProfilePictureUri` drops it then.
 *
 * Safe to call while rendering: the only thing it writes is a memoisation of
 * what the index already said, so a render React discards changes nothing.
 */
function readKnownAvatarUri(cacheKey: string, picturePath: string): string | null {
  const inMemory = memoryCache.get(cacheKey);
  if (inMemory?.picturePath === picturePath) {
    return inMemory.uri;
  }

  const indexed = avatarIndex.getString(cacheKey);
  if (indexed) {
    memoryCache.set(cacheKey, { uri: indexed, picturePath });
    return indexed;
  }

  return null;
}

/**
 * Finds an avatar already on disk by trying each extension it could have been
 * saved under.
 *
 * Up to five blocking stats, which is why its answer goes into the index: this
 * now runs at most once per avatar per install, rather than once per avatar
 * per app launch.
 */
function readCachedAvatarUriFromDisk(
  userId: string,
  cacheKey: string,
  picturePath: string,
): string | null {
  const baseName = sanitizeCacheKey(cacheKey);
  const dir = getAvatarCacheDir();

  for (const ext of AVATAR_CACHE_EXTENSIONS) {
    const file = new File(dir, `${baseName}.${ext}`);
    if (file.exists) {
      const uri = file.uri;
      rememberAvatarUri(userId, cacheKey, picturePath, uri);
      return uri;
    }
  }

  return null;
}

async function fetchProtectedProfilePictureUri(
  userId: string,
  picturePath: string,
): Promise<string | null> {
  const cacheKey = cacheKeyFor(userId, picturePath);

  const known = readKnownAvatarUri(cacheKey, picturePath);
  if (known) {
    return known;
  }

  const diskUri = readCachedAvatarUriFromDisk(userId, cacheKey, picturePath);
  if (diskUri) {
    return diskUri;
  }

  const existing = inflight.get(cacheKey);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const { uri } = await cacheMtlsRemoteFileByType({
        url: resolveProfilePictureRequestUrl(userId, picturePath),
        directory: getAvatarCacheDir(),
        baseName: sanitizeCacheKey(cacheKey),
        extensionFor: mimeType => guessExtension(picturePath, mimeType ?? undefined),
      });

      rememberAvatarUri(userId, cacheKey, picturePath, uri);
      return uri;
    } catch {
      return null;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
}

export function useProfilePictureUri(
  userId: string,
  picturePath: string | null | undefined,
): string | null {
  const trimmedPath = picturePath?.trim() || null;

  const directUri = useMemo(() => {
    if (!trimmedPath) return null;
    if (isHttpUrl(trimmedPath) || /^file:\/\//i.test(trimmedPath)) {
      return trimmedPath;
    }
    return null;
  }, [trimmedPath]);

  const requestKey = useMemo(
    () => (!directUri && userId && trimmedPath ? cacheKeyFor(userId, trimmedPath) : null),
    [directUri, trimmedPath, userId],
  );

  /**
   * An avatar resolved on some earlier launch, available during this render.
   *
   * This is the line that matters for a scrolling list. Before, every resolved
   * avatar still arrived through an effect and a `setState`, so each row that
   * came into view rendered twice and probed the filesystem in between — a few
   * milliseconds of blocking work per row, several rows per frame. A
   * synchronous index read makes a known avatar part of the first render, and
   * leaves the asynchronous path for the ones genuinely not resolved yet.
   */
  const knownUri = useMemo(
    () => (requestKey && trimmedPath ? readKnownAvatarUri(requestKey, trimmedPath) : null),
    [requestKey, trimmedPath],
  );

  const [fetchedAvatar, setFetchedAvatar] = useState<FetchedAvatarState>({
    requestKey: null,
    uri: null,
  });

  useEffect(() => {
    // Either there is nothing protected to resolve, or the index already
    // answered. Both mean no filesystem and no state transition.
    if (!requestKey || !trimmedPath || knownUri) {
      return;
    }

    let cancelled = false;

    const hydrationTask = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;

      void fetchProtectedProfilePictureUri(userId, trimmedPath)
        .then(nextUri => {
          if (!cancelled) {
            setFetchedAvatar({ requestKey, uri: nextUri });
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFetchedAvatar({ requestKey, uri: null });
          }
        });
    });

    return (): void => {
      cancelled = true;
      hydrationTask.cancel();
    };
  }, [knownUri, requestKey, userId, trimmedPath]);

  const fetchedUri = fetchedAvatar.requestKey === requestKey ? fetchedAvatar.uri : null;
  return directUri ?? knownUri ?? fetchedUri;
}
