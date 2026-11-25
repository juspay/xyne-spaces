import {
  UnreadableString,
  buildInitialMessageMd,
  initialMessageMdTemplate,
  isCiphertextValue,
  reveal,
  type InitialMessageMdInput,
} from '@xyne/shared';
import { compose } from './compose';

/**
 * `conversations.initial_message_md` for a conversation's first message, as the server holds that
 * message: the value to store.
 *
 * Content held as plaintext (the usual case: reads decrypt): built here, and the database encrypts
 * the whole block on write. Content held as ciphertext (under DEK passthrough, e.g. a bot's post
 * through the ingress transit proxy, which arrives encrypted): built by the encryption service
 * (`initialMessageMdTemplate`), which returns it encrypted, stored as it is. Built here, that block
 * would embed the content's ciphertext and the database would encrypt it again; the client could
 * open only the outer layer and would show `ENC:v1|…` in the channel list.
 *
 * `current`, the stored value, lets an unchanged rebuild return it as it is, so callers that compare
 * before writing can skip the write (two encryptions of the same block never compare equal).
 */
export async function initialMessageMdFor(
  msg: InitialMessageMdInput,
  current?: string | null,
): Promise<string | null> {
  if (!isCiphertextValue(msg.content)) return buildInitialMessageMd(msg);

  const workspaceId = msg.workspaceId;
  if (!workspaceId) {
    throw new Error('initial_message_md: the message content is encrypted, but its workspace is unknown');
  }
  // Defaults as buildInitialMessageMd's, so both ways serialize the same block.
  const result = await compose(
    {
      template: initialMessageMdTemplate,
      inputs: {
        messageId: msg.messageId,
        conversationId: msg.conversationId,
        workspaceId,
        senderId: msg.senderId,
        content: UnreadableString.make(msg.content),
        msgType: msg.msgType,
        hasAttachment: msg.hasAttachment ?? false,
        edited: msg.edited ?? false,
        isDeleted: msg.isDeleted ?? false,
        showInChannel: msg.showInChannel ?? false,
        visibleTo: msg.visibleTo ?? null,
        createdAt: msg.createdAt,
        metadata: msg.metadata ?? null,
        nudgeCount: msg.nudgeCount ?? null,
        isSent: msg.isSent ?? false,
        reactions_md: msg.reactions_md ?? null,
        link_preview_md: msg.link_preview_md ?? null,
        childConversationId: msg.childConversationId ?? null,
      },
      current: isCiphertextValue(current) ? UnreadableString.make(current) : null,
    },
    { workspaceId },
  );
  return result.unchanged ? (current ?? null) : reveal(result.value);
}
