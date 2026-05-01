import { useEffect, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';

// Module-level cache so multiple composer instances share one fetch per channel.
// Connected email rarely changes, so we cache for the session lifetime.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

const fetchConnectedEmail = (channelId: string): Promise<string | null> => {
  const cached = cache.get(channelId);
  if (cached !== undefined) return Promise.resolve(cached);
  const existing = inflight.get(channelId);
  if (existing) return existing;
  const p = apiInstance
    .get<{ email: string | null }>(`/channels/${channelId}/connected-email`)
    .then(res => {
      const email = res.data?.email ?? null;
      cache.set(channelId, email);
      return email;
    })
    .catch(() => null)
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
    const cached = cache.get(channelId);
    return cached ?? '';
  });

  useEffect(() => {
    if (!channelId) {
      setEmail('');
      return;
    }
    let cancelled = false;
    void fetchConnectedEmail(channelId).then(value => {
      if (cancelled) return;
      setEmail(value ?? '');
    });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return email;
}
