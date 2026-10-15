/**
 * useMtlsThumbnail Hook for Lotus
 *
 * Loads video thumbnails using mTLS authentication by streaming bytes to disk.
 * Used for video preview images before the user clicks to play.
 */

import { useCallback, useEffect, useState } from 'react';
import { File, Paths } from 'expo-file-system';

import { API_BASE_URL } from '@/src/config';
import { chatOpenProfiler } from '@/src/features/chat/chatOpenProfiler';
import {
  cacheMtlsRemoteFile,
  discardCachedFile,
  isAttachmentNotReadyError,
} from '@/src/utils/mtlsDiskCache';
import { buildAttachmentResourceUrl, isValidAttachmentId } from '@/src/hooks/attachmentCachePolicy';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';

interface UseMtlsThumbnailResult {
  uri: string | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

type UseMtlsThumbnailOptions = {
  enabled?: boolean;
};

const inflightRequests = new Map<string, Promise<string>>();
const MAX_NOT_READY_RETRIES = 4;
const NOT_READY_RETRY_DELAY_MS = 1_500;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

function thumbnailCacheFile(attachmentId: string): File {
  return new File(Paths.cache, 'thumbnails', `${attachmentId}.jpg`);
}

export function useMtlsThumbnail(
  attachmentId: string | undefined,
  options?: UseMtlsThumbnailOptions,
): UseMtlsThumbnailResult {
  const enabled = options?.enabled ?? true;
  chatOpenProfiler.count('use_mtls_thumbnail_hook');
  if (attachmentId && enabled) {
    chatOpenProfiler.count('use_mtls_thumbnail_hook_with_attachment');
  } else if (attachmentId) {
    chatOpenProfiler.count('use_mtls_thumbnail_hook_disabled');
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

  const fetchThumbnail = useCallback(async () => {
    if (!enabled) {
      if (attachmentId) chatOpenProfiler.count('use_mtls_thumbnail_disabled');
      setState({ uri: null, isLoading: false, error: null });
      return;
    }
    if (!attachmentId) {
      chatOpenProfiler.count('use_mtls_thumbnail_no_attachment');
      setState({ uri: null, isLoading: false, error: null });
      return;
    }
    chatOpenProfiler.count('use_mtls_thumbnail_fetch_attempt');
    if (!isValidAttachmentId(attachmentId)) {
      setState({
        uri: null,
        isLoading: false,
        error: new Error('Invalid attachment id'),
      });
      return;
    }
    const startedGeneration = getAuthSessionGeneration();

    const file = thumbnailCacheFile(attachmentId);
    const localPath = file.uri;
    if (file.exists && file.size > 0) {
      chatOpenProfiler.count('use_mtls_thumbnail_file_cache_hit');
      setState({ uri: localPath, isLoading: false, error: null });
      return;
    }

    const existingRequest = inflightRequests.get(attachmentId);
    if (existingRequest) {
      chatOpenProfiler.count('use_mtls_thumbnail_inflight_join');
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
      const url = buildAttachmentResourceUrl(API_BASE_URL, attachmentId, 'thumbnail');
      chatOpenProfiler.count('use_mtls_thumbnail_network_fetch');

      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= MAX_NOT_READY_RETRIES; attempt += 1) {
        try {
          const uri = await cacheMtlsRemoteFile({ url, localPath });
          if (getAuthSessionGeneration() !== startedGeneration) {
            discardCachedFile(uri);
            throw new Error('Attachment download is no longer valid for this session.');
          }
          return uri;
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));
          if (!isAttachmentNotReadyError(lastError) || attempt === MAX_NOT_READY_RETRIES) {
            throw lastError;
          }
          await wait(NOT_READY_RETRY_DELAY_MS);
        }
      }

      throw lastError ?? new Error('Failed to fetch thumbnail');
    })();

    inflightRequests.set(attachmentId, fetchPromise);

    try {
      const uri = await fetchPromise;
      if (getAuthSessionGeneration() !== startedGeneration) {
        return;
      }
      setState({ uri, isLoading: false, error: null });
    } catch (error) {
      // Preview failure is a supported UI state; the attachment cell renders
      // its fallback icon and still lets the message layout settle. Keep the
      // failure observable without emitting a development error overlay for
      // every attachment whose preview endpoint is unavailable.
      chatOpenProfiler.count('use_mtls_thumbnail_fetch_failed');
      const normalized = error instanceof Error ? error : new Error(String(error));
      setState({
        uri: null,
        isLoading: false,
        error: normalized,
      });
    } finally {
      inflightRequests.delete(attachmentId);
    }
  }, [attachmentId, enabled]);

  useEffect(() => {
    void fetchThumbnail();
  }, [fetchThumbnail]);

  return {
    uri: state.uri,
    isLoading: state.isLoading,
    error: state.error,
    refetch: fetchThumbnail,
  };
}
