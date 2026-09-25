import { transaction } from '../base';
import { AppDeskService } from '@/services/appDeskService';
import { Prisma, ExternalSource } from '@prisma/client';
import { EmailType, MessageDirection, ExternalEntityType, AttachmentEntityType } from '@xyne/shared';


export function sendAppReplyTx(self: AppDeskService, initialEmail: any, body: string, replierName: any, conversationId: string, conversation: any, threadId: any, scopedAckExternalId: string, userId: string, outboundConfigured: any, externalSource: ExternalSource, stagedAttachments: { id: string }[]) {
  return transaction(['Email', 'ExternalMessage', 'MessageAttachment'], 'sendAppReply: reply email, outbound external message and staged attachment links must commit atomically; tx is not ACL-wrapped', self.prisma, async (tx) => {
    const created = await tx.email.create({
      data: {
        type: EmailType.REPLY,
        subject: initialEmail.subject,
        body,
        to: [],
        from: replierName ?? 'Xyne',
        cc: [],
        bcc: [],
        conversationId,
        channelId: conversation.channelId,
        workspaceId: conversation.workspaceId,
        externalThreadId: threadId,
        externalMessageId: scopedAckExternalId,
        sentByUserId: userId,
      } as Prisma.EmailUncheckedCreateInput,
    });

    if (outboundConfigured) {
      await tx.externalMessage.create({
        data: {
          externalSourceId: externalSource.id,
          externalId: scopedAckExternalId,
          externalThreadId: threadId,
          messageId: created.id,
          entityId: created.id,
          workspaceId: conversation.workspaceId,
          direction: MessageDirection.OUTGOING,
          entityType: ExternalEntityType.EMAIL,
        },
      });
    }

    if (stagedAttachments.length > 0) {
      await tx.messageAttachment.updateMany({
        where: { id: { in: stagedAttachments.map(a => a.id) } },
        data: { entityType: AttachmentEntityType.EMAIL, entityId: created.id, conversationId },
      });
    }

    return created;
  });
}
