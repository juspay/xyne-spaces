import { sanitizeMessageContent } from '@/utils/contentUtils';
import { authorCanSeeChannel } from '../util/author-access';
import { db } from '@/database/client';
import type { AutomationContext } from '../types/context';
import { z } from 'zod';
import { BaseActionStep } from './base-step';
import { StepCategory } from '../types/categories';
import { variableRef } from '../engine/variable-ref';
import { repositories } from '@/database/repositories';

const CreateEmailDraftConfigSchema = z.object({
  channelId: variableRef(z.string().min(1)).describe('Channel the draft belongs to.'),
  conversationId: variableRef(z.string().min(1)).describe('Conversation the draft belongs to.'),
  draftContent: variableRef(z.string().min(1)).describe('Draft body content.'),
});

const CreateEmailDraftOutputSchema = z.object({
  draftId: z.string(),
  conversationId: z.string(),
  channelId: z.string(),
});

interface CreateEmailDraftOutput extends Record<string, unknown> {
  draftId: string;
  conversationId: string;
  channelId: string;
}

export class CreateEmailDraftStep extends BaseActionStep<
  typeof CreateEmailDraftConfigSchema,
  CreateEmailDraftOutput
> {
  readonly type = 'CREATE_EMAIL_DRAFT';
  readonly configSchema = CreateEmailDraftConfigSchema;
  readonly outputSchema = CreateEmailDraftOutputSchema;
  readonly name = 'Create an email draft';
  readonly description =
    'Creates or updates the email draft for a conversation in a channel. Upserts by channel + conversation.';
  readonly category = StepCategory.MESSAGING;
  readonly icon = 'Mail';

  async execute(
    config: z.infer<typeof CreateEmailDraftConfigSchema>,
    context: AutomationContext,
  ): Promise<CreateEmailDraftOutput> {
    const conversation = await db.conversation.findFirst({
      where: {
        conversationId: config.conversationId as string,
        channelId: config.channelId as string,
        workspaceId: context.automation.workspaceId,
      },
      select: { channelId: true },
    });
    if (!conversation) {
      throw new Error('[CREATE_EMAIL_DRAFT] conversation is not in that channel in this workspace');
    }
    if (!(await authorCanSeeChannel(conversation.channelId, context.automation.createdById))) {
      throw new Error('[CREATE_EMAIL_DRAFT] channel is private and the automation author is not a participant');
    }
    const draft = await repositories.emailDrafts.upsertForChannelConversation({
      channelId: config.channelId as string,
      conversationId: config.conversationId as string,
      draftContent: sanitizeMessageContent(config.draftContent as string),
    });

    return {
      draftId: draft.id,
      // conversationId is now nullable on EmailDraft (compose drafts have none), but this
      // step always upserts by a concrete conversation, so fall back to the input.
      conversationId: draft.conversationId ?? (config.conversationId as string),
      channelId: draft.channelId,
    };
  }
}

export const createEmailDraftStep = new CreateEmailDraftStep();
