import { compile } from 'html-to-text';
import { AttachmentEntityType, EmailType } from '@xyne/shared';
import { db } from '@/database/client';

/**
 * Onboarding papers store ticket ids only. The first email (what the trainee answers) and the
 * rest of the thread (what the grader compares against) are read live from the ticket's
 * conversation each time. Internal notes are chat messages, not emails, so they never appear.
 */

const toText = compile({
  wordwrap: false,
  selectors: [
    { selector: 'img', format: 'skip' },
    // Keep real URLs (payment links, dashboards are often the answer); drop in-page anchors only.
    { selector: 'a', options: { noAnchorUrl: true } },
    // Quoted history from earlier messages in the thread.
    { selector: 'blockquote', format: 'skip' },
    { selector: 'div.gmail_quote', format: 'skip' },
    { selector: 'div.gmail_extra', format: 'skip' },
    { selector: '#appendonsend', format: 'skip' },
    { selector: '#divRplyFwdMsg', format: 'skip' },
  ],
});

// Plain-text reply headers that start quoted history ("On Mon, … wrote:", Outlook's separator).
const QUOTE_MARKERS = [
  /^On .{1,200}wrote:\s*$/m,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^From: .+\r?\nSent: /m,
];

function emailBodyToText(body: string): string {
  let text = toText(body);
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match) text = text.slice(0, match.index);
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

export interface OnboardingEmailAttachment {
  id: string;
  filename: string;
  mimetype: string;
  size: number;
}

export interface OnboardingEmail {
  id: string;
  subject: string;
  from: string;
  /** The provider's received time where we have it, otherwise when the row was written. */
  sentAt: string;
  inbound: boolean;
  text: string;
}

export interface OnboardingTicketContent {
  firstEmail: OnboardingEmail & { attachments: OnboardingEmailAttachment[] };
  /** Every email after the first, inbound and outbound, oldest first. May be empty. */
  thread: OnboardingEmail[];
  /** True when the thread was cut to the most recent emails. */
  threadTruncated: boolean;
}

/**
 * How much of a thread the grader sees. A long merged thread would otherwise send hundreds of
 * kilobytes per answer; the most recent emails are also where the desk's actual resolution is.
 */
const ONBOARDING_MAX_THREAD_EMAILS = 12;

/** Tickets on this desk that can go on a paper: they must exist and have at least one email. */
export async function findPaperEligibleTickets(channelId: string, ticketIds: string[]) {
  if (ticketIds.length === 0) return [];
  const tickets = await db.ticket.findMany({
    // Same rule as the picker's search, so a ticket that can't be found can't be added either.
    where: { id: { in: ticketIds }, channelId, isArchived: false },
    select: { id: true, conversationId: true },
  });
  const withEmail = await db.email.findMany({
    where: { conversationId: { in: tickets.map((t) => t.conversationId) } },
    select: { conversationId: true },
    distinct: ['conversationId'],
  });
  const hasEmail = new Set(withEmail.map((e) => e.conversationId));
  return tickets.filter((t) => hasEmail.has(t.conversationId));
}

/**
 * Read a paper ticket's content live. `includeThread` is false for the trainee's view, so the
 * rest of the thread is never even loaded into that response path. Returns null when the ticket
 * is gone or has no emails.
 */
export async function loadTicketContent(
  channelId: string,
  ticketId: string,
  includeThread: boolean
): Promise<OnboardingTicketContent | null> {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, channelId },
    select: { conversationId: true },
  });
  if (!ticket) return null;

  // `createdAt` carries the provider's received time, so this is mail order, not ingest order.
  const emailSelect = {
    id: true,
    type: true,
    subject: true,
    from: true,
    body: true,
    createdAt: true,
  } as const;

  // The customer's first message; a ticket opened by an outbound compose falls back to its oldest.
  const first =
    (await db.email.findFirst({
      where: { conversationId: ticket.conversationId, type: EmailType.DEFAULT },
      orderBy: { createdAt: 'asc' },
      select: emailSelect,
    })) ??
    (await db.email.findFirst({
      where: { conversationId: ticket.conversationId },
      orderBy: { createdAt: 'asc' },
      select: emailSelect,
    }));
  if (!first) return null;

  const toEmail = (e: typeof first): OnboardingEmail => ({
    id: e.id,
    subject: e.subject,
    from: e.from,
    sentAt: e.createdAt.toISOString(),
    inbound: e.type === EmailType.DEFAULT,
    text: emailBodyToText(e.body),
  });

  const attachments = await db.messageAttachment.findMany({
    where: { entityType: AttachmentEntityType.EMAIL, entityId: first.id, isDeleted: false },
    select: { id: true, originalFilename: true, mimetype: true, size: true },
    orderBy: { createdAt: 'asc' },
  });

  // The newest emails, since that is where the desk's resolution is, oldest-first for reading.
  // One extra row tells us whether anything was left out. Everything except the answered email
  // counts, so an outbound message that preceded it is still part of how the desk handled it.
  const newest = includeThread
    ? await db.email.findMany({
        where: { conversationId: ticket.conversationId, id: { not: first.id } },
        orderBy: { createdAt: 'desc' },
        select: emailSelect,
        take: ONBOARDING_MAX_THREAD_EMAILS + 1,
      })
    : [];
  const truncated = newest.length > ONBOARDING_MAX_THREAD_EMAILS;
  const kept = newest.slice(0, ONBOARDING_MAX_THREAD_EMAILS).reverse();

  return {
    firstEmail: {
      ...toEmail(first),
      attachments: attachments.map((a) => ({
        id: a.id,
        filename: a.originalFilename,
        mimetype: a.mimetype,
        size: a.size,
      })),
    },
    thread: kept.map(toEmail),
    threadTruncated: truncated,
  };
}
