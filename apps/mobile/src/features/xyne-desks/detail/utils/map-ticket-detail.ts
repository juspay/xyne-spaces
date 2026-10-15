import type {
  TicketDetailDeskSource,
  TicketDetailDraftSnapshot,
  TicketDetailEmailAttachmentSnapshot,
  TicketDetailEmailSnapshot,
  TicketDetailReadSnapshot,
  TicketDetailSnapshot,
} from '../types';
import { asStringArray } from './parse-email-addresses';

/** Loose Zero row shape — keep mapping tolerant of schema drift. */
export type SupportTicketDetailRowLike = {
  id: string;
  xyneId?: string | null | undefined;
  title?: string | null | undefined;
  channelId?: string | null | undefined;
  status?: string | null | undefined;
  statusV2?: string | null | undefined;
  stageName?: string | null | undefined;
  priority?: string | null | undefined;
  assignedTo?: string | null | undefined;
  isArchived?: boolean | null | undefined;
  emailCount?: number | null | undefined;
  lastEmailAt?: number | null | undefined;
  conversationId?: string | null | undefined;
  metadata?: unknown;
  emails?: ReadonlyArray<EmailRowLike> | null | undefined;
  emailDrafts?:
    | ReadonlyArray<{
        id: string;
        userId?: string | null | undefined;
        draftContent?: string | null | undefined;
        autoDraftStatus?: string | null | undefined;
      }>
    | null
    | undefined;
  emailReads?:
    | ReadonlyArray<{
        userId: string;
        lastReadEmailAt?: number | null | undefined;
      }>
    | null
    | undefined;
  conversation?: { id?: string | undefined } | null | undefined;
};

export type EmailRowLike = {
  id: string;
  type?: string | null | undefined;
  subject?: string | null | undefined;
  from?: string | null | undefined;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  replyTo?: unknown;
  body?: string | null | undefined;
  createdAt?: number | null | undefined;
  updatedAt?: number | null | undefined;
  externalThreadId?: string | null | undefined;
  externalMessageId?: string | null | undefined;
  attachments?: ReadonlyArray<unknown> | null | undefined;
};

export function mapEmailRow(email: EmailRowLike): TicketDetailEmailSnapshot {
  const attachments = mapEmailAttachments(email.attachments);
  return {
    id: email.id,
    type: email.type ?? null,
    subject: email.subject ?? null,
    from: email.from ?? null,
    to: asStringArray(email.to),
    cc: asStringArray(email.cc),
    bcc: asStringArray(email.bcc),
    replyTo: asStringArray(email.replyTo),
    body: email.body ?? null,
    createdAt: email.createdAt ?? null,
    updatedAt: email.updatedAt ?? null,
    externalThreadId: email.externalThreadId ?? null,
    externalMessageId: email.externalMessageId ?? null,
    attachments,
    attachmentCount: attachments.length,
  };
}

export function mapEmailRows(
  rows: ReadonlyArray<EmailRowLike> | null | undefined,
): TicketDetailEmailSnapshot[] {
  return [...(rows ?? [])]
    .filter(e => Boolean(e?.id))
    .map(mapEmailRow)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
}

function mapEmailAttachments(
  rows: ReadonlyArray<unknown> | null | undefined,
): TicketDetailEmailAttachmentSnapshot[] {
  if (!rows || rows.length === 0) return [];

  const attachments: TicketDetailEmailAttachmentSnapshot[] = [];
  for (const item of rows) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    if (row['isDeleted'] === true) continue;
    const id = typeof row['id'] === 'string' ? row['id'] : '';
    if (!id) continue;

    const metadata =
      row['metadata'] && typeof row['metadata'] === 'object'
        ? (row['metadata'] as { contentId?: unknown; isInline?: unknown })
        : null;

    attachments.push({
      id,
      originalFilename:
        typeof row['originalFilename'] === 'string' && row['originalFilename'].trim()
          ? row['originalFilename']
          : 'attachment',
      mimetype: typeof row['mimetype'] === 'string' ? row['mimetype'] : 'application/octet-stream',
      size: typeof row['size'] === 'number' ? row['size'] : 0,
      metadata: metadata
        ? {
            ...(typeof metadata.contentId === 'string' ? { contentId: metadata.contentId } : {}),
            ...(typeof metadata.isInline === 'boolean' ? { isInline: metadata.isInline } : {}),
          }
        : null,
    });
  }

  return attachments;
}

export function emailAttachmentCount(email: TicketDetailEmailSnapshot): number {
  return email.attachments?.length ?? 0;
}

export function normalizeEmailSnapshots(
  emails: readonly TicketDetailEmailSnapshot[],
): TicketDetailEmailSnapshot[] {
  return emails.map(email =>
    Array.isArray(email.attachments)
      ? email
      : { ...email, attachments: [], attachmentCount: email.attachmentCount ?? 0 },
  );
}

/** Copy attachments from `secondary` onto matching ids in `primary`. Does not add extra rows. */
export function mergeEmailLists(
  primary: readonly TicketDetailEmailSnapshot[],
  secondary: readonly TicketDetailEmailSnapshot[],
): TicketDetailEmailSnapshot[] {
  if (secondary.length === 0) return [...primary];
  if (primary.length === 0) return [...secondary];

  const secondaryById = new Map(secondary.map(email => [email.id, email]));
  return primary.map(email => mergeEmailPair(email, secondaryById.get(email.id)));
}

function mergeEmailPair(
  left: TicketDetailEmailSnapshot,
  right: TicketDetailEmailSnapshot | undefined,
): TicketDetailEmailSnapshot {
  if (!right) return left;

  const leftAttachments = left.attachments ?? [];
  const rightAttachments = right.attachments ?? [];
  const attachments =
    rightAttachments.length > leftAttachments.length ? rightAttachments : leftAttachments;
  const body = left.body || right.body;

  if (attachments === leftAttachments && body === left.body) return left;

  return {
    ...left,
    body,
    attachments,
    attachmentCount: attachments.length,
  };
}

export function visibleEmailAttachments(
  attachments: readonly TicketDetailEmailAttachmentSnapshot[],
  body: string | null,
): TicketDetailEmailAttachmentSnapshot[] {
  if (attachments.length === 0) return [];

  const inlineCids = new Set<string>();
  const inlineIds = new Set<string>();
  if (body) {
    for (const match of body.matchAll(/cid:([^\s"'>]+)/gi)) {
      if (match[1]) inlineCids.add(match[1].trim());
    }
    for (const match of body.matchAll(/data-att-id=["']([^"']+)["']/gi)) {
      if (match[1]) inlineIds.add(match[1]);
    }
  }

  return attachments.filter(attachment => {
    if (attachment.metadata?.isInline) return false;
    if (attachment.metadata?.contentId && inlineCids.has(attachment.metadata.contentId)) {
      return false;
    }
    if (inlineIds.has(attachment.id)) return false;
    return true;
  });
}

function mapDraft(
  draft: NonNullable<SupportTicketDetailRowLike['emailDrafts']>[number],
): TicketDetailDraftSnapshot {
  return {
    id: draft.id,
    userId: draft.userId ?? null,
    draftContent: draft.draftContent ?? null,
    autoDraftStatus: draft.autoDraftStatus ?? null,
  };
}

function mapRead(
  read: NonNullable<SupportTicketDetailRowLike['emailReads']>[number],
): TicketDetailReadSnapshot {
  return {
    userId: read.userId,
    lastReadEmailAt: read.lastReadEmailAt ?? null,
  };
}

/**
 * Reads ticket.metadata.deskSource.type for email header chrome.
 *
 * Written by public App Desk inbound (`ticketController` ticketMetadata) as a
 * Zero `json()` object — not a serialized string:
 * `{ deskSource: { type: 'app', installedAppId, appName }, fromEmailAddress? }`.
 * Dashboard `getTicketReplyKind` uses the same `type === 'app'` check.
 */
function mapDeskSource(metadata: unknown): TicketDetailDeskSource | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const deskSource = (metadata as { deskSource?: unknown }).deskSource;
  if (!deskSource || typeof deskSource !== 'object') return null;
  const type = (deskSource as { type?: unknown }).type;
  if (typeof type !== 'string' || !type.trim()) return null;
  return { type: type.trim() };
}

/** Pure map: Zero detail row → serializable UI snapshot. */
export function mapTicketDetail(row: unknown): TicketDetailSnapshot | null {
  if (row === null || typeof row !== 'object') return null;

  const ticket = row as SupportTicketDetailRowLike;
  if (!ticket.id) return null;

  const emails = mapEmailRows(ticket.emails);
  const conversationId = ticket.conversationId ?? ticket.conversation?.id ?? null;

  return {
    id: ticket.id,
    xyneId: (ticket.xyneId ?? '').trim() || ticket.id,
    title: (ticket.title ?? '').trim() || '(No subject)',
    channelId: ticket.channelId ?? '',
    status: ticket.statusV2 ?? ticket.status ?? null,
    stageName: ticket.stageName ?? null,
    priority: ticket.priority ?? null,
    assignedTo: ticket.assignedTo ?? null,
    isArchived: ticket.isArchived === true,
    emailCount: ticket.emailCount ?? emails.length,
    lastEmailAt: ticket.lastEmailAt ?? null,
    conversationId,
    deskSource: mapDeskSource(ticket.metadata),
    emails,
    emailDrafts: (ticket.emailDrafts ?? []).map(mapDraft),
    emailReads: (ticket.emailReads ?? []).map(mapRead),
    conversation: conversationId ? { id: conversationId } : null,
  };
}

/**
 * Prefer the richer email list. Lotus Zero can return ticket.emails as []
 * while getEmailsForTicket (or fallback HTTP) still has the chain.
 */
export function mergeTicketDetailEmails(
  detail: TicketDetailSnapshot,
  emailRows: unknown,
): TicketDetailSnapshot {
  if (!Array.isArray(emailRows) || emailRows.length === 0) return detail;

  const mapped = mapEmailRows(emailRows as EmailRowLike[]);
  if (mapped.length === 0) return detail;

  const [primary, secondary] =
    mapped.length > detail.emails.length ? [mapped, detail.emails] : [detail.emails, mapped];
  const emails = mergeEmailLists(primary, secondary);

  const unchanged =
    emails.length === detail.emails.length &&
    emails.every((email, index) => {
      const previous = detail.emails[index];
      return (
        previous !== undefined &&
        email.id === previous.id &&
        emailAttachmentCount(email) === emailAttachmentCount(previous)
      );
    });
  if (unchanged) return detail;

  return {
    ...detail,
    emails,
    emailCount: Math.max(detail.emailCount, emails.length),
  };
}

/** True when the ticket claims a thread but related emails are still empty. */
export function ticketEmailsLookIncomplete(detail: TicketDetailSnapshot): boolean {
  if (detail.emails.length > 0) return false;
  return detail.emailCount > 0 || detail.lastEmailAt !== null || detail.conversationId !== null;
}
