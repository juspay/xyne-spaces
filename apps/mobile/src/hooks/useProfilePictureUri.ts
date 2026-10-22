import { useEffect, useMemo, useState } from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import { InteractionManager } from 'react-native';

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
      memoryCache.set(cacheKey, { uri, picturePath });
      CallNotificationDataModule.cacheCallerAvatar(userId, uri);
      return uri;
    }
  }

  return null;
}

async function fetchProtectedProfilePictureUri(
  userId: string,
  picturePath: string,
): Promise<string | null> {
  const cacheKey = `${userId}:${picturePath}`;
  const cached = memoryCache.get(cacheKey);
  if (cached?.picturePath === picturePath) {
    const cachedFile = new File(cached.uri);
    if (cachedFile.exists) {
      return cached.uri;
    }
    memoryCache.delete(cacheKey);
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

      memoryCache.set(cacheKey, { uri, picturePath });
      CallNotificationDataModule.cacheCallerAvatar(userId, uri);
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
    () => (!directUri && userId && trimmedPath ? `${userId}:${trimmedPath}` : null),
    [directUri, trimmedPath, userId],
  );

  const [fetchedAvatar, setFetchedAvatar] = useState<FetchedAvatarState>(() => {
    if (!requestKey || !trimmedPath) return { requestKey, uri: null };

    const cached = memoryCache.get(requestKey);
    if (cached?.picturePath === trimmedPath) {
      return { requestKey, uri: cached.uri };
    }

    return { requestKey, uri: null };
  });

  useEffect(() => {
    if (!requestKey || !trimmedPath) {
      setFetchedAvatar((current): FetchedAvatarState =>
        current.requestKey === requestKey && current.uri === null
          ? current
          : { requestKey, uri: null },
      );
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
  }, [requestKey, userId, trimmedPath]);

  const fetchedUri = fetchedAvatar.requestKey === requestKey ? fetchedAvatar.uri : null;
  return directUri ?? fetchedUri;
}
