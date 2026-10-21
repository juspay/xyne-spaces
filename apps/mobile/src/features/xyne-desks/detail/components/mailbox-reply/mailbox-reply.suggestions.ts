import { parseMailboxAddress, type MailboxReplyDirectoryUser } from './mailbox-reply.utils';

export type RecipientSuggestionSource = 'org' | 'desk' | 'thread';

export type RecipientSuggestion = {
  email: string;
  name?: string | undefined;
  source: RecipientSuggestionSource;
};

export type DeskContact = {
  name: string | null;
  email: string;
};

export type ThreadEmailLike = {
  from?: string | null | undefined;
  to?: readonly string[] | undefined;
  cc?: readonly string[] | undefined;
  bcc?: readonly string[] | undefined;
  replyTo?: readonly string[] | undefined;
};

const SOURCE_RANK: Record<RecipientSuggestionSource, number> = {
  org: 0,
  desk: 1,
  thread: 2,
};

const SUGGESTION_LIMIT = 8;

export function buildContactPool(
  users: readonly MailboxReplyDirectoryUser[],
  deskContacts: readonly DeskContact[],
  threadEmails: readonly ThreadEmailLike[],
  excludeEmails: readonly (string | null | undefined)[],
): RecipientSuggestion[] {
  const exclude = new Set(
    excludeEmails
      .map(value => parseMailboxAddress(value ?? '')?.email)
      .filter((email): email is string => Boolean(email)),
  );
  const byEmail = new Map<string, RecipientSuggestion>();

  const upsert = (
    raw: string | null | undefined,
    name: string | null | undefined,
    source: RecipientSuggestionSource,
  ): void => {
    const parsed = parseMailboxAddress(raw ?? '');
    if (!parsed) return;
    if (exclude.has(parsed.email)) return;

    const existing = byEmail.get(parsed.email);
    if (existing && SOURCE_RANK[existing.source] <= SOURCE_RANK[source]) return;

    const displayName = name?.trim() || parsed.name || undefined;
    byEmail.set(parsed.email, {
      email: parsed.email,
      source,
      ...(displayName ? { name: displayName } : {}),
    });
  };

  for (const email of threadEmails) {
    upsert(email.from, null, 'thread');
    for (const value of email.to ?? []) upsert(value, null, 'thread');
    for (const value of email.cc ?? []) upsert(value, null, 'thread');
    for (const value of email.bcc ?? []) upsert(value, null, 'thread');
    for (const value of email.replyTo ?? []) upsert(value, null, 'thread');
  }

  for (const contact of deskContacts) {
    upsert(contact.email, contact.name, 'desk');
  }

  for (const user of users) {
    upsert(user.email, user.name?.trim() || user.displayName, 'org');
  }

  return [...byEmail.values()];
}

export function buildSuggestions(
  pool: readonly RecipientSuggestion[],
  query: string,
  alreadyInField: readonly string[],
): RecipientSuggestion[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const exclude = new Set(
    alreadyInField
      .map(value => parseMailboxAddress(value)?.email ?? value.trim().toLowerCase())
      .filter(Boolean),
  );

  return pool
    .filter(contact => {
      if (exclude.has(contact.email)) return false;
      if (contact.email.toLowerCase().includes(q)) return true;
      return contact.name?.toLowerCase().includes(q) ?? false;
    })
    .sort((a, b) => {
      const rankDelta = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
      if (rankDelta !== 0) return rankDelta;
      return (a.name || a.email).localeCompare(b.name || b.email);
    })
    .slice(0, SUGGESTION_LIMIT);
}

export const RECIPIENT_SUGGESTION_SOURCE_LABEL: Record<RecipientSuggestionSource, string> = {
  org: 'Org',
  desk: 'Contacts',
  thread: 'Recent',
};
