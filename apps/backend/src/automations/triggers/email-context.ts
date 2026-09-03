import { db } from '@/database/client';
import { EmailType } from '@xyne/shared';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { buildTicketContext } from './ticket-context';
import type { EmailEventPayload } from '../types/automation-events';
import type { TicketLike } from './ticket-context';

export function extractEmailAddress(raw: string): string {
  if (!raw) return '';
  const bracketMatch = /<([^>]+)>/.exec(raw);
  const candidate = (bracketMatch ? bracketMatch[1] : raw.split(',')[0]) ?? '';
  return candidate.trim().toLowerCase();
}

export function extractDisplayName(raw: string): string {
  if (!raw) return '';
  const bracketIdx = raw.indexOf('<');
  if (bracketIdx <= 0) return extractEmailAddress(raw);
  const name = raw.slice(0, bracketIdx).trim().replace(/^"|"$/g, '').trim();
  return name || extractEmailAddress(raw);
}

export function extractDomain(addr: string): string {
  const email = extractEmailAddress(addr);
  return email.split('@')[1] ?? '';
}

/** Build a link to a specific email in a desk ticket. */
function buildEmailUrl(params: {
  ticketUrl: string | null | undefined;
  conversationId: string | null | undefined;
  ticketId: string | null | undefined;
  emailId: string;
}): string | null {
  const { ticketUrl, conversationId, ticketId, emailId } = params;
  if (!ticketUrl || !conversationId || !emailId) return null;

  const query = new URLSearchParams({ conversationId });
  if (ticketId) query.set('ticketId', ticketId);
  query.set('mail', emailId);
  return `${ticketUrl}?${query.toString()}`;
}

function uniqueAddresses(addrs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const addr of addrs) {
    const a = extractEmailAddress(addr);
    if (a) out.add(a);
  }
  return Array.from(out);
}

function uniqueDomains(addrs: readonly string[]): string[] {
  const out = new Set<string>();
  for (const addr of addrs) {
    const dom = extractDomain(addr);
    if (dom) out.add(dom);
  }
  return Array.from(out);
}

interface EmailRow {
  id: string;
  subject: string;
  body: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  type: EmailType;
  conversationId: string;
  channelId: string;
  externalThreadId: string;
  externalMessageId: string;
  createdAt: Date;
  hasAttachments?: boolean;
}

async function loadTicketContextForEmail(
  conversationId: string,
): Promise<Awaited<ReturnType<typeof buildTicketContext>> | null> {
  const ticketStub = await repositories.tickets.findFirstByConversationId(conversationId);
  if (!ticketStub) return null;
  const ticket = await repositories.tickets.getTicketById(ticketStub.id);
  if (!ticket) return null;
  return buildTicketContext(ticket as TicketLike);
}

/** Derived address / domain fields shared by both email triggers. */
function deriveAddressFields(email: EmailRow): {
  toAddresses: string[];
  toDomains: string[];
  ccAddresses: string[];
  ccDomains: string[];
  bccAddresses: string[];
  bccDomains: string[];
  recipients: string[];
  recipientDomains: string[];
} {
  const toAddresses = uniqueAddresses(email.to);
  const toDomains = uniqueDomains(email.to);
  const ccAddresses = uniqueAddresses(email.cc);
  const ccDomains = uniqueDomains(email.cc);
  const bccAddresses = uniqueAddresses(email.bcc);
  const bccDomains = uniqueDomains(email.bcc);
  return {
    toAddresses,
    toDomains,
    ccAddresses,
    ccDomains,
    bccAddresses,
    bccDomains,
    recipients: Array.from(new Set([...toAddresses, ...ccAddresses, ...bccAddresses])),
    recipientDomains: Array.from(new Set([...toDomains, ...ccDomains, ...bccDomains])),
  };
}

function emailRowToOutput(email: EmailRow): EmailRow {
  return {
    id: email.id,
    subject: email.subject,
    body: email.body,
    from: email.from,
    to: email.to,
    cc: email.cc,
    bcc: email.bcc,
    type: email.type,
    conversationId: email.conversationId,
    channelId: email.channelId,
    externalThreadId: email.externalThreadId,
    externalMessageId: email.externalMessageId,
    createdAt: email.createdAt,
    hasAttachments: email.hasAttachments,
  };
}

export async function hydrateEmailReceivedPayload(
  payload: EmailEventPayload,
): Promise<Record<string, unknown>> {
  const email = await db.email.findUnique({ where: { id: payload.emailId } }).catch(() => null);
  if (!email) return { ...payload };

  let isReply = false;
  if (email.externalThreadId) {
    const root = await repositories.emails
      .findFirstByThreadAndChannel(email.externalThreadId, email.channelId)
      .catch(() => null);
    isReply = root !== null && root.id !== email.id;
  }

  const ticketContext = await loadTicketContextForEmail(email.conversationId);
  const hasAttachments = await repositories.messageAttachments
    .hasEmailAttachment(email.id)
    .catch(error => {
      logger.warn(
        `[automations] failed to hydrate attachment state for email=${email.id}`,
        error,
      );
      return false;
    });
  const emailUrl = buildEmailUrl({
    ticketUrl: ticketContext?.ticket.url,
    conversationId: ticketContext?.ticket.conversationId ?? email.conversationId,
    ticketId: ticketContext?.ticket.id,
    emailId: email.id,
  });

  return {
    ...payload,
    email: { ...emailRowToOutput({ ...email, hasAttachments } as EmailRow), url: emailUrl },
    ...(ticketContext ?? {}),
    requester: {
      email: extractEmailAddress(email.from),
      name: extractDisplayName(email.from),
    },
    fromDomain: extractDomain(email.from),
    ...deriveAddressFields(email as EmailRow),
    isReply,
  };
}

export async function hydrateEmailSentPayload(
  payload: EmailEventPayload,
): Promise<Record<string, unknown>> {
  const email = await db.email.findUnique({ where: { id: payload.emailId } }).catch(() => null);
  if (!email) return { ...payload };

  const ticketContext = await loadTicketContextForEmail(email.conversationId);
  const emailUrl = buildEmailUrl({
    ticketUrl: ticketContext?.ticket.url,
    conversationId: ticketContext?.ticket.conversationId ?? email.conversationId,
    ticketId: ticketContext?.ticket.id,
    emailId: email.id,
  });

  const priorReply = await db.email
    .findFirst({
      where: {
        conversationId: email.conversationId,
        type: { in: [EmailType.REPLY, EmailType.REPLY_ALL] },
        id: { not: email.id },
        createdAt: { lte: email.createdAt },
      },
      orderBy: { createdAt: 'asc' },
    })
    .catch(() => null);
  const isFirstReply = priorReply === null;

  return {
    ...payload,
    email: { ...emailRowToOutput(email as EmailRow), url: emailUrl },
    ...(ticketContext ?? {}),
    sender: {
      email: extractEmailAddress(email.from),
      name: extractDisplayName(email.from),
    },
    senderDomain: extractDomain(email.from),
    ...deriveAddressFields(email as EmailRow),
    isFirstReply,
  };
}
