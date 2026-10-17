import { useCallback, useReducer, type ReactElement } from 'react';

import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';
import type { ChatMessageRow, ChatRow } from '../model/chatRow.types';
import { ForwardHost } from '../overlays/ForwardHost';
import { MessageActionsHost, type MessageActionsTarget } from '../overlays/MessageActionsHost';
import { EmojiPickerHost } from '../overlays/EmojiPickerHost';
import {
  EMPTY_OVERLAYS,
  overlayReducer,
  type OverlayAction,
  type OverlayState,
} from '../overlays/overlayReducer';
import { ReactionsHost, type ReactionsTarget } from '../overlays/ReactionsHost';
import { ReminderOptionsHost } from '../overlays/ReminderOptionsHost';
import {
  UserProfileActionsHost,
  type ProfileActionsTarget,
} from '../overlays/UserProfileActionsHost';
import { actionsTargetFor } from '../overlays/actionTarget';

export { EMPTY_OVERLAYS, overlayReducer };
export type { OverlayAction, OverlayState };

const liveMessageRow = (
  rows: readonly ChatRow[],
  conversationId: string,
  messageId: string | null,
): ChatMessageRow | null => {
  for (const row of rows) {
    if (row.type !== 'message') {
      continue;
    }
    if (
      messageId &&
      (row.model.messageId === messageId || row.model.conversationId === messageId)
    ) {
      return row;
    }
    if (row.model.conversationId === conversationId) {
      return row;
    }
  }
  return null;
};

const liveActionsTarget = (
  rows: readonly ChatRow[],
  target: MessageActionsTarget,
  threadId?: string,
): MessageActionsTarget => {
  const live = liveMessageRow(rows, target.row.model.conversationId, target.row.model.messageId);
  return live ? actionsTargetFor(live, threadId ?? target.threadId) : target;
};

const liveReactionsTarget = (
  rows: readonly ChatRow[],
  target: ReactionsTarget,
): ReactionsTarget => {
  const live = liveMessageRow(rows, target.messageId, target.messageId);
  return {
    messageId: target.messageId,
    reactionsMd: live?.model.reactionPreview?.md ?? target.reactionsMd,
  };
};

export type ChatOverlaysProps = {
  state: OverlayState;
  dispatch: (action: OverlayAction) => void;
  rows: readonly ChatRow[];
  threadId?: string;
  isThread: boolean;
  currentUserId: string | undefined;
  isChannelArchived: boolean;
  isFirstInThread: boolean;
  hasTicket: boolean;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
};

export function ChatOverlays({
  state,
  dispatch,
  rows,
  threadId,
  isThread,
  currentUserId,
  isChannelArchived,
  isFirstInThread,
  hasTicket,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
}: ChatOverlaysProps): ReactElement {
  const sheet = state.sheet;
  const actions = sheet.kind === 'actions' ? liveActionsTarget(rows, sheet.target, threadId) : null;
  const forward = sheet.kind === 'forward' ? liveActionsTarget(rows, sheet.target, threadId) : null;
  const remind = sheet.kind === 'remind' ? liveActionsTarget(rows, sheet.target, threadId) : null;
  const reactions = sheet.kind === 'reactions' ? liveReactionsTarget(rows, sheet.target) : null;
  const emojiPicker = sheet.kind === 'emoji' ? liveReactionsTarget(rows, sheet.target) : null;
  const profile: ProfileActionsTarget | null = sheet.kind === 'profile' ? sheet.target : null;
  const closeSheet = useCallback((): void => dispatch({ type: 'closeSheet' }), [dispatch]);

  const onEditInChat = useCallback(
    (payload: ChatInputEditingMessage): void => {
      dispatch({ type: 'startEdit', payload });
    },
    [dispatch],
  );
  const onForward = useCallback((): void => {
    if (actions) {
      dispatch({ type: 'openForward', target: actions });
    }
  }, [actions, dispatch]);
  const onRemind = useCallback((): void => {
    if (actions) {
      dispatch({ type: 'openRemind', target: actions });
    }
  }, [actions, dispatch]);
  const onMoreReactions = useCallback((): void => {
    const messageId = actions?.row.model.messageId;
    if (messageId) {
      dispatch({
        type: 'openEmoji',
        target: { messageId, reactionsMd: actions.reactionsMd },
      });
    }
  }, [actions, dispatch]);
  const onOpenChangeFalse = useCallback(
    (open: boolean): void => {
      if (!open) {
        closeSheet();
      }
    },
    [closeSheet],
  );
  const onBackToActions = useCallback((): void => {
    if (forward) {
      dispatch({ type: 'openActions', target: forward });
    }
  }, [dispatch, forward]);

  const remindKey = remind?.row.model.messageId ?? 'closed';

  return (
    <>
      <MessageActionsHost
        target={actions}
        isOpen={actions !== null}
        onOpenChange={onOpenChangeFalse}
        isThread={isThread}
        currentUserId={currentUserId}
        isChannelArchived={isChannelArchived}
        isFirstInThread={isFirstInThread}
        hasTicket={hasTicket}
        onEditInChat={onEditInChat}
        onForward={onForward}
        onRemind={onRemind}
        onMoreReactions={onMoreReactions}
        {...(onBeforeMarkUnread ? { onBeforeMarkUnread } : {})}
        {...(onMarkUnreadFailure ? { onMarkUnreadFailure } : {})}
      />
      <ForwardHost
        target={forward}
        isOpen={forward !== null}
        onOpenChange={onOpenChangeFalse}
        onBack={onBackToActions}
        currentUserId={currentUserId}
      />
      <ReminderOptionsHost
        key={remindKey}
        target={remind}
        isOpen={remind !== null}
        onOpenChange={onOpenChangeFalse}
      />
      <ReactionsHost
        target={reactions}
        isOpen={reactions !== null}
        onOpenChange={onOpenChangeFalse}
        currentUserId={currentUserId}
      />
      <EmojiPickerHost
        target={emojiPicker}
        isOpen={emojiPicker !== null}
        onOpenChange={onOpenChangeFalse}
        currentUserId={currentUserId}
      />
      <UserProfileActionsHost
        target={profile}
        isOpen={profile !== null}
        onOpenChange={onOpenChangeFalse}
      />
    </>
  );
}

export const useChatOverlays = (): {
  overlays: OverlayState;
  dispatchOverlays: (action: OverlayAction) => void;
} => {
  const [overlays, dispatchOverlays] = useReducer(overlayReducer, EMPTY_OVERLAYS);
  return { overlays, dispatchOverlays };
};
