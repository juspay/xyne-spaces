import { MicrosoftDeskService } from '@/services/microsoftDeskService';
import {
  BaseMailReplySender,
  MailReplyContext,
  MailReplyResult,
  NewMailContext,
} from '../../core/baseMailReplySender';

/**
 * Graph reply sender. Uses the *latest* thread id — `createReply` on Graph
 * needs the most recent message in the conversation as its anchor.
 */
export class MicrosoftMailReplySender extends BaseMailReplySender {
  async sendReply(ctx: MailReplyContext): Promise<MailReplyResult> {
    const sender = MicrosoftDeskService.createEmailSender(ctx.encryptedCredentials, ctx.sourceId);
    return sender.replyToConversation({
      content: ctx.body,
      subject: ctx.subject,
      to: ctx.to,
      cc: ctx.cc,
      bcc: ctx.bcc,
      threadId: ctx.latestExternalThreadId,
      latestExternalMessageId: ctx.latestExternalMessageId,
      ...(ctx.fromEmailAddress && { fromEmailAddress: ctx.fromEmailAddress }),
      ...(ctx.fileAttachments?.length && { attachments: ctx.fileAttachments }),
    });
  }

  async sendNew(ctx: NewMailContext): Promise<MailReplyResult> {
    const sender = MicrosoftDeskService.createEmailSender(ctx.encryptedCredentials, ctx.sourceId);
    const { messageId, threadId } = await sender.sendNewEmail({
      subject: ctx.subject,
      content: ctx.body,
      to: ctx.to,
      cc: ctx.cc,
      bcc: ctx.bcc,
      ...(ctx.fromEmailAddress && { fromEmailAddress: ctx.fromEmailAddress }),
      ...(ctx.fileAttachments?.length && { attachments: ctx.fileAttachments }),
    });
    return { messageId, threadId };
  }
}
