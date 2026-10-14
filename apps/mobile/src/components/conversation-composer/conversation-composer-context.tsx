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
import type { ChatPaintRow } from '@/src/features/chat/paint/chatPaint.types';

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
  paintRow?: ChatPaintRow | undefined;
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
