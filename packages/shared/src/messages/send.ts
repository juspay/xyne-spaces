import { v4 as uuidv4 } from 'uuid';
import type { Zero } from '@rocicorp/zero';
import { MessageType } from '../zero/schema.js';
import type { EntityLinkContextInput } from '../sdlc.js';
import { mutators } from '../zero/mutators.js';
import type { ConversationRef } from './conversationRef.js';
import { clearDraft } from './draft.js';
import { emitMessageSent } from './events.js';
import { subscribeSendLifecycle } from './mutationLifecycle.js';
import {
  addPending,
  getCurrentSessionId,
  updatePending,
  type PendingAttachment,
  type ZeroStateName,
} from './pending.js';

export type SendPayload = {
  content: string;
  text?: string;
  alsoSendToChannel?: boolean;
  type?: MessageType;
  messageId?: string;
  conversationId?: string;
  timestamp?: number;
  attachments?: PendingAttachment[];
  entityLinkContext?: EntityLinkContextInput;
};

export type SendResult = {
  messageId: string;
  conversationId: string;
};

export function sendMessage(
  zero: Zero,
  ref: ConversationRef,
  payload: SendPayload,
): SendResult {
  const messageId = payload.messageId ?? uuidv4();
  const conversationId =
    ref.kind === 'thread'
      ? ref.conversationId
      : payload.conversationId ?? uuidv4();
  const timestamp = payload.timestamp ?? Date.now();
  const type = payload.type ?? MessageType.USER;

  clearDraft(ref);

  let childConversationId: string | undefined;
  if (ref.kind === 'thread' && payload.alsoSendToChannel) {
    childConversationId = uuidv4();
  }

  const zeroStateAtSend = zero.connection.state.current.name as ZeroStateName;
  const senderId = zero.userID;
  if (!senderId) throw new Error('sendMessage: Zero has no userID');

  const attachments = payload.attachments ?? [];
  addPending({
    messageId,
    conversationId,
    channelId: ref.channelId,
    workspaceId: zero.context.workspaceId ?? null,
    kind: ref.kind,
    senderId,
    content: payload.content,
    text: payload.text ?? '',
    timestamp,
    type,
    ...(payload.alsoSendToChannel !== undefined && {
      alsoSendToChannel: payload.alsoSendToChannel,
    }),
    ...(childConversationId !== undefined && { childConversationId }),
    ...(attachments.length > 0 && { attachments }),
    ...(payload.entityLinkContext !== undefined && { entityLinkContext: payload.entityLinkContext }),
    sessionId: getCurrentSessionId(),
    zeroStateAtSend,
    mutatorFired: false,
    mutatorAppError: false,
  });

  // Detach the draft from the queued message so cross-device draft state
  // stops showing text that has already been handed to pending. Queued along
  // with the send mutator when offline (Zero applies both optimistically
  // and replays them in order on reconnect).
  //
  // The attachment ids go with it: clearContent re-points them off the draft so
  // a send the server later rejects does not hand its files back to the
  // composer. It has to happen here rather than inside the send mutator,
  // because that claim is part of the send and is rolled back with it.
  const claimedAttachmentIds = attachments.map(a => a.attachmentId);
  zero.mutate(
    mutators.draft.clearContent({
      channelId: ref.channelId,
      ...(ref.kind === 'thread' && { conversationId: ref.conversationId }),
      timestamp: Date.now(),
      ...(claimedAttachmentIds.length > 0 && { claimedAttachmentIds, messageId }),
    }),
  );

  if (zeroStateAtSend !== 'connected') {
    return { messageId, conversationId };
  }

  const fireTimestamp = Date.now();
  updatePending(messageId, { mutatorFired: true, timestamp: fireTimestamp });

  // ALWAYS passed, even empty. Omitting it drops the mutator into its legacy
  // draft-scan fallback, which claims whatever DRAFT attachments sit on this
  // compose context right now. That is unsafe once a failed send can persist:
  // its attachments stay DRAFT-typed (the server never promoted them), so a
  // later unrelated send would scavenge them onto itself and the failed
  // message's retry would reference attachments it no longer owns. Passing the
  // exact ids — including none — makes ownership explicit. firePendingMutator
  // does the same on replay.
  const attachmentIds = claimedAttachmentIds;
  const mutation =
    ref.kind === 'channel'
      ? zero.mutate(
          mutators.conversations.send({
            channelId: ref.channelId,
            content: payload.content,
            conversationId,
            messageId,
            timestamp: fireTimestamp,
            type,
            attachmentIds,
            ...(payload.entityLinkContext !== undefined && {
              entityLinkContext: payload.entityLinkContext,
            }),
          }),
        )
      : zero.mutate(
          mutators.messages.send({
            conversationId,
            content: payload.content,
            type,
            timestamp: fireTimestamp,
            messageId,
            attachmentIds,
            ...(payload.alsoSendToChannel !== undefined && {
              showInChannel: payload.alsoSendToChannel,
            }),
            ...(childConversationId !== undefined && { childConversationId }),
          }),
        );

  subscribeSendLifecycle(
    mutation,
    () => {
      // Failed sends stay in the pending queue (mutatorAppError), which renders
      // the failed-message UI with retry/delete. The message is no longer lost,
      // so we neither restore the draft nor surface a separate failure popup.
      updatePending(messageId, { mutatorAppError: true });
    },
    outcome => {
      if (outcome === 'client-applied') {
        emitMessageSent({
          ref,
          messageId,
          conversationId,
          isClientApplied: true,
          ...(payload.alsoSendToChannel !== undefined && {
            showInChannel: payload.alsoSendToChannel,
          }),
          ...(childConversationId !== undefined && { childConversationId }),
        });
      }
    },
  );

  return { messageId, conversationId };
}
