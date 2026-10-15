export type ThreadHeaderOverflowActionId = 'start-call' | 'toggle-subscription';

export type ThreadHeaderOverflowAction = {
  id: ThreadHeaderOverflowActionId;
  label: string;
  systemImage: 'phone' | 'bell' | 'bell.slash';
};

export type ThreadHeaderOverflow = {
  actions: ThreadHeaderOverflowAction[];
  isSubscribed: boolean;
  isSubscriptionResolving: boolean;
  handleAction: (id: ThreadHeaderOverflowActionId) => void;
};

export function getThreadHeaderOverflowActions(
  isSubscribed: boolean,
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
  ];
}

export function getThreadCallBlockReason(args: {
  canUseMemberActions: boolean;
  isInCall: boolean;
  currentCallExternalId: string | null | undefined;
  channelId: string;
}): 'join-channel' | 'already-in-call' | null {
  if (!args.canUseMemberActions) return 'join-channel';
  const isUserInThisCall = args.currentCallExternalId === args.channelId;
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
