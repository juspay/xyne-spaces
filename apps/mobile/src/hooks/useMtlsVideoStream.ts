/**
 * useMtlsVideoStream Hook for Lotus
 *
 * Provides a proxied /stream URL for progressive video playback via the local
 * mTLS proxy (same contract as the dashboard web player).
 */

import { useEffect, useState, useSyncExternalStore } from 'react';

import { getProxyEpoch, subscribeProxyEpoch } from '@/src/hooks/mtlsProxyRecovery';
import { ensureProxyRunning, getProxiedUrl } from '@/src/hooks/useMtlsProxy';
import { API_BASE_URL } from '@/src/config';
import { useAuth } from '@/src/contexts/AuthContext';
import { getAuthSessionGeneration } from '@/src/services/authSessionLifecycle';
import { buildAttachmentResourceUrl, isValidAttachmentId } from '@/src/hooks/attachmentCachePolicy';

interface UseMtlsVideoStreamOptions {
  /** When false, the proxy is not started and streamUrl stays null. */
  enabled?: boolean;
}

interface UseMtlsVideoStreamResult {
  streamUrl: string | null;
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
}

interface StreamState {
  attachmentId: string;
  sessionGeneration: number;
  streamUrl: string | null;
  isReady: boolean;
  error: Error | null;
}

export function useMtlsVideoStream(
  attachmentId: string | undefined,
  options: UseMtlsVideoStreamOptions = {},
): UseMtlsVideoStreamResult {
  const { enabled = true } = options;
  const { token } = useAuth();
  const [streamState, setStreamState] = useState<StreamState | null>(null);
  // Bumped when the native proxy is replaced (iOS suspension recovery). The
  // old capability-bound URL no longer works, so request a fresh one.
  const proxyEpoch = useSyncExternalStore(subscribeProxyEpoch, getProxyEpoch, getProxyEpoch);

  useEffect(() => {
    if (!attachmentId || !enabled) {
      setStreamState(null);
      return;
    }
    if (!isValidAttachmentId(attachmentId)) {
      setStreamState({
        attachmentId,
        sessionGeneration: getAuthSessionGeneration(),
        streamUrl: null,
        isReady: false,
        error: new Error('Invalid attachment id'),
      });
      return;
    }

    let mounted = true;
    setStreamState(null);

    const backendUrl = buildAttachmentResourceUrl(API_BASE_URL, attachmentId, 'stream');
    const sessionGeneration = getAuthSessionGeneration();
    ensureProxyRunning(token ?? undefined, sessionGeneration)
      .then(async () => {
        const proxiedUrl = await getProxiedUrl(backendUrl, sessionGeneration);
        if (!proxiedUrl) {
          throw new Error('Unable to create a capability-bound media URL');
        }
        if (!mounted || getAuthSessionGeneration() !== sessionGeneration) return;
        setStreamState({
          attachmentId,
          sessionGeneration,
          streamUrl: proxiedUrl,
          isReady: true,
          error: null,
        });
      })
      .catch(err => {
        if (!mounted || getAuthSessionGeneration() !== sessionGeneration) return;
        const normalized = err instanceof Error ? err : new Error(String(err));
        setStreamState({
          attachmentId,
          sessionGeneration,
          streamUrl: null,
          isReady: false,
          error: normalized,
        });
      });

    return (): void => {
      mounted = false;
    };
  }, [attachmentId, token, enabled, proxyEpoch]);

  const currentGeneration = getAuthSessionGeneration();
  const isCurrentStream = Boolean(
    enabled &&
    streamState &&
    streamState.attachmentId === attachmentId &&
    streamState.sessionGeneration === currentGeneration,
  );
  const streamUrl = isCurrentStream ? (streamState?.streamUrl ?? null) : null;
  const isReady = isCurrentStream && streamState?.isReady === true;
  const error = isCurrentStream ? (streamState?.error ?? null) : null;
  const isLoading = Boolean(enabled && attachmentId && !isReady && !error);

  return { streamUrl, isReady, isLoading, error };
}
