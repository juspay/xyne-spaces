import { transaction } from '../base';
import { applyConversationLabel, archiveConversationMailbox } from '@/automations/services/conversation-label.service';
import { ResolvedBackfillRule } from '@/automations/services/desk-label-backfill.service';
import { db } from '@/database/client';


export function runDeskLabelBackfillTx(needsLabel: boolean, conversationId: string, rule: ResolvedBackfillRule) {
  return transaction(['Channel', 'Conversation', 'ConversationLabel', 'ConversationLabelMapping', 'Ticket', 'TicketUserMailbox'], 'runDeskLabelBackfill: label apply plus mailbox archive must commit atomically; tx is not ACL-wrapped', db, async tx => {
    const result = needsLabel
      ? await applyConversationLabel(
          {
            conversationId,
            channelId: rule.channelId,
            labelName: rule.labelName,
            createdById: rule.ownerId,
            color: rule.color,
            labelId: rule.labelId,
          },
          tx,
        )
      : null;
    if (!rule.keepInInbox) {
      await archiveConversationMailbox(
        {
          conversationId,
          channelId: rule.channelId,
          workspaceId: rule.workspaceId,
          userId: rule.ownerId,
        },
        tx,
      );
    }
    return result;
  });
}
