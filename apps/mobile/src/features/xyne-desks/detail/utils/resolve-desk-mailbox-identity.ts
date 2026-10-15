import type { MailboxReplyDirectoryUser } from '../components/mailbox-reply/mailbox-reply.utils';

export type EmailChannelPreferenceSnapshot = {
  sendAsEmail?: string | null | undefined;
  dlEmail?: string | null | undefined;
  ownerUserId?: string | null | undefined;
};

export type DeskMailboxIdentity = {
  /** Address shown in the From field — matches server send-as priority where possible. */
  fromEmail: string;
  /** All desk/agent identities excluded from To/Cc and used for outbound detection. */
  selfEmails: readonly string[];
};

function normalizeIdentityEmail(value: string | null | undefined): string | null {
  const match = value?.trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function uniqueEmails(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

/**
 * Resolve the desk mailbox the server sends from, plus every alias that counts as "self"
 * when building reply/recipient lists.
 *
 * Priority for From display mirrors the backend: configured send-as, then desk owner,
 * then the signed-in agent as a last-resort label.
 */
export function resolveDeskMailboxIdentity(
  preference: EmailChannelPreferenceSnapshot | null | undefined,
  users: readonly MailboxReplyDirectoryUser[],
  agentEmail: string,
): DeskMailboxIdentity {
  const selfEmailSet = new Set<string>();

  const addSelf = (value: string | null | undefined): void => {
    const normalized = normalizeIdentityEmail(value);
    if (normalized) selfEmailSet.add(normalized);
  };

  addSelf(preference?.sendAsEmail);
  addSelf(preference?.dlEmail);

  const ownerUserId = preference?.ownerUserId?.trim() ?? '';
  const ownerUser = ownerUserId ? users.find(user => user.id === ownerUserId) : undefined;
  const ownerEmail = normalizeIdentityEmail(ownerUser?.email);
  addSelf(ownerEmail);
  addSelf(agentEmail);

  const fromEmail =
    normalizeIdentityEmail(preference?.sendAsEmail) ??
    ownerEmail ??
    normalizeIdentityEmail(agentEmail) ??
    '';

  return {
    fromEmail,
    selfEmails: uniqueEmails(selfEmailSet),
  };
}
