import { createContext, useContext } from 'react';
import type {
  ChannelScopeType,
  ForwardedMessageData,
  InitialMessageSummary,
  ParentMessageSummary,
  User,
} from '@xyne/shared';

import type { ConversationItem } from './conversation-composer.types.js';
import type { ConversationKind } from './utils/getConversationKind.js';
import type { ChatPaintRow } from '@/src/features/chat/v2/paint/chatPaint.types';

export type ConversationComposerContentVariant = 'primary' | 'activity';

type ConversationComposerContextValue = {
  item: ConversationItem;
  currentUser: User | undefined;
  kind: ConversationKind;
  channelType: ChannelScopeType | undefined;
  summary: InitialMessageSummary | null;
  forwarded: ForwardedMessageData | null;
  parentMessage: ParentMessageSummary | null;
  contentVariant: ConversationComposerContentVariant;
  allowMediaHydration: boolean;
  allowInlineEmojiHydration: boolean;
  isContentExpanded: boolean;
  onContentExpanded?: ((conversationId: string) => void) | undefined;
  /** Press handler scoped to the embedded ticket card only (not the whole bubble). */
  onTicketPress?: (() => void) | undefined;
  onTicketLongPress?: (() => void) | undefined;
  paintRow?: ChatPaintRow | undefined;
  /** Inner controls (Approve, Read more) call this so the bubble does not open the thread. */
  suppressBubblePress: () => void;
  /** Bubble onPress returns true once if an inner control already handled this gesture. */
  shouldIgnoreBubblePress: () => boolean;
};

const ConversationComposerContext = createContext<ConversationComposerContextValue | null>(null);

const useConversationComposer = (): ConversationComposerContextValue => {
  const ctx = useContext(ConversationComposerContext);
  if (!ctx) {
    throw new Error('useConversationComposer must be used within <ConversationComposer.Root>');
  }
  return ctx;
};

export { ConversationComposerContext, useConversationComposer };
