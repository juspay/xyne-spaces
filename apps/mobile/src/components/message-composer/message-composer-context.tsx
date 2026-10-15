import { createContext, useContext } from 'react';
import type { User } from '@xyne/shared';

import type { MessageItem } from './message-composer.types';
import type { MessageKind } from './utils/getMessageKind';

export type MessageComposerContentVariant = 'primary' | 'activity';

type MessageComposerContextValue = {
  item: MessageItem;
  previousMessage: MessageItem | undefined;
  currentUser: User | undefined;
  kind: MessageKind;
  isContinuation: boolean;
  contentVariant: MessageComposerContentVariant;
};

const MessageComposerContext = createContext<MessageComposerContextValue | null>(null);

const useMessageComposer = (): MessageComposerContextValue => {
  const ctx = useContext(MessageComposerContext);
  if (!ctx) {
    throw new Error('useMessageComposer must be used within <MessageComposer.Root>');
  }
  return ctx;
};

export { MessageComposerContext, useMessageComposer };
