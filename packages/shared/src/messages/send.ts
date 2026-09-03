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
  removePending,
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
  zero.mutate(
    mutators.draft.clearContent({
      channelId: ref.channelId,
      ...(ref.kind === 'thread' && { conversationId: ref.conversationId }),
      timestamp: Date.now(),
    }),
  );

  if (zeroStateAtSend !== 'connected') {
    return { messageId, conversationId };
  }

  const fireTimestamp = Date.now();
  updatePending(messageId, { mutatorFired: true, timestamp: fireTimestamp });

  // First fire only: when the caller passes no attachments we OMIT attachmentIds
  // so a send that under-specifies still hits the mutator's legacy draft-scan
  // fallback for this same compose context. The durable retry path
  // (firePendingMutator in pending.ts) deliberately does the opposite and always
  // passes attachmentIds, because a replay must not scavenge live draft state.
  const attachmentIds = attachments.map(a => a.attachmentId);
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
            ...(attachmentIds.length > 0 && { attachmentIds }),
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
            ...(attachmentIds.length > 0 && { attachmentIds }),
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
      if (outcome === 'ok') {
        removePending(messageId);
        emitMessageSent({
          ref,
          messageId,
          conversationId,
          isServerConfirmed: true,
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
