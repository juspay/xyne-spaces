import { useEffect, useSyncExternalStore } from 'react';
import { Directory, File, Paths } from 'expo-file-system';

import { API_BASE_URL } from '@/src/config';
import {
  cacheMtlsRemoteFile,
  discardCachedFile,
  isPermanentDownloadMiss,
} from '@/src/utils/mtlsDiskCache';
import { buildAttachmentResourceUrl, isValidAttachmentId } from '@/src/hooks/attachmentCachePolicy';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';

export type MediaPreviewKind = 'image' | 'video';

export type MediaPreviewRequest = {
  attachmentId: string;
  kind: MediaPreviewKind;
};

type MediaPreviewSnapshot = {
  uri: string | null;
  isLoading: boolean;
  error: Error | null;
};

const EMPTY_PREVIEW_SNAPSHOT: MediaPreviewSnapshot = {
  uri: null,
  isLoading: false,
  error: null,
};

const MAX_CONCURRENT_PREVIEWS = 3;
const snapshots = new Map<string, MediaPreviewSnapshot>();
const snapshotGenerations = new Map<string, number>();
const listenersByKey = new Map<string, Set<() => void>>();
const queuedKeys = new Set<string>();
const inflightRequestIds = new Map<string, number>();

type QueuedMediaPreviewRequest = MediaPreviewRequest & {
  generation: number;
  requestId: number;
};

const queue: QueuedMediaPreviewRequest[] = [];
const activeRequestIds = new Set<number>();
let nextRequestId = 0;

const getPreviewKey = (attachmentId: string, kind: MediaPreviewKind): string =>
  `${kind}:${attachmentId}`;

/** Each session gets its own folder, so a late write can never land in the next session's cache. */
const getPreviewFile = (attachmentId: string, kind: MediaPreviewKind, generation: number): File => {
  const directory = kind === 'video' ? 'thumbnails' : 'images';
  return new File(Paths.cache, `${directory}/g${generation}/${attachmentId}.jpg`);
};

// Match dashboard MessageAttachment: images use /download (there is no server thumb).
// Videos use /thumbnail only when the backend actually has one.
const getPreviewUrl = (attachmentId: string, kind: MediaPreviewKind): string => {
  const path = kind === 'video' ? 'thumbnail' : 'download';
  return buildAttachmentResourceUrl(API_BASE_URL, attachmentId, path);
};

const emit = (key: string): void => {
  const listeners = listenersByKey.get(key);
  if (!listeners) return;
  for (const listener of listeners) listener();
};

const setSnapshot = (
  key: string,
  snapshot: MediaPreviewSnapshot,
  generation = getAuthSessionGeneration(),
): void => {
  snapshots.set(key, snapshot);
  snapshotGenerations.set(key, generation);
  emit(key);
};

export const invalidateMediaPreview = (
  attachmentId: string | null | undefined,
  kind: MediaPreviewKind | null | undefined,
  uri?: string | null | undefined,
): void => {
  if (!attachmentId || !kind) return;
  const key = getPreviewKey(attachmentId, kind);
  const snapshot = snapshots.get(key);
  if (!snapshot?.uri) return;
  if (uri && snapshot.uri !== uri) return;
  snapshots.delete(key);
  snapshotGenerations.delete(key);
  queuedKeys.delete(key);
  inflightRequestIds.delete(key);
  emit(key);
  prefetchMediaPreview({ attachmentId, kind });
};

/**
 * Clear the in-memory media-preview snapshots and queue state, and delete the on-disk
 * thumbnail/image cache directories. Call on sign-out so one user's media doesn't persist
 * (RAM + FS) into the next session. Module-level Maps otherwise grow for the process lifetime.
 */
export const clearMediaPreviewCache = async (): Promise<void> => {
  snapshots.clear();
  snapshotGenerations.clear();
  queuedKeys.clear();
  inflightRequestIds.clear();
  queue.length = 0;
  activeRequestIds.clear();
  for (const name of ['thumbnails', 'images'] as const) {
    const dir = new Directory(Paths.cache, name);
    if (!dir.exists) continue;
    try {
      dir.delete();
    } catch {
      // Best-effort sign-out cleanup.
    }
  }
};

const fetchPreview = async (
  { attachmentId, kind }: MediaPreviewRequest,
  generation: number,
): Promise<string> => {
  if (!isValidAttachmentId(attachmentId)) {
    throw new Error('Invalid attachment id');
  }
  if (getAuthSessionGeneration() !== generation) {
    throw new Error('Attachment download is no longer valid for this session.');
  }
  const localPath = getPreviewFile(attachmentId, kind, generation).uri;
  const uri = await cacheMtlsRemoteFile({ url: getPreviewUrl(attachmentId, kind), localPath });
  if (getAuthSessionGeneration() !== generation) {
    discardCachedFile(uri);
    throw new Error('Attachment download is no longer valid for this session.');
  }
  return uri;
};

const drainQueue = (): void => {
  while (activeRequestIds.size < MAX_CONCURRENT_PREVIEWS && queue.length > 0) {
    const request = queue.shift();
    if (!request) return;

    const key = getPreviewKey(request.attachmentId, request.kind);
    queuedKeys.delete(key);
    if (getAuthSessionGeneration() !== request.generation) {
      continue;
    }
    activeRequestIds.add(request.requestId);
    inflightRequestIds.set(key, request.requestId);
    setSnapshot(
      key,
      { uri: snapshots.get(key)?.uri ?? null, isLoading: true, error: null },
      request.generation,
    );

    const ownsCompletion = (): boolean =>
      getAuthSessionGeneration() === request.generation &&
      inflightRequestIds.get(key) === request.requestId;

    void fetchPreview(request, request.generation)
      .then(uri => {
        if (!ownsCompletion()) return;
        setSnapshot(key, { uri, isLoading: false, error: null }, request.generation);
      })
      .catch(error => {
        if (!ownsCompletion()) return;
        setSnapshot(
          key,
          {
            uri: null,
            isLoading: false,
            error: error instanceof Error ? error : new Error(String(error)),
          },
          request.generation,
        );
      })
      .finally(() => {
        activeRequestIds.delete(request.requestId);
        if (inflightRequestIds.get(key) === request.requestId) {
          inflightRequestIds.delete(key);
        }
        drainQueue();
      });
  }
};

export const prefetchMediaPreview = (request: MediaPreviewRequest | null | undefined): void => {
  if (!request?.attachmentId || !isValidAttachmentId(request.attachmentId)) return;

  const generation = getAuthSessionGeneration();
  const key = getPreviewKey(request.attachmentId, request.kind);
  if (queuedKeys.has(key)) {
    const hasCurrentQueuedRequest = queue.some(
      queuedRequest =>
        getPreviewKey(queuedRequest.attachmentId, queuedRequest.kind) === key &&
        queuedRequest.generation === generation,
    );
    if (!hasCurrentQueuedRequest) {
      for (let index = queue.length - 1; index >= 0; index -= 1) {
        const queuedRequest = queue[index];
        if (!queuedRequest) continue;
        if (
          getPreviewKey(queuedRequest.attachmentId, queuedRequest.kind) === key &&
          queuedRequest.generation !== generation
        ) {
          queue.splice(index, 1);
        }
      }
      queuedKeys.delete(key);
    }
  }
  const snapshot = snapshots.get(key);
  if (snapshot && snapshotGenerations.get(key) !== generation) {
    snapshots.delete(key);
    snapshotGenerations.delete(key);
    queuedKeys.delete(key);
    inflightRequestIds.delete(key);
    emit(key);
  }
  const currentSnapshot = snapshots.get(key);
  if (
    currentSnapshot?.uri ||
    currentSnapshot?.isLoading ||
    queuedKeys.has(key) ||
    inflightRequestIds.has(key)
  )
    return;
  // An upload still in progress is not permanent, so that one is tried again.
  if (currentSnapshot?.error && isPermanentDownloadMiss(currentSnapshot.error)) return;

  queuedKeys.add(key);
  queue.push({ ...request, generation, requestId: ++nextRequestId });
  drainQueue();
};

export const prefetchMediaPreviews = (
  requests: ReadonlyArray<MediaPreviewRequest | null | undefined>,
): void => {
  for (const request of requests) {
    prefetchMediaPreview(request);
  }
};

export const getMediaPreviewSnapshot = (
  attachmentId: string | null | undefined,
  kind: MediaPreviewKind | null | undefined,
): MediaPreviewSnapshot => {
  if (!attachmentId || !kind) return EMPTY_PREVIEW_SNAPSHOT;
  const key = getPreviewKey(attachmentId, kind);
  if (snapshotGenerations.get(key) !== getAuthSessionGeneration()) {
    return EMPTY_PREVIEW_SNAPSHOT;
  }
  return snapshots.get(key) ?? EMPTY_PREVIEW_SNAPSHOT;
};

export const subscribeMediaPreview = (
  attachmentId: string | null | undefined,
  kind: MediaPreviewKind | null | undefined,
  listener: () => void,
): (() => void) => {
  if (!attachmentId || !kind) return () => undefined;

  const key = getPreviewKey(attachmentId, kind);
  let listeners = listenersByKey.get(key);
  if (!listeners) {
    listeners = new Set();
    listenersByKey.set(key, listeners);
  }
  listeners.add(listener);

  return (): void => {
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      listenersByKey.delete(key);
    }
  };
};

export const useMediaPreviewUri = (
  attachmentId: string | null | undefined,
  kind: MediaPreviewKind | null | undefined,
  enabled = true,
): string | null => {
  const sessionGeneration = getAuthSessionGeneration();
  const snapshot = useSyncExternalStore(
    listener => subscribeMediaPreview(attachmentId, kind, listener),
    () => getMediaPreviewSnapshot(attachmentId, kind),
    () => EMPTY_PREVIEW_SNAPSHOT,
  );

  useEffect(() => {
    if (!enabled || !attachmentId || !kind) return;
    prefetchMediaPreview({ attachmentId, kind });
  }, [attachmentId, enabled, kind, sessionGeneration]);

  return snapshot.uri;
};
