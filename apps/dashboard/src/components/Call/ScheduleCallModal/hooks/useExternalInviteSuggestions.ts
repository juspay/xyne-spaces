import { useMemo } from 'react';

interface TicketEmail {
  type?: string | null;
  from?: string | null;
  to?: string[] | null;
  cc?: string[] | null;
}

interface UseExternalInviteSuggestionsParams {
  ticketEmails: unknown;
  channelOwnEmail: string | null;
  userEmail: string | null | undefined;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractEmailAddress(value: string): string {
  const trimmed = value.trim();
  const angle = /<([^>]+)>\s*$/.exec(trimmed);
  return (angle ? angle[1]! : trimmed).trim().toLowerCase();
}

function isValidEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}

export function useExternalInviteSuggestions({
  ticketEmails,
  channelOwnEmail,
  userEmail,
}: UseExternalInviteSuggestionsParams): string[] {
  return useMemo<string[]>(() => {
    if (!Array.isArray(ticketEmails) || ticketEmails.length === 0) return [];

    const emails = ticketEmails as TicketEmail[];
    const ownerAddresses = new Set<string>();
    const selfEmail = userEmail?.trim().toLowerCase();

    if (selfEmail && isValidEmail(selfEmail)) ownerAddresses.add(selfEmail);
    if (channelOwnEmail) ownerAddresses.add(channelOwnEmail);

    for (const email of emails) {
      if ((email.type === 'REPLY' || email.type === 'REPLY_ALL') && email.from) {
        const from = extractEmailAddress(email.from);
        if (isValidEmail(from)) ownerAddresses.add(from);
      }
    }

    const addresses = emails
      .flatMap(email => [email.from, ...(email.to ?? []), ...(email.cc ?? [])])
      .filter((raw): raw is string => !!raw)
      .map(extractEmailAddress)
      .filter(isValidEmail)
      .filter(address => !ownerAddresses.has(address));

    return Array.from(new Set(addresses));
  }, [ticketEmails, channelOwnEmail, userEmail]);
}
