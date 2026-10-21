import { useEffect, useState } from 'react';

import { apiGet } from '@/src/services/apiClient';

import type { DeskContact } from './mailbox-reply.suggestions';

const CONTACTS_CACHE_TTL_MS = 5 * 60 * 60 * 1000;

const contactsCache = new Map<string, { at: number; contacts: DeskContact[] }>();

type DeskContactsResponse = {
  contacts?: DeskContact[] | undefined;
};

export function useDeskContacts(channelId: string | null | undefined): DeskContact[] {
  const [contacts, setContacts] = useState<DeskContact[]>(() => {
    if (!channelId) return [];
    return contactsCache.get(channelId)?.contacts ?? [];
  });

  useEffect(() => {
    if (!channelId) {
      setContacts([]);
      return;
    }

    const cached = contactsCache.get(channelId);
    if (cached && Date.now() - cached.at < CONTACTS_CACHE_TTL_MS) {
      setContacts(cached.contacts);
      return;
    }

    let cancelled = false;
    void apiGet<DeskContactsResponse>(`/email/${encodeURIComponent(channelId)}/contacts`)
      .then(response => {
        const next = (response.contacts ?? []).filter(contact => contact.email?.trim());
        contactsCache.set(channelId, { at: Date.now(), contacts: next });
        if (!cancelled) setContacts(next);
      })
      .catch(() => {
        if (!cancelled) setContacts([]);
      });

    return () => {
      cancelled = true;
    };
  }, [channelId]);

  return contacts;
}
