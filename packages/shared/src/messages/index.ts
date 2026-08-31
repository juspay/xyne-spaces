export type {
  ChannelRef,
  ConversationRef,
  ThreadRef,
} from './conversationRef.js';
export { refKey, draftLookupId } from './conversationRef.js';

export {
  getDraft,
  setDraft,
  clearDraft,
  subscribeDraft,
  useDraft,
  type Draft,
  type DraftInput,
} from './draft.js';

export {
  sendMessage,
  type SendPayload,
  type SendResult,
} from './send.js';

export { subscribeSendLifecycle } from './mutationLifecycle.js';

export {
  getMessagesSnapshot,
  getChannelSnapshot,
  getThreadSnapshot,
  subscribeMessages,
  primeChannelCache,
  primeThreadCache,
} from './messages.js';

export { Conversation, conversationFor } from './Conversation.js';

export {
  useMessages,
  serializeInitialLoadError,
  type UseMessagesOptions,
  type UseChannelMessagesResult,
} from './useMessages.js';

export {
  compareConversations,
  dedupeAndSortConversations,
  mergeCachedConversations,
  mergeConversationsWithLatest,
  reconcileConversationWindow,
} from './channelMessageMerge.js';

export {
  subscribeMessageSent,
  type MessageSentEvent,
} from './events.js';

export {
  addPending,
  removePending,
  updatePending,
  getAllPending,
  getPendingForChannel,
  getPendingForThread,
  subscribePending,
  getStatus,
  firePendingMutator,
  isAutoRetryEligible,
  getCurrentSessionId,
  type PendingMessage,
  type PendingStatus,
  type PendingKind,
  type ZeroStateName,
  type PendingAttachment,
} from './pending.js';

export { usePendingQueue } from './usePendingQueue.js';
export {
  usePendingForChannel,
  usePendingForThread,
  usePendingByMessageId,
  usePendingStatusByMessageId,
} from './usePending.js';
export {
  buildPendingChannelConversation,
  buildPendingThreadMessage,
} from './pendingRows.js';
