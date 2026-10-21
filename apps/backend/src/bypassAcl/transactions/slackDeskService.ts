import { transaction } from '../base';
import type { Email } from '@prisma/client';
import { SlackDeskService } from '@/services/slackDeskService';
import { Prisma } from '@prisma/client';
import { EmailType, MessageDirection, ExternalEntityType } from '@xyne/shared';


export function sendSlackReplyTx(self: SlackDeskService, initialEmail: Email, hasText: boolean, body: string, senderName: string, conversationId: string, conversation: any, threadTs: any, messageTs: string, userId: string, externalSource: any) {
  return transaction(['Email', 'ExternalMessage'], 'sendSlackReply: the outbound reply email row and its ExternalMessage link must commit together; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const created = await tx.email.create({
      data: {
        type: EmailType.REPLY,
        subject: initialEmail.subject,
        body: hasText ? body : '',
        to: [],
        from: senderName,
        cc: [],
        bcc: [],
        conversationId,
        channelId: conversation.channelId,
        workspaceId: conversation.workspaceId,
        externalThreadId: threadTs,
        externalMessageId: messageTs,
        sentByUserId: userId,
      } as Prisma.EmailUncheckedCreateInput,
    });

    await tx.externalMessage.create({
      data: {
        externalSourceId: externalSource.id,
        externalId: messageTs,
        externalThreadId: threadTs,
        messageId: created.id,
        entityId: created.id,
        workspaceId: conversation.workspaceId,
        direction: MessageDirection.OUTGOING,
        entityType: ExternalEntityType.EMAIL,
      },
    });

    return created;
  });
}
