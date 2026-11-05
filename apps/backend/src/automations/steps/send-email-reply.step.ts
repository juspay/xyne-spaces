import { z } from 'zod';
import { ActivityType } from '@xyne/shared';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { emailService } from '@/services/emailService';
import { repositories } from '@/database/repositories';
import { DatabaseClient } from '@/database/client';
import { logger } from '@/utils/logger';
import { ChannelExternalSourceResolver } from '@/services/channelExternalSourceResolver';
import { ExternalSourcePlatform } from '@/integrations/core/types';
import type { OutgoingAttachment } from '@/integrations/core/baseMailReplySender';
import { appendReplyQuote } from '@/utils/replyQuote';
import { reattachTrailImages } from '@/utils/reattachTrailImages';
import {
  fileAttachmentsField,
  loadAttachmentFiles,
  saveEmailAttachmentRows,
} from '../services/trigger-attachment.service';

/** A CC/BCC entry resolves to one string (maybe comma-separated) or a list of such strings. */
const addressEntry = z.union([z.string().min(1), z.array(z.string())]);

/** Flatten entries, split comma/semicolon-separated strings, trim, and drop blanks and case-insensitive duplicates. */
function mergeAddresses(...lists: Array<ReadonlyArray<string | string[]> | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lists.flatMap(l => (l ?? []).flat())) {
    for (const addr of raw.split(/[,;]/)) {
      const a = addr.trim();
      if (a && !seen.has(a.toLowerCase())) {
        seen.add(a.toLowerCase());
        out.push(a);
      }
    }
  }
  return out;
}

const SendEmailReplyConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)),
  body: variableRef(z.string().min(1)),
  cc: z
    .array(variableRef(addressEntry))
    .optional()
    .describe(
      'Optional email addresses to copy on the reply. Each entry may be an address, a comma/semicolon-separated list, or a list of those. Added to, never replacing, the default copy list.',
    ),
  bcc: z
    .array(variableRef(addressEntry))
    .optional()
    .describe(
      'Optional email addresses to blind-copy on the reply. Each entry may be an address, a comma/semicolon-separated list, or a list of those. Added to, never replacing, the default blind-copy list.',
    ),
  replyAll: z.boolean().optional(),
  fileAttachments: fileAttachmentsField,
});

const SendEmailReplyOutputSchema = z.object({
  emailId: z.string(),
  threadId: z.string(),
  conversationId: z.string(),
});

interface SendEmailReplyOutput extends Record<string, unknown> {
  emailId: string;
  threadId: string;
  conversationId: string;
}

export class SendEmailReplyStep extends BaseActionStep<
  typeof SendEmailReplyConfigSchema,
  SendEmailReplyOutput
> {
  readonly type = 'SEND_EMAIL_REPLY';
  readonly configSchema = SendEmailReplyConfigSchema;
  readonly outputSchema = SendEmailReplyOutputSchema;
  readonly name = 'Send an email reply';
  readonly description =
    'Replies to the latest email on the conversation. Body supports {{...}} placeholders. Recipients are derived from the original message, with optional CC and BCC recipients.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Mail';

  async execute(
    config: z.infer<typeof SendEmailReplyConfigSchema>,
    context: AutomationContext,
  ): Promise<SendEmailReplyOutput> {
    const conversationId = config.conversationId as string;
    const body = config.body as string;
    const type = config.replyAll === true ? 'REPLY_ALL' : 'REPLY';
    const prisma = DatabaseClient.getInstance();

    // Gmail needs the trail built client-side; Graph's createReply quotes natively.
    let replyBody = body;
    let fileAttachments: OutgoingAttachment[] = [];
    const conversation = await repositories.conversations.findById(conversationId);
    const source = conversation
      ? await new ChannelExternalSourceResolver().resolveForChannel(conversation.channelId)
      : null;
    const emails = await repositories.emails.findByConversationId(conversationId); // newest first
    if (source?.sourceType === ExternalSourcePlatform.GOOGLE) {
      if (emails[0]) {
        replyBody = appendReplyQuote(body, emails[0]);
        fileAttachments = await reattachTrailImages({
          body: replyBody,
          excludeCids: [],
          priorAttachments: await repositories.messageAttachments.findByEmailIds(emails.map(e => e.id)),
        });
      }
    }
    const forwardedFiles = await loadAttachmentFiles(
      config.fileAttachments,
      context.automation.workspaceId,
    );
    fileAttachments.push(...forwardedFiles);

    // Configured addresses extend the default lists (REPLY_ALL keeps the original CCs); they never replace them.
    const configCc = config.cc as Array<string | string[]> | undefined;
    const configBcc = config.bcc as Array<string | string[]> | undefined;
    const defaultCc = type === 'REPLY_ALL' ? emails[emails.length - 1]?.cc : undefined;
    const cc = configCc?.length ? mergeAddresses(defaultCc, configCc) : undefined;
    const bcc = configBcc?.length ? mergeAddresses(configBcc) : undefined;

    const result = await emailService.sendReplyOnConversation({
      conversationId,
      body: replyBody,
      type,
      cc,
      bcc,
      ...(fileAttachments.length > 0 && { fileAttachments }),
    });

    if (conversation && forwardedFiles.length > 0) {
      await saveEmailAttachmentRows({
        files: forwardedFiles,
        emailId: result.emailId,
        conversationId,
        channelId: conversation.channelId,
        workspaceId: context.automation.workspaceId,
        userId: context.automation.createdById,
      }).catch(err =>
        logger.warn(
          `[automations] SEND_EMAIL_REPLY attachment rows failed email=${result.emailId}:`,
          err,
        ),
      );
    }

    logger.info(
      `[automations] SEND_EMAIL_REPLY ${type} via ${result.externalSourceType} conv=${conversationId} email=${result.emailId}`,
    );

    const ticket = await repositories.tickets.findFirstByConversationId(conversationId);
    if (ticket?.id) {
      prisma.ticketActivity.create({
        data: {
          ticketId: ticket.id,
          updatedBy: context.automation.createdById,
          workspaceId: context.automation.workspaceId,
          activityType: ActivityType.METADATA,
          value: { field: 'emailReply', emailId: result.emailId, isAutomation: true },
        },
      }).catch(err => logger.warn(`[automations] SEND_EMAIL_REPLY audit write failed conv=${conversationId}:`, err));
    }

    return {
      emailId: result.emailId,
      threadId: result.threadId,
      conversationId,
    };
  }
}

export const sendEmailReplyStep = new SendEmailReplyStep();
