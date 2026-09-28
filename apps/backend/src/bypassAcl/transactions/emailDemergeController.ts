import { transaction } from '../base';
import type { Conversation } from '@prisma/client';
import { EmailDemergeController } from '@/controllers/emailDemergeController';
import { syncTicketEmailCount } from '@/database/syncTicketEmailCount';


export function demergeEmailTx(self: EmailDemergeController, emailIdsToMove: any[], newConversation: Conversation, originalTicket: any) {
  return transaction(['Email', 'Ticket'], 'demergeEmail: email move plus ticket email-count syncs must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    await tx.email.updateMany({
      where: { id: { in: emailIdsToMove } },
      data: {
        conversationId: newConversation.conversationId,
      },
    });
    await syncTicketEmailCount(tx, originalTicket.conversationId);
    await syncTicketEmailCount(tx, newConversation.conversationId);
  });
}
