import { transaction } from '../base';
import type { AutomationContext } from '@/automations/types/context';
import { applyConversationLabel, archiveConversationMailbox } from '@/automations/services/conversation-label.service';
import { db } from '@/database/client';


export function executeTx(conversationId: string, channelId: string, labelName: string, createdById: string, config: { channelId: string; labelName: string; keepInInbox: boolean; conversationId: string; color?: string | undefined; labelId?: string | undefined; }, context: AutomationContext) {
  return transaction(['Channel', 'Conversation', 'ConversationLabel', 'ConversationLabelMapping', 'Ticket', 'TicketUserMailbox'], 'execute: conversation label apply and optional mailbox archive must commit atomically; tx is not ACL-wrapped', db, async tx => {
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
}
