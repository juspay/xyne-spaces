import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { KeyboardController } from 'react-native-keyboard-controller';
import type { ChannelScopeType } from '@xyne/shared';

import type { ConversationItem } from '@/src/features/chat/v2/components/conversation-composer';
import {
  conversationItemToActionsTarget,
  useMessageActions,
} from '@/src/features/chat/v2/components/message-actions-sheet';

import type { SwipeActionId } from '../model/swipe-actions';

type RunSwipeAction = (conversation: ConversationItem, action: SwipeActionId) => void;

const RunSwipeActionContext = createContext<RunSwipeAction | null>(null);

/** Runs a swiped row's action; null where rows may not be swiped (outside the room). */
export function useRunSwipeAction(): RunSwipeAction | null {
  return useContext(RunSwipeActionContext);
}

type ActionScope = {
  currentUserId: string | undefined;
  isChannelArchived: boolean;
  channelName?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
};

type SwipeRequest = { key: number; conversation: ConversationItem; action: SwipeActionId };

/**
 * Lets the room's rows run "Reply in thread" and "Ask Xyne about this" from a
 * swipe. Those handlers live in the hold menu's `useMessageActions`, keyed on
 * one message, so each swipe mounts a one-off run of that hook for its
 * message, runs the action it names (only when the hold menu would show it)
 * and unmounts.
 */
export function SwipeActionRunnerProvider({
  children,
  ...scope
}: ActionScope & { children: ReactNode }): ReactElement {
  const [request, setRequest] = useState<SwipeRequest | null>(null);
  const nextKey = useRef(0);
  const run = useCallback<RunSwipeAction>((conversation, action) => {
    nextKey.current += 1;
    setRequest({ key: nextKey.current, conversation, action });
  }, []);
  const finish = useCallback((): void => setRequest(null), []);

  return (
    <RunSwipeActionContext.Provider value={run}>
      {children}
      {request ? (
        <SwipeActionRun key={request.key} request={request} scope={scope} onDone={finish} />
      ) : null}
    </RunSwipeActionContext.Provider>
  );
}

// No sheet is open, so whatever would run after it closes runs now.
const closeNow = (afterDismiss?: () => void): void => afterDismiss?.();
const NOOP = (): void => undefined;

function SwipeActionRun({
  request,
  scope,
  onDone,
}: {
  request: SwipeRequest;
  scope: ActionScope;
  onDone: () => void;
}): null {
  const { currentUserId, isChannelArchived, channelName, channelScopeType } = scope;
  const target = useMemo(
    () =>
      conversationItemToActionsTarget(request.conversation, currentUserId, {
        isChannelArchived,
        channelName,
        channelScopeType,
      }),
    [channelName, channelScopeType, currentUserId, isChannelArchived, request.conversation],
  );
  const actions = useMessageActions({
    target,
    currentUserId,
    context: 'channel',
    closeActionSheet: closeNow,
    openForward: NOOP,
  });
  const action = actions.find(candidate => candidate.id === request.action && candidate.visible);

  // A run fires once, even if the hook's data settles before `onDone` unmounts it.
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (action) {
      // The hold menu puts the keyboard away before any action; so does a swipe.
      if (KeyboardController.isVisible()) void KeyboardController.dismiss();
      action.onPress();
    }
    onDone();
  }, [action, onDone]);

  return null;
}
