import type { ConversationRef, UseChannelMessagesResult } from '@xyne/shared/messages';

export type Conversation = UseChannelMessagesResult['messages'][number];

/** Design §5.4 — the only window shape the list consumes. */
export type ConversationWindow = {
  conversations: readonly Conversation[];
  isInitialLoadComplete: boolean;
  hasReachedStart: boolean;
  initialLoadError: string | null;
  loadOlder: () => void;
  loadNewer: () => void;
  retry: () => void;
};

export type ChannelWindowSource = {
  messages: readonly Conversation[];
  isInitialLoadComplete: boolean;
  hasReachedChannelStart: boolean;
  initialLoadError: string | null;
  loadOlder: () => void;
  loadNewer: () => void;
  retryInitialLoad: () => void;
};

export type ThreadWindowSource = { readonly messages: readonly Conversation[] } | null;

const NOOP = (): void => undefined;

const EMPTY_CONVERSATIONS: readonly Conversation[] = [];

export const EMPTY_WINDOW: ConversationWindow = {
  conversations: EMPTY_CONVERSATIONS,
  isInitialLoadComplete: false,
  hasReachedStart: false,
  initialLoadError: null,
  loadOlder: NOOP,
  loadNewer: NOOP,
  retry: NOOP,
};

const EMPTY_THREAD_WINDOW: ConversationWindow = {
  conversations: EMPTY_CONVERSATIONS,
  isInitialLoadComplete: false,
  hasReachedStart: false,
  initialLoadError: null,
  loadOlder: NOOP,
  loadNewer: NOOP,
  retry: NOOP,
};

export const isSameConversationWindow = (a: ConversationWindow, b: ConversationWindow): boolean =>
  a.conversations === b.conversations &&
  a.isInitialLoadComplete === b.isInitialLoadComplete &&
  a.hasReachedStart === b.hasReachedStart &&
  a.initialLoadError === b.initialLoadError &&
  a.loadOlder === b.loadOlder &&
  a.loadNewer === b.loadNewer &&
  a.retry === b.retry;

/** Normalise the two `useMessages` overloads into the §5.4 window. Pure. */
export const normalizeConversationWindow = (
  ref: ConversationRef,
  result: ChannelWindowSource | ThreadWindowSource,
): ConversationWindow => {
  if (ref.kind === 'channel') {
    const channel = result as ChannelWindowSource;
    return {
      conversations: channel.messages,
      isInitialLoadComplete: channel.isInitialLoadComplete,
      hasReachedStart: channel.hasReachedChannelStart,
      initialLoadError: channel.initialLoadError,
      loadOlder: channel.loadOlder,
      loadNewer: channel.loadNewer,
      retry: channel.retryInitialLoad,
    };
  }
  const thread = result as ThreadWindowSource;
  if (thread === null) {
    return EMPTY_THREAD_WINDOW;
  }
  const hasMessages = thread.messages.length > 0;
  return {
    conversations: thread.messages,
    // v2: empty thread object is still hydrating (`!thread` vs query complete).
    // Marking `{ messages: [] }` complete makes activity opens ready+empty.
    isInitialLoadComplete: hasMessages,
    hasReachedStart: hasMessages,
    initialLoadError: null,
    loadOlder: NOOP,
    loadNewer: NOOP,
    retry: NOOP,
  };
};
