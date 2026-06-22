import { z } from 'zod';
import { EmailType } from '@prisma/client';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { TicketContextSchema } from './ticket-context';
import {
  extractEmailAddress,
  extractDomain,
  hydrateEmailSentPayload,
} from './email-context';
import type { EmailEventPayload } from '../types/automation-events';

export const EMAIL_SENT_EVENT = 'EMAIL_SENT';

const EmailSentConfigSchema = z.object({
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to outbound replies from these channels. Empty matches every channel.'),
  toEmails: z
    .array(z.string())
    .optional()
    .describe('Match the recipient address. Press Enter after each one.'),
  toDomains: z
    .array(z.string())
    .optional()
    .describe(
      'Match recipient domains, e.g. acme.com or @acme.com. Press Enter after each one.',
    ),
  subjectContains: z
    .array(z.string())
    .optional()
    .describe('Fire when the subject contains ANY of these substrings.'),
  bodyContains: z
    .array(z.string())
    .optional()
    .describe('Fire when the body contains ANY of these substrings.'),
  matchCase: z
    .boolean()
    .optional()
    .describe('When on, the subject / body substring matches are case-sensitive.'),
  replyTypes: z
    .array(z.enum([EmailType.REPLY, EmailType.REPLY_ALL]))
    .optional()
    .describe(
      'Restrict to specific reply kinds. Empty matches both REPLY and REPLY_ALL.',
    ),
  onlyFirstReply: z
    .boolean()
    .optional()
    .describe(
      'When on, only the first outbound reply in a conversation fires this trigger.',
    ),
});

export const EmailSentOutputSchema = TicketContextSchema.partial().extend({
  email: z.object({
    id: z.string(),
    subject: z.string(),
    body: z.string(),
    from: z.string(),
    to: z.array(z.string()),
    cc: z.array(z.string()),
    bcc: z.array(z.string()),
    type: z.nativeEnum(EmailType),
    conversationId: z.string(),
    channelId: z.string(),
    externalThreadId: z.string(),
    externalMessageId: z.string(),
    createdAt: z.coerce.date(),
  }),
  sender: z.object({
    email: z.string(),
    name: z.string(),
  }),
  senderDomain: z.string(),
  toAddresses: z.array(z.string()),
  toDomains: z.array(z.string()),
  ccAddresses: z.array(z.string()),
  ccDomains: z.array(z.string()),
  bccAddresses: z.array(z.string()),
  bccDomains: z.array(z.string()),
  recipients: z.array(z.string()),
  recipientDomains: z.array(z.string()),
  isFirstReply: z.boolean(),
});

type EmailSentConfig = z.infer<typeof EmailSentConfigSchema>;
type EmailSentPayload = z.infer<typeof EmailSentOutputSchema>;

export class EmailSentTrigger extends BaseTrigger<typeof EmailSentConfigSchema> {
  readonly type = EMAIL_SENT_EVENT;
  readonly configSchema = EmailSentConfigSchema;
  readonly outputSchema = EmailSentOutputSchema;
  readonly name = 'When an email reply is sent';
  readonly description =
    'Fires when an outbound reply (REPLY or REPLY_ALL) is sent from a desk channel. Filter by channel, recipient, subject, body, or reply kind.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Send';

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return hydrateEmailSentPayload(payload as unknown as EmailEventPayload);
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    try {
      return matchEmailSent(filter as EmailSentConfig, payload as EmailSentPayload);
    } catch (err) {
      logger.error('[automations] EMAIL_SENT matchFilters threw — treating as no-match:', err);
      return false;
    }
  }
}

export const emailSentTrigger = new EmailSentTrigger();

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value];
  return [];
}

function matchEmailSent(cfg: EmailSentConfig, payload: EmailSentPayload): boolean {
  const e = payload.email;
  const matchCase = cfg.matchCase === true;
  const norm = (s: string): string => (matchCase ? s : s.toLowerCase());

  const channelIds = asStringArray(cfg.channelIds);
  if (channelIds.length > 0 && !channelIds.includes(e.channelId)) return false;

  const replyTypes = (cfg.replyTypes ?? []) as string[];
  if (replyTypes.length > 0 && !replyTypes.includes(e.type)) return false;

  const toEmails = asStringArray(cfg.toEmails);
  if (toEmails.length > 0) {
    const want = new Set(toEmails.map(s => s.toLowerCase()));
    const got = e.to.map(addr => extractEmailAddress(addr));
    if (!got.some(addr => want.has(addr))) return false;
  }
  const toDomains = asStringArray(cfg.toDomains);
  if (toDomains.length > 0) {
    const want = toDomains.map(d => d.replace(/^@/, '').toLowerCase());
    const got = e.to.map(addr => extractDomain(addr));
    if (!got.some(domain => want.includes(domain))) return false;
  }

  const subjectContains = asStringArray(cfg.subjectContains);
  if (subjectContains.length > 0) {
    const subject = norm(e.subject);
    if (!subjectContains.some(needle => subject.includes(norm(needle)))) return false;
  }
  const bodyContains = asStringArray(cfg.bodyContains);
  if (bodyContains.length > 0) {
    const body = norm(e.body);
    if (!bodyContains.some(needle => body.includes(norm(needle)))) return false;
  }

  if (cfg.onlyFirstReply && !payload.isFirstReply) return false;

  return true;
}

export async function emitEmailSent(emailId: string): Promise<void> {
  try {
    const email = await repositories.emails.findById(emailId);
    if (!email) return;
    if (email.type === EmailType.DEFAULT) return; // only REPLY / REPLY_ALL

    const ticketStub = await repositories.tickets.findFirstByConversationId(email.conversationId);
    const workspaceId =
      ticketStub?.workspaceId ??
      (await repositories.channels.findById(email.channelId).catch(() => null))?.workspaceId;
    if (!workspaceId) {
      logger.warn('[automations] emitEmailSent dropped — could not resolve workspaceId', {
        emailId,
        channelId: email.channelId,
      });
      return;
    }

    await eventRouter.emit({ type: EMAIL_SENT_EVENT, payload: { emailId } }, workspaceId);
  } catch (err) {
    logger.error('[automations] emitEmailSent failed', {
      emailId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
