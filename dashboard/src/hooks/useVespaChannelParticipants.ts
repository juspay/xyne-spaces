import { useEffect, useState } from 'react';
import { channelService } from '../services/Chat/channelService';

const cache = new Map<string, string[]>();
const inflight = new Map<string, Promise<string[]>>();

/**
 * Channel participant user IDs from Vespa `chat_container.permissions`.
 * Lazy: fires only when `enabled` is true (e.g. mention picker opens).
 * Returns cached value synchronously; revalidates in background on every enable.
 * Returns `null` if nothing has ever been fetched for this channel.
 */
export const useVespaChannelParticipants = (
  channelId: string | undefined,
  enabled: boolean,
): string[] | null => {
  const [userIds, setUserIds] = useState<string[] | null>(() =>
    channelId ? (cache.get(channelId) ?? null) : null,
  );

  useEffect(() => {
    if (!channelId) {
      setUserIds(null);
      return;
    }
    setUserIds(cache.get(channelId) ?? null);
    if (!enabled) return;

    const promise =
      inflight.get(channelId) ??
      channelService
        .getVespaParticipants(channelId)
        .then(ids => {
          cache.set(channelId, ids);
          return ids;
        })
        .finally(() => inflight.delete(channelId));
    inflight.set(channelId, promise);

    let cancelled = false;
    promise
      .then((ids): void => {
        if (!cancelled) setUserIds(ids);
      })
      .catch(() => {});
    return (): void => {
      cancelled = true;
    };
  }, [channelId, enabled]);

  return userIds;
};
