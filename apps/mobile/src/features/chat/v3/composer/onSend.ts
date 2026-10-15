import type { Zero } from '@rocicorp/zero';
import { sendMessage, type ConversationRef } from '@xyne/shared/messages';

export type OnSendPayload = {
  text: string;
  /** Already normalized HTML, or null when the body is empty. */
  content: string | null;
  attachments: readonly {
    attachmentId: string;
    originalFilename: string;
    mimetype: string;
    size: number;
    width?: number;
    height?: number;
    status: string;
  }[];
  alsoSendToChannel?: boolean;
};

export type OnSendDeps = {
  zero: Zero;
  ref: ConversationRef;
  createId: () => string;
  sendMessage?: (
    zero: Zero,
    ref: ConversationRef,
    payload: Parameters<typeof sendMessage>[2],
  ) => ReturnType<typeof sendMessage>;
};

/**
 * C14 / B4: the composer never decides whether a send is possible.
 * HTML normalization stays in the view so this file stays Expo-free.
 */
export const onSend = (
  deps: OnSendDeps,
  payload: OnSendPayload,
): { messageId: string; conversationId: string } | null => {
  const uploaded = payload.attachments.filter(item => item.status === 'uploaded');
  const content = payload.content ?? (uploaded.length > 0 ? '<p></p>' : null);
  if (content === null) {
    return null;
  }

  const send = deps.sendMessage ?? sendMessage;
  const isThread = deps.ref.kind === 'thread';
  return send(deps.zero, deps.ref, {
    content,
    text: payload.text,
    messageId: deps.createId(),
    // Channel sends mint a conversation. Thread sends must *not* — a new id
    // creates a separate channel conversation, so the reply never appears here.
    ...(isThread ? {} : { conversationId: deps.createId() }),
    ...(payload.alsoSendToChannel ? { alsoSendToChannel: true } : {}),
    ...(uploaded.length > 0
      ? {
          attachments: uploaded.map(item => ({
            attachmentId: item.attachmentId,
            originalFilename: item.originalFilename,
            mimetype: item.mimetype,
            size: item.size,
            ...(item.width !== undefined ? { width: item.width } : {}),
            ...(item.height !== undefined ? { height: item.height } : {}),
          })),
        }
      : {}),
  });
};
