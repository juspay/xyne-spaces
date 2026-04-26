import { GoogleService } from '@/services/googleService';
import {
  BaseMailReplySender,
  MailReplyContext,
  MailReplyResult,
} from '../../core/baseMailReplySender';

/**
 * Gmail reply sender. Uses the *initial* thread id — Gmail's `users.messages.send`
 * threads correctly when given the first message's thread id (not the latest).
 */
export class GoogleMailReplySender extends BaseMailReplySender {
  async sendReply(ctx: MailReplyContext): Promise<MailReplyResult> {
    const sender = GoogleService.createEmailSender(ctx.encryptedCredentials, ctx.sourceId);
    return sender.replyToConversation({
      content: ctx.body,
      subject: ctx.subject,
      to: ctx.to,
      cc: ctx.cc,
      bcc: ctx.bcc,
      threadId: ctx.initialExternalThreadId,
      latestExternalMessageId: ctx.latestExternalMessageId,
      ...(ctx.fileAttachments?.length && { attachments: ctx.fileAttachments }),
    });
  }
}
