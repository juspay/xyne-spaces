import { useEffect, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';

export interface DeskPerson {
  name: string | null;
  email: string;
  count: number;
}

export interface DeskPeople {
  senders: DeskPerson[];
  recipients: DeskPerson[];
  /** `idle` until an answer for the requested channel arrives; `failed` if it never does. */
  status: 'idle' | 'ready' | 'failed';
}

interface DeskPeopleResponse {
  senders?: DeskPerson[];
  recipients?: DeskPerson[];
}

const EMPTY: DeskPeople = { senders: [], recipients: [], status: 'idle' };
// Empty too, but no longer waiting: the request failed or took too long.
const FAILED: DeskPeople = { senders: [], recipients: [], status: 'failed' };
// A request still unanswered after this long is reported as failed; a late answer still lands.
const LOAD_TIMEOUT_MS = 10_000;

// Sentinel for the aggregate endpoint (all the user's desk channels), used by the
// global Cmd+K Desk tab where no single channel is selected.
export const ALL_DESK = '__all_desk__';

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { people: DeskPeople; expiresAt: number }>();

const readCache = (channelId: string): DeskPeople | undefined => {
  const entry = cache.get(channelId);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(channelId);
    return undefined;
  }
  return entry.people;
};
/**
 * Fetches the distinct senders/recipients actually present in a desk channel's
 * indexed mail (derived live from Vespa, not the user's address book). Powers
 * the from:/to: chip autocomplete for correspondents who aren't saved contacts —
 * automated no-reply addresses, org colleagues, etc. Returns empty while loading
 * or if the channel has no desk mail.
 */
export const useDeskPeople = (channelId: string | undefined): DeskPeople => {
  const [people, setPeople] = useState<DeskPeople>(() =>
    channelId ? (readCache(channelId) ?? EMPTY) : EMPTY,
  );

  useEffect(() => {
    if (!channelId) {
      setPeople(EMPTY);
      return undefined;
    }

    let cancelled = false;
    const fetchAndSet = async (): Promise<void> => {
      const cached = readCache(channelId);
      if (cached) {
        setPeople(cached);
        return;
      }
      try {
        // ALL_DESK → aggregate endpoint (no channelId) spanning every desk channel.
        const url = channelId === ALL_DESK ? `/email/people` : `/email/${channelId}/people`;
        const response = await apiInstance.get<DeskPeopleResponse>(url);
        if (cancelled) return;
        const next: DeskPeople = {
          senders: response.data?.senders ?? [],
          recipients: response.data?.recipients ?? [],
          status: 'ready',
        };
        cache.set(channelId, { people: next, expiresAt: Date.now() + TTL_MS });
        setPeople(next);
      } catch {
        // Silent — empty is the graceful fallback (contacts + free-typed still work).
        if (!cancelled) setPeople(FAILED);
      }
    };

    void fetchAndSet();
    const timeout = setTimeout(() => {
      setPeople(prev => (prev.status === 'ready' ? prev : FAILED));
    }, LOAD_TIMEOUT_MS);
    return (): void => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [channelId]);

  return people;
};
