import { EmailType } from '@prisma/client';
import { db } from '@/database/client';
import { repositories } from '@/database/repositories';
import { buildTicketContext } from './ticket-context';
import type { EmailEventPayload } from '../types/automation-events';

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
}

async function loadTicketContextForEmail(
  conversationId: string,
): Promise<Awaited<ReturnType<typeof buildTicketContext>> | null> {
  const ticketStub = await repositories.tickets.findFirstByConversationId(conversationId);
  if (!ticketStub) return null;
  const ticket = await repositories.tickets.getTicketById(ticketStub.id);
  if (!ticket) return null;
  return buildTicketContext(ticket);
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

  return {
    ...payload,
    email: emailRowToOutput(email),
    ...(ticketContext ?? {}),
    requester: {
      email: extractEmailAddress(email.from),
      name: extractDisplayName(email.from),
    },
    fromDomain: extractDomain(email.from),
    ...deriveAddressFields(email),
    isReply,
  };
}

export async function hydrateEmailSentPayload(
  payload: EmailEventPayload,
): Promise<Record<string, unknown>> {
  const email = await db.email.findUnique({ where: { id: payload.emailId } }).catch(() => null);
  if (!email) return { ...payload };

  const ticketContext = await loadTicketContextForEmail(email.conversationId);

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
    email: emailRowToOutput(email),
    ...(ticketContext ?? {}),
    sender: {
      email: extractEmailAddress(email.from),
      name: extractDisplayName(email.from),
    },
    senderDomain: extractDomain(email.from),
    ...deriveAddressFields(email),
    isFirstReply,
  };
}
