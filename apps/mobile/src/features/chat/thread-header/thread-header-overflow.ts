export type ThreadHeaderOverflowActionId =
  'start-call' | 'toggle-subscription' | 'take-notes' | 'thread-tags' | 'add-context';

export type ThreadHeaderOverflowAction = {
  id: ThreadHeaderOverflowActionId;
  label: string;
  disabled?: boolean;
  systemImage: 'phone' | 'bell' | 'bell.slash' | 'mic' | 'tag' | 'link';
};

export type ThreadHeaderOverflow = {
  actions: ThreadHeaderOverflowAction[];
  isSubscribed: boolean;
  isSubscriptionResolving: boolean;
  isTagsOpen: boolean;
  isContextOpen: boolean;
  closeContext: () => void;
  isCallOpen: boolean;
  closeCall: () => void;
  closeTags: () => void;
  handleAction: (id: ThreadHeaderOverflowActionId) => void;
};

export function getThreadHeaderOverflowActions(
  isSubscribed: boolean,
  options: {
    canEdit?: boolean;
    recordingActive?: boolean;
    recordingStarting?: boolean;
  } = {},
): ThreadHeaderOverflowAction[] {
  return [
    {
      id: 'start-call',
      label: 'Start thread call',
      systemImage: 'phone',
    },
    {
      id: 'toggle-subscription',
      label: isSubscribed ? 'Unsubscribe from notifications' : 'Subscribe to notifications',
      systemImage: isSubscribed ? 'bell.slash' : 'bell',
    },
    {
      id: 'take-notes',
      label: options.recordingActive ? 'Open recording' : 'Take notes',
      systemImage: 'mic',
      disabled:
        options.recordingStarting || (!options.recordingActive && options.canEdit === false),
    },
    {
      id: 'add-context',
      label: 'Add context to thread',
      systemImage: 'link',
      disabled: options.canEdit === false,
    },
    {
      id: 'thread-tags',
      label: 'Thread tags',
      systemImage: 'tag',
      disabled: options.canEdit === false,
    },
  ];
}

export function getThreadCallBlockReason(args: {
  canUseMemberActions: boolean;
  isInCall: boolean;
  currentCallChannelId: string | null | undefined;
  channelId: string;
  threadId?: string;
  currentConversationId?: string | null;
}): 'join-channel' | 'already-in-call' | null {
  if (!args.canUseMemberActions) return 'join-channel';
  const isUserInThisCall =
    args.currentCallChannelId === args.channelId &&
    (!args.threadId || args.currentConversationId === args.threadId);
  if (args.isInCall && !isUserInThisCall) return 'already-in-call';
  return null;
}

export function shouldBlockSubscriptionToggle(args: {
  threadId: string;
  isQueryResolving: boolean;
  isMutating: boolean;
  mutationInFlight: boolean;
}): boolean {
  return !args.threadId || args.isQueryResolving || args.isMutating || args.mutationInFlight;
}
