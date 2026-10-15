/**
 * useMtlsImage Hook for Lotus
 *
 * Loads images using mTLS authentication by streaming bytes to disk
 * and returning a file:// URI for display.
 */

import { useCallback, useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { API_BASE_URL } from '@/src/config';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import {
  cacheMtlsRemoteFile,
  discardCachedFile,
  isAttachmentNotReadyError,
} from '@/src/utils/mtlsDiskCache';
import { buildAttachmentResourceUrl, isValidAttachmentId } from '@/src/hooks/attachmentCachePolicy';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';

interface UseMtlsImageResult {
  uri: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

type UseMtlsImageOptions = {
  enabled?: boolean;
};

// Cache TTL: 30 days (effectively permanent, survives app restarts)
// Files are immutable by attachmentId, so no need to refresh unless corrupted
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CACHE_METADATA_KEY = (id: string): string => `attachment_cache:${id}`;

interface CacheMetadata {
  cachedAt: number;
  localPath: string;
}

// Track in-flight requests to prevent duplicates
const inflightRequests = new Map<string, Promise<string>>();
const MAX_NOT_READY_RETRIES = 6;
const NOT_READY_RETRY_DELAY_MS = 2_000;
const MIN_VALID_IMAGE_BYTES = 256;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function imageCacheFile(attachmentId: string): File {
  return new File(Paths.cache, 'images', `${attachmentId}.jpg`);
}

/** Unreadable or missing metadata counts as stale, which costs one refetch. */
async function isCacheFresh(attachmentId: string): Promise<boolean> {
  try {
    const metaJson = await AsyncStorage.getItem(CACHE_METADATA_KEY(attachmentId));
    const metadata: CacheMetadata | null = metaJson ? JSON.parse(metaJson) : null;
    return metadata !== null && Date.now() - metadata.cachedAt <= CACHE_TTL_MS;
  } catch {
    return false;
  }
}

export function useMtlsImage(
  attachmentId: string | undefined,
  options?: UseMtlsImageOptions,
): UseMtlsImageResult {
  const enabled = options?.enabled ?? true;
  chatOpenProfiler.count('use_mtls_image_hook');
  if (attachmentId && enabled) {
    chatOpenProfiler.count('use_mtls_image_hook_with_attachment');
  } else if (attachmentId) {
    chatOpenProfiler.count('use_mtls_image_hook_disabled');
  }
  const [state, setState] = useState<{
    uri: string | null;
    isLoading: boolean;
    error: Error | null;
  }>({
    uri: null,
    isLoading: !!attachmentId && enabled,
    error: null,
  });

  const fetchImage = useCallback(async (): Promise<void> => {
    if (!enabled) {
      if (attachmentId) chatOpenProfiler.count('use_mtls_image_disabled');
      setState({ uri: null, isLoading: false, error: null });
      return;
    }
    if (!attachmentId) {
      chatOpenProfiler.count('use_mtls_image_no_attachment');
      setState({ uri: null, isLoading: false, error: null });
      return;
    }
    chatOpenProfiler.count('use_mtls_image_fetch_attempt');
    if (!isValidAttachmentId(attachmentId)) {
      setState({
        uri: null,
        isLoading: false,
        error: new Error('Invalid attachment id'),
      });
      return;
    }
    const startedGeneration = getAuthSessionGeneration();

    const file = imageCacheFile(attachmentId);
    const localPath = file.uri;
    let refresh = false;

    if (file.exists && file.size > 0) {
      if (file.size < MIN_VALID_IMAGE_BYTES) {
        file.delete();
        await AsyncStorage.removeItem(CACHE_METADATA_KEY(attachmentId));
      } else if (await isCacheFresh(attachmentId)) {
        chatOpenProfiler.count('use_mtls_image_file_cache_hit');
        setState({ uri: localPath, isLoading: false, error: null });
        return;
      } else {
        // The chat list and the save action read this same file, so it stays until
        // its replacement has fully arrived.
        refresh = true;
      }
    }

    const existingRequest = inflightRequests.get(attachmentId);
    if (existingRequest) {
      chatOpenProfiler.count('use_mtls_image_inflight_join');
      try {
        const cachedUri = await existingRequest;
        setState({ uri: cachedUri, isLoading: false, error: null });
        return;
      } catch {
        // Let it fall through to retry
      }
    }

    setState(prev => ({ ...prev, isLoading: true, error: null }));

    const fetchPromise = (async (): Promise<string> => {
      const url = buildAttachmentResourceUrl(API_BASE_URL, attachmentId, 'download');

      chatOpenProfiler.count('use_mtls_image_network_fetch');

      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= MAX_NOT_READY_RETRIES; attempt += 1) {
        try {
          const uri = await cacheMtlsRemoteFile({ url, localPath, refresh });
          if (getAuthSessionGeneration() !== startedGeneration) {
            discardCachedFile(uri);
            throw new Error('Attachment download is no longer valid for this session.');
          }

          const metadata: CacheMetadata = { cachedAt: Date.now(), localPath: uri };
          await AsyncStorage.setItem(CACHE_METADATA_KEY(attachmentId), JSON.stringify(metadata));
          return uri;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (!isAttachmentNotReadyError(lastError) || attempt === MAX_NOT_READY_RETRIES) {
            throw lastError;
          }
          await wait(NOT_READY_RETRY_DELAY_MS);
        }
      }

      throw lastError ?? new Error('Failed to fetch image');
    })();

    inflightRequests.set(attachmentId, fetchPromise);

    try {
      const uri = await fetchPromise;
      if (getAuthSessionGeneration() !== startedGeneration) {
        return;
      }
      setState({ uri, isLoading: false, error: null });
    } catch (error) {
      // Preview failure is a supported UI state; keep it observable without
      // showing a development error overlay for a recoverable media fallback.
      chatOpenProfiler.count('use_mtls_image_fetch_failed');
      const normalized = error instanceof Error ? error : new Error(String(error));
      setState({
        uri: refresh && file.exists ? localPath : null,
        isLoading: false,
        error: normalized,
      });
    } finally {
      inflightRequests.delete(attachmentId);
    }
  }, [attachmentId, enabled]);

  useEffect(() => {
    void fetchImage();
  }, [fetchImage]);

  return {
    uri: state.uri,
    isLoading: state.isLoading,
    error: state.error,
    refetch: fetchImage,
  };
}
