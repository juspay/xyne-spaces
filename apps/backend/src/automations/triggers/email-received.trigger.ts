import { z } from 'zod';
import { EmailType } from '@xyne/shared';
import { BaseTrigger } from './base-trigger';
import { TriggerCategory } from '../types/categories';
import { eventRouter } from '../engine/event-router';
import { repositories } from '@/database/repositories';
import { logger } from '@/utils/logger';
import { TicketContextSchema } from './ticket-context';
import {
  extractEmailAddress,
  extractDomain,
  hydrateEmailReceivedPayload,
} from './email-context';
import type { EmailEventPayload } from '../types/automation-events';

export const EMAIL_RECEIVED_EVENT = 'EMAIL_RECEIVED';

export const EmailReceivedConfigFieldsSchema = z.object({
  channelIds: z
    .array(z.string())
    .optional()
    .describe('Limit to specific email-inbox channels. Empty matches every inbox you can see.'),
  fromEmails: z
    .array(z.string())
    .optional()
    .describe('Match exact sender addresses. Press Enter after each one. Empty matches anyone.'),
  fromDomains: z
    .array(z.string())
    .optional()
    .describe(
      'Match sender domains, e.g. acme.com or @acme.com. Press Enter after each one. Empty matches any domain.',
    ),
  toEmails: z
    .array(z.string())
    .optional()
    .describe(
      'Match the inbox the mail was sent to, e.g. support@yourcompany.com. Press Enter after each one. Empty matches any recipient.',
    ),
  subjectContains: z
    .array(z.string())
    .optional()
    .describe(
      'Fire when the subject contains ANY of these substrings. Press Enter after each one. Empty matches any subject.',
    ),
  bodyContains: z
    .array(z.string())
    .optional()
    .describe(
      'Fire when the body contains ANY of these substrings. Press Enter after each one. Empty matches any body.',
    ),
  matchCase: z
    .boolean()
    .optional()
    .describe('When on, the subject / body substring matches are case-sensitive.'),
  excludedFromEmails: z
    .array(z.string())
    .optional()
    .describe('Skip emails from these exact addresses. Empty skips nothing.'),
  excludedFromDomains: z
    .array(z.string())
    .optional()
    .describe('Skip emails from these sender domains. Empty skips nothing.'),
  excludedToEmails: z
    .array(z.string())
    .optional()
    .describe('Skip emails sent to these inboxes. Empty skips nothing.'),
  excludedSubjectContains: z
    .array(z.string())
    .optional()
    .describe('Skip emails whose subject contains ANY of these substrings.'),
  excludedBodyContains: z
    .array(z.string())
    .optional()
    .describe('Skip emails whose body contains ANY of these substrings.'),
  onlyNewThreads: z
    .boolean()
    .optional()
    .describe(
      'When on, only the first email of a thread fires this trigger. Useful for "new ticket" rules.',
    ),
  hasAttachments: z
    .boolean()
    .optional()
    .describe('When enabled, match only emails that have attachments.'),
  onlyReplies: z
    .boolean()
    .optional()
    .describe(
      'When on, only reply emails (not the first email in a thread) fire this trigger.',
    ),
});

export function withEmailReceivedConfigValidation<T extends z.AnyZodObject>(
  schema: T,
): z.ZodEffects<T> {
  return schema.refine(
    data => !(data.onlyNewThreads === true && data.onlyReplies === true),
    { message: 'onlyNewThreads and onlyReplies cannot both be true — they are mutually exclusive' },
  );
}

export const EmailReceivedConfigSchema = withEmailReceivedConfigValidation(
  EmailReceivedConfigFieldsSchema,
);

export const EmailReceivedOutputSchema = TicketContextSchema.partial().extend({
  email: z.object({
    id: z.string(),
    url: z.string().url().nullable(),
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
    hasAttachments: z.boolean(),
  }),
  requester: z.object({
    email: z.string(),
    name: z.string(),
  }),
  fromDomain: z.string(),
  toAddresses: z.array(z.string()),
  toDomains: z.array(z.string()),
  ccAddresses: z.array(z.string()),
  ccDomains: z.array(z.string()),
  bccAddresses: z.array(z.string()),
  bccDomains: z.array(z.string()),
  recipients: z.array(z.string()),
  recipientDomains: z.array(z.string()),
  isReply: z.boolean(),
});

type EmailReceivedConfig = z.infer<typeof EmailReceivedConfigSchema>;
type EmailReceivedPayload = z.infer<typeof EmailReceivedOutputSchema>;

export function hasEmailReceivedFilterConstraints(
  filters: Partial<EmailReceivedConfig> | undefined,
): boolean {
  if (!filters) return false;

  const hasNonEmptyArray = (value: unknown): boolean =>
    Array.isArray(value) &&
    value.some(item => (typeof item === 'string' ? item.trim().length > 0 : true));

  return (
    hasNonEmptyArray(filters.fromEmails) ||
    hasNonEmptyArray(filters.fromDomains) ||
    hasNonEmptyArray(filters.toEmails) ||
    hasNonEmptyArray(filters.subjectContains) ||
    hasNonEmptyArray(filters.bodyContains) ||
    filters.hasAttachments === true ||
    filters.onlyNewThreads === true ||
    filters.onlyReplies === true ||
    hasNonEmptyArray(filters.excludedFromEmails) ||
    hasNonEmptyArray(filters.excludedFromDomains) ||
    hasNonEmptyArray(filters.excludedToEmails) ||
    hasNonEmptyArray(filters.excludedSubjectContains) ||
    hasNonEmptyArray(filters.excludedBodyContains)
  );
}

export class EmailReceivedTrigger extends BaseTrigger<typeof EmailReceivedConfigSchema> {
  readonly type = EMAIL_RECEIVED_EVENT;
  readonly configSchema = EmailReceivedConfigSchema;
  readonly outputSchema = EmailReceivedOutputSchema;
  readonly name = 'When an email is received';
  readonly description =
    'Fires when an inbound email arrives. Filter by inbox channel, sender, sender domain, or text in the subject / body.';
  readonly category = TriggerCategory.EVENT;
  readonly icon = 'Mail';

  async hydratePayload(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    return hydrateEmailReceivedPayload(payload as unknown as EmailEventPayload);
  }

  override matchFilters(
    filter: Record<string, unknown>,
    payload: Record<string, unknown>,
  ): boolean {
    try {
      return matchEmailReceived(filter as EmailReceivedConfig, payload as EmailReceivedPayload);
    } catch (err) {
      logger.error('[automations] EMAIL_RECEIVED matchFilters threw — treating as no-match:', err);
      return false;
    }
  }
}

export const emailReceivedTrigger = new EmailReceivedTrigger();

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  }
  if (typeof value === 'string' && value.trim().length > 0) return [value];
  return [];
}

function matchEmailReceived(cfg: EmailReceivedConfig, payload: EmailReceivedPayload): boolean {
  const e = payload.email;
  const matchCase = cfg.matchCase === true;
  const norm = (s: string): string => (matchCase ? s : s.toLowerCase());

  const channelIds = asStringArray(cfg.channelIds);
  if (channelIds.length > 0 && !channelIds.includes(e.channelId)) return false;

  if (cfg.hasAttachments === true && !e.hasAttachments) {
    return false;
  }

  const fromEmails = asStringArray(cfg.fromEmails);
  const fromDomains = asStringArray(cfg.fromDomains);
  if (fromEmails.length > 0 || fromDomains.length > 0) {
    const senderAddr = extractEmailAddress(e.from);
    const senderDomain = extractDomain(e.from) || payload.fromDomain;

    const fromEmailMatched =
      fromEmails.length > 0 &&
      fromEmails.map(s => s.toLowerCase()).includes(senderAddr);
    const fromDomainMatched =
      fromDomains.length > 0 &&
      fromDomains.map(d => d.replace(/^@/, '').toLowerCase()).includes(senderDomain);

    if (!fromEmailMatched && !fromDomainMatched) return false;
  }

  const toEmails = asStringArray(cfg.toEmails);
  if (toEmails.length > 0) {
    const want = new Set(toEmails.map(s => s.toLowerCase()));
    const got = e.to.map(addr => addr.toLowerCase());
    if (!got.some(addr => want.has(addr))) return false;
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

  const excludedFromEmails = asStringArray(cfg.excludedFromEmails);
  if (excludedFromEmails.length > 0) {
    const senderAddr = extractEmailAddress(e.from);
    const excluded = excludedFromEmails.map(s => s.toLowerCase());
    if (excluded.includes(senderAddr)) return false;
  }
  const excludedFromDomains = asStringArray(cfg.excludedFromDomains);
  if (excludedFromDomains.length > 0) {
    const senderDomain = extractDomain(e.from) || payload.fromDomain;
    const excluded = excludedFromDomains.map(d => d.replace(/^@/, '').toLowerCase());
    if (senderDomain && excluded.includes(senderDomain)) return false;
  }
  const excludedToEmails = asStringArray(cfg.excludedToEmails);
  if (excludedToEmails.length > 0) {
    const excluded = new Set(excludedToEmails.map(s => s.toLowerCase()));
    if (e.to.some(addr => excluded.has(addr.toLowerCase()))) return false;
  }
  const excludedSubjectContains = asStringArray(cfg.excludedSubjectContains);
  if (excludedSubjectContains.length > 0) {
    const subject = norm(e.subject);
    if (excludedSubjectContains.some(needle => subject.includes(norm(needle)))) return false;
  }
  const excludedBodyContains = asStringArray(cfg.excludedBodyContains);
  if (excludedBodyContains.length > 0) {
    const body = norm(e.body);
    if (excludedBodyContains.some(needle => body.includes(norm(needle)))) return false;
  }

  if (cfg.onlyNewThreads) {
    if (payload.isReply) return false;
  }
  if (cfg.onlyReplies) {
    if (!payload.isReply) return false;
  }
  return true;
}

export async function emitEmailReceived(emailId: string): Promise<void> {
  try {
    const email = await repositories.emails.findById(emailId);
    if (!email) return;
    if (email.type !== EmailType.DEFAULT) return;

    const workspaceId = await resolveEmailWorkspaceId(email.conversationId, email.channelId);
    if (!workspaceId) {
      logger.warn('[automations] emitEmailReceived dropped — could not resolve workspaceId', {
        emailId,
        channelId: email.channelId,
      });
      return;
    }

    await eventRouter.emit(
      { type: EMAIL_RECEIVED_EVENT, payload: { emailId, channelId: email.channelId } },
      workspaceId,
    );
  } catch (err) {
    logger.error('[automations] emitEmailReceived failed', {
      emailId,
      error: err,
    });
  }
}

async function resolveEmailWorkspaceId(
  conversationId: string,
  channelId: string,
): Promise<string | null> {
  const ticketStub = await repositories.tickets.findFirstByConversationId(conversationId);
  if (ticketStub?.workspaceId) return ticketStub.workspaceId;
  const channel = await repositories.channels.findById(channelId).catch(() => null);
  return channel?.workspaceId ?? null;
}
