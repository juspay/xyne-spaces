import { z } from 'zod';
import { db } from '@/database/client';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import type { AutomationContext } from '../types/context';
import { variableRef } from '../engine/variable-ref';
import { logger } from '@/utils/logger';
import {
  applyConversationLabel,
  archiveConversationMailbox,
} from '../services/conversation-label.service';

const ApplyConversationLabelConfigSchema = z.object({
  conversationId: variableRef(z.string().min(1)).describe(
    'Conversation (email thread) to label. Defaults to the email/ticket conversation from the trigger.',
  ),
  channelId: variableRef(z.string().min(1)).describe('Desk channel that owns the label catalog.'),
  labelName: z
    .string()
    .min(1)
    .describe('Label name to apply. Created in your catalog if it does not exist yet.'),
  color: z.string().optional().describe('Optional hex color for a newly created label.'),
  labelId: z
    .string()
    .optional()
    .describe('Optional existing label id. Missing labels are skipped instead of recreated.'),
  keepInInbox: z
    .boolean()
    .optional()
    .default(true)
    .describe('Keep the owner’s matching email in Inbox when enabled.'),
});

const ApplyConversationLabelOutputSchema = z.object({
  conversationId: z.string().nullable(),
  channelId: z.string().nullable(),
  labelId: z.string().nullable(),
  labelName: z.string(),
  applied: z.boolean(),
  alreadyPresent: z.boolean(),
  skipped: z.boolean(),
  skipReason: z.string().nullable(),
});

const SKIPPABLE_LABEL_ERROR_CODES = new Set([
  'channel_not_found',
  'label_not_found',
  'label_id_mismatch',
  'conversation_not_found',
  'conversation_channel_mismatch',
  'conversation_workspace_mismatch',
  'ticket_not_found',
  'ticket_channel_mismatch',
  'ticket_workspace_mismatch',
]);

interface ApplyConversationLabelOutput extends Record<string, unknown> {
  conversationId: string | null;
  channelId: string | null;
  labelId: string | null;
  labelName: string;
  applied: boolean;
  alreadyPresent: boolean;
  skipped: boolean;
  skipReason: string | null;
}

export class ApplyConversationLabelStep extends BaseActionStep<
  typeof ApplyConversationLabelConfigSchema,
  ApplyConversationLabelOutput
> {
  readonly type = 'APPLY_CONVERSATION_LABEL';
  readonly configSchema = ApplyConversationLabelConfigSchema;
  readonly outputSchema = ApplyConversationLabelOutputSchema;
  readonly name = 'Add or update email label';
  readonly description =
    'Applies a conversation (email thread) label from your private Desk catalog. Creates the label if needed.';
  readonly category = StepCategory.TICKET;
  readonly icon = 'Tag';

  async execute(
    config: z.infer<typeof ApplyConversationLabelConfigSchema>,
    context: AutomationContext,
  ): Promise<ApplyConversationLabelOutput> {
    const labelName = config.labelName.trim();
    const conversationId = config.conversationId.trim() || null;
    const channelId = config.channelId.trim() || null;
    const createdById = context.automation.createdById;

    const skipped = (reason: string): ApplyConversationLabelOutput => ({
      conversationId,
      channelId,
      labelId: null,
      labelName,
      applied: false,
      alreadyPresent: false,
      skipped: true,
      skipReason: reason,
    });

    if (!labelName) return skipped('empty_label_name');
    if (!conversationId) return skipped('missing_conversation_id');
    if (!channelId) return skipped('missing_channel_id');
    if (!createdById) return skipped('missing_owner');

    try {
      const result = await db.$transaction(async tx => {
        const applied = await applyConversationLabel(
          {
            conversationId,
            channelId,
            labelName,
            createdById,
            color: config.color,
            labelId: config.labelId,
          },
          tx,
        );
        if (config.keepInInbox === false) {
          await archiveConversationMailbox(
            {
              conversationId,
              channelId,
              workspaceId: context.automation.workspaceId,
              userId: createdById,
            },
            tx,
          );
        }
        return applied;
      });
      logger.info(
        `[automations] APPLY_CONVERSATION_LABEL conversationId=${conversationId} label=${labelName} applied=${result.applied} alreadyPresent=${result.alreadyPresent}`,
      );
      return {
        ...result,
        skipped: false,
        skipReason: null,
      };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code && SKIPPABLE_LABEL_ERROR_CODES.has(code)) return skipped(code);
      throw err;
    }
  }
}

export const applyConversationLabelStep = new ApplyConversationLabelStep();
