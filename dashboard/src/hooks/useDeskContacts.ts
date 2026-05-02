import { useEffect, useState } from 'react';
import { apiInstance } from '../services/clients/apiClient';

export interface DeskContact {
  name: string | null;
  email: string;
}

interface DeskContactsResponse {
  contacts: DeskContact[];
}

const TTL_MS = 5 * 60 * 60 * 1000;
const cache = new Map<string, { contacts: DeskContact[]; expiresAt: number }>();

const readCache = (channelId: string): DeskContact[] | undefined => {
  const entry = cache.get(channelId);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(channelId);
    return undefined;
  }
  return entry.contacts;
};

type Listener = (channelId: string | null) => void;
const listeners = new Set<Listener>();

export const clearDeskContactsCache = (channelId?: string): void => {
  if (channelId) cache.delete(channelId);
  else cache.clear();
  listeners.forEach(fn => fn(channelId ?? null));
};

/**
 * Fetches the desk's connected mailbox contacts (Google Contacts / Outlook
 * Contacts + Relevant People) for a given email channel. Returns an empty
 * list while loading or if the channel has no integration / lacks the
 * contacts OAuth scope — callers fall back to org users + thread participants.
 */
export const useDeskContacts = (channelId: string | undefined): DeskContact[] => {
  const [contacts, setContacts] = useState<DeskContact[]>(() =>
    channelId ? (readCache(channelId) ?? []) : [],
  );

  useEffect(() => {
    if (!channelId) {
      setContacts([]);
      return undefined;
    }

    let cancelled = false;
    const fetchAndSet = async (force = false): Promise<void> => {
      if (!force) {
        const cached = readCache(channelId);
        if (cached) {
          setContacts(cached);
          return;
        }
      }
      try {
        const response = await apiInstance.get<DeskContactsResponse>(
          `/email/${channelId}/contacts`,
        );
        if (cancelled) return;
        const next = response.data?.contacts ?? [];
        cache.set(channelId, { contacts: next, expiresAt: Date.now() + TTL_MS });
        setContacts(next);
      } catch {
        // Silent — empty list is the graceful fallback.
      }
    };

    void fetchAndSet();
    const onClear: Listener = busted => {
      if (busted === null || busted === channelId) void fetchAndSet(true);
    };
    listeners.add(onClear);

    return (): void => {
      cancelled = true;
      listeners.delete(onClear);
    };
  }, [channelId]);

  return contacts;
};
