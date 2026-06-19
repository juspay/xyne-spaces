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
}

interface DeskPeopleResponse {
  senders?: DeskPerson[];
  recipients?: DeskPerson[];
}

const EMPTY: DeskPeople = { senders: [], recipients: [] };

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

export const clearDeskPeopleCache = (channelId?: string): void => {
  if (channelId) cache.delete(channelId);
  else cache.clear();
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
        };
        cache.set(channelId, { people: next, expiresAt: Date.now() + TTL_MS });
        setPeople(next);
      } catch {
        // Silent — empty is the graceful fallback (contacts + free-typed still work).
      }
    };

    void fetchAndSet();
    return (): void => {
      cancelled = true;
    };
  }, [channelId]);

  return people;
};
