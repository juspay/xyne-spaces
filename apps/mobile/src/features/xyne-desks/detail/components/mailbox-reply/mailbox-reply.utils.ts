export type RecipientFieldName = 'to' | 'cc' | 'bcc';

export type MailboxReplyDirectoryUser = {
  id: string;
  email?: string | null | undefined;
  name?: string | null | undefined;
  displayName?: string | null | undefined;
  picture?: string | null | undefined;
};

export type MailboxRecipient = {
  id: string;
  email: string;
  name: string;
  userId?: string | undefined;
  avatarUrl?: string | undefined;
};

export type MailboxRecipientDirectory = ReadonlyMap<string, MailboxReplyDirectoryUser>;

type ParsedRecipientInput = {
  recipients: MailboxRecipient[];
  remainder: string;
};

type CreateMailboxRecipientOptions = {
  directory?: MailboxRecipientDirectory | undefined;
  name?: string | null | undefined;
  userId?: string | null | undefined;
  avatarUrl?: string | null | undefined;
};

const AVATAR_COLORS = ['#0EA5E9', '#EC4899', '#8B5CF6', '#F97316', '#10B981', '#6366F1'] as const;

export function createRecipientDirectory(
  users: readonly MailboxReplyDirectoryUser[] | null | undefined,
): MailboxRecipientDirectory {
  const directory = new Map<string, MailboxReplyDirectoryUser>();

  for (const user of users ?? []) {
    if (!user.id) continue;
    const email = normalizeEmail(user.email);
    if (!email) continue;
    directory.set(email, user);
  }

  return directory;
}

export function parseRecipientInput(
  raw: string,
  commitAll: boolean,
  directory?: MailboxRecipientDirectory | undefined,
): ParsedRecipientInput {
  const allowWhitespaceSplit = raw.includes('@');
  const splitPattern = allowWhitespaceSplit ? /[,\n;\s]+/ : /[,;\n]+/;
  const endsWithDelimiter = allowWhitespaceSplit ? /[,\n;\s]$/.test(raw) : /[,;\n]$/.test(raw);
  const pieces = raw.split(splitPattern).filter(Boolean);
  const shouldCommitLast = commitAll || endsWithDelimiter;
  const candidates = shouldCommitLast ? pieces : pieces.slice(0, -1);
  const remainder = shouldCommitLast ? '' : (pieces.at(-1) ?? raw);

  return {
    recipients: candidates
      .map(value => createMailboxRecipient(value, { directory }))
      .filter(isRecipient),
    remainder,
  };
}

export function createMailboxRecipient(
  raw: string,
  options: CreateMailboxRecipientOptions = {},
): MailboxRecipient | null {
  const parsed = parseMailboxAddress(raw);
  if (!parsed) return null;

  const user = options.directory?.get(parsed.email);
  const userId = user?.id || options.userId?.trim() || undefined;
  const name =
    displayNameFromUser(user) || options.name?.trim() || parsed.name || nameFromEmail(parsed.email);
  const avatarUrl = user?.picture?.trim() || options.avatarUrl?.trim() || undefined;

  return {
    id: parsed.email,
    email: parsed.email,
    name,
    ...(userId ? { userId } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function enrichMailboxRecipient(
  recipient: MailboxRecipient,
  directory: MailboxRecipientDirectory,
): MailboxRecipient {
  const user = directory.get(recipient.email.toLowerCase());
  if (!user) return recipient;

  const userId = user.id || recipient.userId;
  const name = displayNameFromUser(user) || recipient.name;
  const avatarUrl = user.picture?.trim() || recipient.avatarUrl;

  if (recipient.userId === userId && recipient.name === name && recipient.avatarUrl === avatarUrl) {
    return recipient;
  }

  return {
    ...recipient,
    name,
    ...(userId ? { userId } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

export function enrichMailboxRecipients(
  recipients: readonly MailboxRecipient[],
  directory: MailboxRecipientDirectory,
): MailboxRecipient[] {
  let changed = false;
  const next = recipients.map(recipient => {
    const enriched = enrichMailboxRecipient(recipient, directory);
    if (enriched !== recipient) changed = true;
    return enriched;
  });

  return changed ? next : [...recipients];
}

export function uniqueRecipients(recipients: readonly MailboxRecipient[]): MailboxRecipient[] {
  const seen = new Set<string>();
  const result: MailboxRecipient[] = [];

  for (const recipient of recipients) {
    const email = recipient.email.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    result.push(recipient);
  }

  return result;
}

export function parseDefaultCcEmails(raw: string | null | undefined): string[] {
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return [];

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueStrings(
        parsed
          .filter((value): value is string => typeof value === 'string')
          .map(value => value.trim())
          .filter(Boolean),
      );
    }
  } catch {
    // Comma / semicolon separated desk preference.
  }

  return uniqueStrings(
    trimmed
      .split(/[,;]+/)
      .map(value => value.trim())
      .filter(Boolean),
  );
}

function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export type MailboxReplyRecipientMode = 'reply' | 'replyAll';

export type MailboxLatestEmailForReply = {
  type?: string | null | undefined;
  from?: string | null | undefined;
  to?: readonly string[] | undefined;
  cc?: readonly string[] | undefined;
  replyTo?: readonly string[] | undefined;
};

export function isDeskOutboundEmail(
  latestEmail: Pick<MailboxLatestEmailForReply, 'type'> | null | undefined,
): boolean {
  const type = latestEmail?.type?.trim().toUpperCase() ?? '';
  return type === 'REPLY' || type === 'REPLY_ALL';
}

function buildSelfEmailSet(selfEmails: readonly string[]): Set<string> {
  const normalized = selfEmails
    .map(email => normalizeEmail(email))
    .filter((email): email is string => Boolean(email));
  return new Set(normalized);
}

export function buildMailboxReplyRecipients(
  latestEmail: MailboxLatestEmailForReply | null | undefined,
  selfEmails: readonly string[],
  directory?: MailboxRecipientDirectory | undefined,
  mode: MailboxReplyRecipientMode = 'replyAll',
): { to: MailboxRecipient[]; cc: MailboxRecipient[]; bcc: MailboxRecipient[] } {
  const to: MailboxRecipient[] = [];
  const cc: MailboxRecipient[] = [];
  const seen = new Set<string>();
  const selfEmailSet = buildSelfEmailSet(selfEmails);

  const addRecipients = (
    target: MailboxRecipient[],
    values: readonly string[] | undefined,
    { excludeSelf = true }: { excludeSelf?: boolean } = {},
  ): void => {
    for (const value of values ?? []) {
      const recipient = createMailboxRecipient(value, { directory });
      if (!recipient) continue;

      const email = recipient.email.toLowerCase();
      if (excludeSelf && selfEmailSet.has(email)) continue;
      if (seen.has(email)) continue;

      seen.add(email);
      target.push(recipient);
    }
  };

  const sender = latestEmail?.from ? createMailboxRecipient(latestEmail.from, { directory }) : null;
  const senderIsSelf =
    isDeskOutboundEmail(latestEmail) ||
    Boolean(sender?.email && selfEmailSet.has(sender.email.toLowerCase()));

  if (mode === 'replyAll') {
    if (latestEmail?.replyTo && latestEmail.replyTo.length > 0) {
      addRecipients(to, latestEmail.replyTo);
    } else if (latestEmail?.from) {
      addRecipients(to, [latestEmail.from]);
    }

    addRecipients(to, latestEmail?.to);
    addRecipients(cc, latestEmail?.cc);
  } else if (senderIsSelf) {
    addRecipients(to, latestEmail?.to);
  } else if (latestEmail?.replyTo && latestEmail.replyTo.length > 0) {
    addRecipients(to, latestEmail.replyTo);
  } else if (latestEmail?.from) {
    addRecipients(to, [latestEmail.from]);
  }

  return {
    to: uniqueRecipients(to),
    cc: uniqueRecipients(cc),
    bcc: [],
  };
}

export function withReplyPrefix(subject: string | null | undefined): string {
  const trimmed = subject?.trim() ?? '';
  if (!trimmed) return '';
  return /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`;
}

export function getMailboxRecipientInitial(recipient: MailboxRecipient): string {
  return recipient.name.trim()[0]?.toUpperCase() || recipient.email[0]?.toUpperCase() || '?';
}

export function getMailboxRecipientColor(value: string): string {
  let sum = 0;
  for (let index = 0; index < value.length; index += 1) {
    sum += value.charCodeAt(index);
  }
  return AVATAR_COLORS[sum % AVATAR_COLORS.length] ?? AVATAR_COLORS[0]!;
}

function isRecipient(value: MailboxRecipient | null): value is MailboxRecipient {
  return value !== null;
}

export function parseMailboxAddress(raw: string): { email: string; name: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const angleMatch = trimmed.match(/^(.*?)<([^>]+)>$/);
  const emailCandidate = angleMatch?.[2]?.trim() ?? trimmed;
  const email = normalizeEmail(emailCandidate);
  if (!email) return null;

  const name = angleMatch?.[1]?.replace(/^"|"$/g, '').trim() || null;
  return { email, name };
}

function normalizeEmail(value: string | null | undefined): string | null {
  const match = value?.trim().match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function displayNameFromUser(user: MailboxReplyDirectoryUser | undefined): string {
  return user?.displayName?.trim() || user?.name?.trim() || '';
}

function nameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  const words = local
    .replace(/[._-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return email;

  return words.map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}
