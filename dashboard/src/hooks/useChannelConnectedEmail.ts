import { useEffect, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import { logger, Event } from '../utils/logger';

interface ConnectedEmailInfo {
  email: string | null;
  isConnected: boolean;
  hasSource: boolean;
  sourceType: string | null;
}

const EMPTY: ConnectedEmailInfo = {
  email: null,
  isConnected: false,
  hasSource: false,
  sourceType: null,
};

const cache = new Map<string, ConnectedEmailInfo>();
const inflight = new Map<string, Promise<ConnectedEmailInfo>>();

type Listener = (channelId: string | null) => void;
const listeners = new Set<Listener>();

export const clearChannelConnectedEmailCache = (channelId?: string): void => {
  if (channelId) cache.delete(channelId);
  else cache.clear();
  listeners.forEach(fn => fn(channelId ?? null));
};

const fetchConnectedEmail = (channelId: string): Promise<ConnectedEmailInfo> => {
  const cached = cache.get(channelId);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(channelId);
  if (existing) return existing;
  const p = apiInstance
    .get<{
      email: string | null;
      isConnected?: boolean;
      hasSource?: boolean;
      hasIntegration?: boolean;
      sourceType?: string | null;
    }>(`/channels/${channelId}/connected-email`)
    .then(res => {
      const isConnected = res.data?.isConnected ?? res.data?.hasIntegration ?? false;
      const info: ConnectedEmailInfo = {
        email: res.data?.email ?? null,
        isConnected,
        hasSource: res.data?.hasSource ?? isConnected,
        sourceType: res.data?.sourceType ?? null,
      };
      cache.set(channelId, info);
      return info;
    })
    .catch((err: unknown) => {
      logger.warn(Event.DESK_CONNECTED_EMAIL_FETCH_FAILED, {
        channelId,
        error: err instanceof Error ? err.message : String(err),
      });
      return EMPTY;
    })
    .finally(() => {
      inflight.delete(channelId);
    });
  inflight.set(channelId, p);
  return p;
};

/**
 * Returns the OAuth-connected mailbox email for a channel, lowercased.
 * Empty string until loaded or if the channel doesn't have one (e.g. Zoho).
 */
export function useChannelConnectedEmail(channelId: string | null | undefined): string {
  const [email, setEmail] = useState<string>(() => {
    if (!channelId) return '';
    return cache.get(channelId)?.email ?? '';
  });

  useEffect(() => {
    if (!channelId) {
      setEmail('');
      return;
    }
    let cancelled = false;
    const reload = (): void => {
      void fetchConnectedEmail(channelId).then(info => {
        if (cancelled) return;
        setEmail(info.email ?? '');
      });
    };
    reload();
    const onClear: Listener = busted => {
      if (busted === null || busted === channelId) reload();
    };
    listeners.add(onClear);
    return () => {
      cancelled = true;
      listeners.delete(onClear);
    };
  }, [channelId]);

  return email;
}

export function useChannelIntegrationInfo(
  channelId: string | null | undefined,
): ConnectedEmailInfo {
  const [info, setInfo] = useState<ConnectedEmailInfo>(() => {
    if (!channelId) return EMPTY;
    return cache.get(channelId) ?? EMPTY;
  });

  useEffect(() => {
    if (!channelId) {
      setInfo(EMPTY);
      return;
    }
    let cancelled = false;
    const reload = (): void => {
      void fetchConnectedEmail(channelId).then(next => {
        if (cancelled) return;
        setInfo(next);
      });
    };
    reload();
    const onClear: Listener = busted => {
      if (busted === null || busted === channelId) reload();
    };
    listeners.add(onClear);
    return () => {
      cancelled = true;
      listeners.delete(onClear);
    };
  }, [channelId]);

  return info;
}
