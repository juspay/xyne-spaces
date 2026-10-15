import { Directory, File, Paths } from 'expo-file-system';

import {
  isHttpUrl,
  resolveProfilePictureRequestUrl,
  sanitizeCacheKey,
} from '@/src/components/ui/avatar/avatar.utils';
import { cacheMtlsRemoteFileByType } from '@/src/utils/mtlsDiskCache';

const AVATAR_CACHE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'] as const;

let avatarCacheDir: Directory | null = null;
const inflight = new Map<string, Promise<string | null>>();

function getAvatarCacheDir(): Directory {
  if (!avatarCacheDir) {
    avatarCacheDir = new Directory(Paths.cache, 'lotus-notification-avatars');
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

function readCachedAvatarUri(cacheKey: string): string | null {
  const baseName = sanitizeCacheKey(cacheKey);
  const dir = getAvatarCacheDir();

  for (const ext of AVATAR_CACHE_EXTENSIONS) {
    const file = new File(dir, `${baseName}.${ext}`);
    if (file.exists) {
      return file.uri;
    }
  }

  return null;
}

async function fetchProtectedAvatarUri(
  userId: string,
  picturePath: string,
): Promise<string | null> {
  const cacheKey = `${userId}:${picturePath}`;
  const cached = readCachedAvatarUri(cacheKey);
  if (cached) return cached;

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

/**
 * Resolve a sender avatar URI for iOS communication notifications.
 * Public URLs pass through; storage paths are fetched via mTLS and cached locally.
 */
export async function resolveNotificationAvatarUri(
  senderId: string | undefined,
  senderPicture: string | undefined,
): Promise<string | undefined> {
  const picture = senderPicture?.trim();
  if (!picture) return undefined;

  if (isHttpUrl(picture) || /^file:\/\//i.test(picture)) {
    return picture;
  }

  if (!senderId) return undefined;

  const localUri = await fetchProtectedAvatarUri(senderId, picture);
  return localUri ?? undefined;
}
