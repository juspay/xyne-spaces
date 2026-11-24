import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, type ReactElement } from 'react';
import { Alert, View } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { v4 as uuidv4 } from 'uuid';

import type { ChatInputSendHandler } from '@/src/components/input-composer';
import { CallTranscriptCard } from '@/src/components/chat/call-transcript-card';
import { useJoinableChannel } from '@/src/hooks/useJoinableChannel';
import { useSelf } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { dismissRegisteredComposerFocus } from '@/src/utils/composerFocusDismissRegistry';
import { buildComposerContentForSend } from '@/src/utils/prepareComposerContentForSend';
import { subscribeMutationRestore } from '@/src/zero/awaitMutation';
import { mutators } from '@/src/zero/mutators';
import { haptics } from '@/src/utils/haptics';

import { awaitKeyboardHidden } from '../composer/awaitKeyboardHidden';
import { onSend } from '../composer/onSend';
import { ConversationList, type ListEvent, type RowEventKind } from '../list/ConversationList';
import type { OpenIntent } from '../intent/openIntent.types';
import type { ChatMessageRow } from '../model/chatRow.types';
import { callContentFor } from '../model/callPreview';
import type { ConversationWindow } from '../data/normalizeConversationWindow';
import { actionsTargetFor } from '../overlays/actionTarget';
import { ChatOverlays, useChatOverlays } from './ChatOverlays';
import { channelThreadOpen } from './channelThreadOpen';
import type { ChatOpenSession } from './useChatOpen';
import { useChatRows } from './useChatRows';

const ROOT = 'flex-1 bg-chat-screen' as const;

export function ChatConversationView({
  intent,
  session,
  window,
  parentTicketMd,
  parentTicketId,
  isTranscript,
  onParentTicketPress,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
  onVisible,
}: {
  intent: OpenIntent;
  session: ChatOpenSession;
  window: ConversationWindow;
  parentTicketMd: string | null;
  parentTicketId: string | null;
  isTranscript: boolean;
  onParentTicketPress?: () => void;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
  onVisible?: (row: { conversationId: string; createdAt: number } | null, atEnd: boolean) => void;
}): ReactElement {
  const router = useRouter();
  const zero = useZero();
  const self = useSelf();
  const { state, dispatch, ref, warmWindow, target: landingTarget } = session;
  const rows = useChatRows(
    intent,
    window,
    warmWindow,
    parentTicketMd,
    parentTicketId,
    landingTarget,
  );
  const { overlays, dispatchOverlays } = useChatOverlays();
  const { shouldShowJoinChannel, channel } = useJoinableChannel(intent.surface.channelId);
  const isThread = intent.surface.kind !== 'channel';
  const channelId = intent.surface.channelId;
  const threadId = intent.surface.kind === 'channel' ? undefined : intent.surface.threadId;
  const firstMessage = rows.find(row => row.type === 'message');
  const call = firstMessage?.type === 'message' ? firstMessage.model.callPreview : null;
  const callThreadMeta =
    isThread && isTranscript && firstMessage?.type === 'message' && call?.callId
      ? { callId: call.callId, callContent: callContentFor(call, firstMessage.model.body) }
      : null;

  useEffect(() => {
    KeyboardController.dismiss();
  }, [intent.intentKey]);

  const handleSend: ChatInputSendHandler = useCallback(
    (payload, restore) => {
      const content = buildComposerContentForSend(payload.text, payload.html);
      const editing = overlays.editing;
      if (editing) {
        if (!content) {
          return;
        }
        dispatchOverlays({ type: 'cancelEdit' });
        subscribeMutationRestore(
          zero.mutate(mutators.messages.update({ messageId: editing.messageId, content })),
          () => {
            dispatchOverlays({ type: 'startEdit', payload: editing });
            restore();
            Alert.alert('Failed to update message', 'Please try again.');
          },
        );
        return;
      }
      onSend(
        { zero, ref, createId: uuidv4 },
        {
          text: payload.text,
          content,
          attachments: payload.attachments,
          ...(payload.alsoSendToChannel ? { alsoSendToChannel: true } : {}),
        },
      );
    },
    [dispatchOverlays, overlays.editing, ref, zero],
  );

  const firstId = rows.find(row => row.type === 'message')?.model.conversationId;
  const longPressPendingRef = useRef(false);
  const openActions = useCallback(
    (row: ChatMessageRow): void => {
      if (shouldShowJoinChannel) {
        return;
      }
      if (longPressPendingRef.current) {
        return;
      }
      void haptics.longPress();
      const target = actionsTargetFor(row, threadId);
      const keyboardWasVisible = KeyboardController.isVisible();
      if (!keyboardWasVisible) {
        dismissRegisteredComposerFocus();
        dispatchOverlays({ type: 'openActions', target });
        return;
      }
      longPressPendingRef.current = true;
      const keyboardHidden = awaitKeyboardHidden(KeyboardController, { wasVisible: true });
      dismissRegisteredComposerFocus();
      void keyboardHidden.finally(() => {
        longPressPendingRef.current = false;
        dispatchOverlays({ type: 'openActions', target });
      });
    },
    [dispatchOverlays, shouldShowJoinChannel, threadId],
  );

  const onRowEvent = useCallback(
    (kind: RowEventKind, row: ChatMessageRow): void => {
      if (kind === 'press') {
        if (isThread) {
          KeyboardController.dismiss();
          if (
            onParentTicketPress &&
            row.model.conversationId === firstId &&
            row.model.ticketPreview
          ) {
            onParentTicketPress();
          }
          return;
        }
        router.push(channelThreadOpen(row.model, channelId, Date.now()));
        return;
      }
      if (kind === 'longPress') {
        openActions(row);
        return;
      }
      if (kind === 'reactions') {
        const messageId = row.model.messageId;
        if (!messageId) {
          return;
        }
        dispatchOverlays({
          type: 'openReactions',
          target: { messageId, reactionsMd: row.model.reactionPreview?.md ?? null },
        });
        return;
      }
      dispatchOverlays({
        type: 'openProfile',
        target: { userId: row.model.sender.senderId, displayName: row.model.sender.displayName },
      });
    },
    [channelId, dispatchOverlays, firstId, isThread, onParentTicketPress, openActions, router],
  );

  const onPaginate = useCallback(
    (edge: 'older' | 'newer'): void => {
      if (edge === 'older') {
        window.loadOlder();
        return;
      }
      window.loadNewer();
    },
    [window],
  );

  const onListEvent = useCallback(
    (event: ListEvent): void => {
      if (event.type === 'landingConfirmed') {
        dispatch({ type: 'landingConfirmed', metrics: event.metrics, intentKey: intent.intentKey });
        return;
      }
      if (event.type === 'userTookOwnership') {
        dispatch({ type: 'userTookOwnership', intentKey: intent.intentKey });
        return;
      }
      if (event.type === 'visible') {
        onVisible?.(event.row, event.atEnd);
        return;
      }
      if (event.type === 'openLatest') {
        dispatch({
          type: 'reanchor',
          target: { kind: 'tail' },
          now: Date.now(),
          intentKey: intent.intentKey,
        });
        return;
      }
      window.retry();
      dispatch({ type: 'retry', now: Date.now(), intentKey: intent.intentKey });
    },
    [dispatch, intent.intentKey, onVisible, window],
  );

  const actionsRow =
    overlays.sheet.kind === 'actions' ||
    overlays.sheet.kind === 'forward' ||
    overlays.sheet.kind === 'remind'
      ? overlays.sheet.target.row
      : null;

  return (
    <View className={ROOT}>
      {callThreadMeta ? (
        <View className='flex-1'>
          <CallTranscriptCard
            callId={callThreadMeta.callId}
            callContent={callThreadMeta.callContent}
            isExpand
            fullHeight
          />
        </View>
      ) : (
        <ConversationList
          surface={intent.surface}
          state={state}
          rows={rows}
          composer={{
            conversationId: channelId,
            onSend: handleSend,
            editingMessage: overlays.editing,
            onCancelEdit: (): void => dispatchOverlays({ type: 'cancelEdit' }),
            ...(threadId ? { threadId } : {}),
            ...(shouldShowJoinChannel
              ? {
                  joinChannel: {
                    channelId,
                    ...(channel?.name ? { channelTitle: channel.name } : {}),
                  },
                }
              : {}),
          }}
          onPaginate={onPaginate}
          hasReachedStart={window.hasReachedStart}
          onRowEvent={onRowEvent}
          onListEvent={onListEvent}
        />
      )}
      <ChatOverlays
        state={overlays}
        dispatch={dispatchOverlays}
        rows={rows}
        {...(threadId ? { threadId } : {})}
        isThread={isThread}
        currentUserId={self?.id}
        isChannelArchived={channel?.isArchived === true}
        isFirstInThread={Boolean(
          isThread && actionsRow && actionsRow.model.conversationId === firstId,
        )}
        hasTicket={
          intent.surface.kind === 'ticket-thread' || Boolean(actionsRow?.model.ticketPreview)
        }
        {...(onBeforeMarkUnread ? { onBeforeMarkUnread } : {})}
        {...(onMarkUnreadFailure ? { onMarkUnreadFailure } : {})}
      />
    </View>
  );
}
