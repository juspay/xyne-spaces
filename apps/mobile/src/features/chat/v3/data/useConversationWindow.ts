import { useRef } from 'react';
import {
  getChannelSnapshot,
  getThreadSnapshot,
  useMessages,
  type ConversationRef,
  type UseMessagesOptions,
} from '@xyne/shared/messages';

import type { OpenIntent } from '../intent/openIntent.types';
import type { LandingTarget } from '../machine/openState';
import { conversationRefFor } from './conversationRef';
import { createdAtFromSnapshotRows, messagesOptionsFor } from './messagesOptions';
import {
  isSameConversationWindow,
  normalizeConversationWindow,
  type ChannelWindowSource,
  type ConversationWindow,
  type ThreadWindowSource,
} from './normalizeConversationWindow';

export type { ConversationWindow };

type MessagesResult = ChannelWindowSource | ThreadWindowSource;

/**
 * Public overloads are `ChannelRef` / `ThreadRef` only. The implementation
 * already accepts `ConversationRef`. One unconditional call — C5 remounts
 * when kind changes.
 */
const useMessagesForRef = useMessages as (
  ref: ConversationRef,
  opts?: UseMessagesOptions,
) => MessagesResult;

const snapshotRowsFor = (ref: ConversationRef): readonly unknown[] => {
  if (ref.kind === 'thread') {
    const snapshot = getThreadSnapshot(ref);
    if (!snapshot || typeof snapshot !== 'object') {
      return [];
    }
    const messages = (snapshot as { messages?: unknown }).messages;
    return Array.isArray(messages) ? messages : [];
  }
  const rows = getChannelSnapshot(ref);
  return Array.isArray(rows) ? rows : [];
};

/**
 * Timestamp to fetch around for a named message.
 * 0 = unknown. Do not call `useMessages` yet — a 0 cursor latches the latest
 * page and the notified row is never fetched.
 */
export const aroundCursorFor = (intent: OpenIntent, target: LandingTarget): number => {
  if (target.kind !== 'anchor') {
    return 0;
  }
  if (target.createdAt > 0) {
    return target.createdAt;
  }
  const messageId = intent.hint.messageId;
  if (!messageId) {
    return 0;
  }
  return createdAtFromSnapshotRows(snapshotRowsFor(conversationRefFor(intent)), messageId);
};

/**
 * The only message-window hook the list consumes (design §5.4).
 * Mount for a named message only after `aroundCursorFor` is known.
 */
export const useConversationWindow = (
  intent: OpenIntent,
  target: LandingTarget,
): ConversationWindow => {
  const ref = conversationRefFor(intent);
  const next = normalizeConversationWindow(
    ref,
    useMessagesForRef(ref, messagesOptionsFor(intent, target, aroundCursorFor(intent, target))),
  );
  const prevRef = useRef(next);
  if (!isSameConversationWindow(prevRef.current, next)) {
    prevRef.current = next;
  }
  return prevRef.current;
};
