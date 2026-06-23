import { useEffect, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';
import { logger, Event } from '../utils/logger';

interface ChannelEmailAliasInfo {
  emailAlias: string | null;
  configured: boolean;
  isActive: boolean;
  sourceType: string | null;
  mailboxEmail: string | null;
}

const EMPTY: ChannelEmailAliasInfo = {
  emailAlias: null,
  configured: false,
  isActive: false,
  sourceType: null,
  mailboxEmail: null,
};

const cache = new Map<string, ChannelEmailAliasInfo>();
const inflight = new Map<string, Promise<ChannelEmailAliasInfo>>();

export function clearChannelEmailAliasCache(channelId?: string): void {
  if (channelId) {
    cache.delete(channelId);
    inflight.delete(channelId);
    return;
  }

  cache.clear();
  inflight.clear();
}

const fetchChannelEmailAlias = (channelId: string): Promise<ChannelEmailAliasInfo> => {
  const cached = cache.get(channelId);
  if (cached) return Promise.resolve(cached);

  const existing = inflight.get(channelId);
  if (existing) return existing;

  const promise = apiInstance
    .get<ChannelEmailAliasInfo>(`/channels/${channelId}/email-alias`)
    .then(res => {
      const info: ChannelEmailAliasInfo = {
        emailAlias: res.data?.emailAlias ?? null,
        configured: res.data?.configured ?? false,
        isActive: res.data?.isActive ?? false,
        sourceType: res.data?.sourceType ?? null,
        mailboxEmail: res.data?.mailboxEmail ?? null,
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

  inflight.set(channelId, promise);
  return promise;
};

export function useChannelEmailAlias(channelId: string | null | undefined): ChannelEmailAliasInfo {
  const [info, setInfo] = useState<ChannelEmailAliasInfo>(() => {
    if (!channelId) return EMPTY;
    return cache.get(channelId) ?? EMPTY;
  });

  useEffect(() => {
    if (!channelId) {
      setInfo(EMPTY);
      return;
    }

    let cancelled = false;
    void fetchChannelEmailAlias(channelId).then(next => {
      if (!cancelled) {
        setInfo(next);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return info;
}
