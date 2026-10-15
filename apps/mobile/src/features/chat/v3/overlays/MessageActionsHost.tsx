import {
  firePendingMutator,
  getStatus,
  removePending,
  usePendingByMessageId,
} from '@xyne/shared/messages';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useMemo, type ReactElement } from 'react';
import { Alert, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { useCSSVariable } from 'uniwind';
import { v4 as uuidv4 } from 'uuid';

import type { ChatInputEditingMessage } from '@/src/components/input-composer/input-composer.types';
import { AppBottomSheet } from '@/src/components/ui/app-bottom-sheet';
import { useZero } from '@/src/hooks/useZero';
import { getActiveWorkspaceId } from '@/src/utils/activeWorkspace';
import {
  copyImageAttachmentToClipboard,
  getFirstImageAttachment,
} from '@/src/utils/copyImageAttachment';
import { reactionsMdToRawReactions } from '@/src/utils/conversationMessageHelpers';
import { normalizeWorkspaceIdForLink } from '@/src/utils/deepLinkWorkspace';
import { haptics } from '@/src/utils/haptics';
import { setRichMessageClipboard } from '@/src/utils/richMessageClipboard';
import { startAudioCall } from '@/src/utils/startAudioCall';
import type { ChatMessageRow } from '../model/chatRow.types';
import type { AttachmentInput } from '../model/conversationInput';
import { ActionRow } from './ActionRow';
import {
  ACTION_ORDER,
  actionFlagsFor,
  actionVisibility,
  dividerBeforeDelete,
  dividerBeforeMarkAsUnread,
} from './actionVisibility';
import { actionTargetForModel, onAction, type OnActionDeps } from './onAction';
import { messageActionLink } from './messageActionLink';
import { TRANSPARENT_SHEET, messageActionsChrome } from './messageActionsChrome';
import { QuickReactionsRail } from './QuickReactionsRail';
import { toggleReaction } from './toggleReaction';

export type MessageActionsTarget = {
  row: ChatMessageRow;
  html: string;
  attachments: readonly AttachmentInput[];
  reactionsMd: string | null;
  threadId?: string;
};

export type MessageActionsHostProps = {
  target: MessageActionsTarget | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  isThread: boolean;
  currentUserId: string | undefined;
  isChannelArchived: boolean;
  isFirstInThread: boolean;
  hasTicket: boolean;
  repliesEnabled?: boolean;
  onEditInChat?: (payload: ChatInputEditingMessage) => void;
  onForward?: () => void;
  onRemind?: () => void;
  onMoreReactions?: () => void;
  onBeforeMarkUnread?: () => void;
  onMarkUnreadFailure?: () => void;
};

export function MessageActionsHost({
  target,
  isOpen,
  onOpenChange,
  isThread,
  currentUserId,
  isChannelArchived,
  isFirstInThread,
  hasTicket,
  repliesEnabled = true,
  onEditInChat,
  onForward,
  onRemind,
  onMoreReactions,
  onBeforeMarkUnread,
  onMarkUnreadFailure,
}: MessageActionsHostProps): ReactElement | null {
  const model = target?.row.model;
  const zero = useZero();
  const router = useRouter();
  const foreground = useCSSVariable('--color-foreground') as string;
  const accent = useCSSVariable('--color-accent') as string;
  const sheetBg = useCSSVariable('--color-bottomsheet-bg') as string;
  const border = useCSSVariable('--color-border') as string;
  const pending = usePendingByMessageId(model?.messageId ?? '');
  const deps = useMemo<OnActionDeps>(
    () => ({
      zero,
      createId: uuidv4,
      now: Date.now,
      retryPending: (): void => {
        if (pending) {
          firePendingMutator(zero, pending);
        }
      },
      deletePending: (): void => {
        if (pending) {
          removePending(pending.messageId);
        }
      },
      pushThread: (channelId: string, conversationId: string): void => {
        router.push({
          pathname: '/chat/[channelId]/[threadId]',
          params: {
            channelId,
            threadId: conversationId,
            from: 'channel_thread',
            openStartedAtMs: String(Date.now()),
          },
        });
      },
      copyText: (plain: string, html: string): void => {
        setRichMessageClipboard({ plainText: plain, storedHtml: html });
        void Clipboard.setStringAsync(plain);
        void haptics.success();
      },
      copyLink: (): void => {
        if (!model?.messageId) {
          return;
        }
        const workspaceId = normalizeWorkspaceIdForLink(getActiveWorkspaceId());
        const link = messageActionLink({
          channelId: model.channelId,
          conversationId: model.conversationId,
          messageId: model.messageId,
          ...(target?.threadId ? { threadId: target.threadId } : {}),
          ...(workspaceId ? { workspaceId } : {}),
          isThread,
        });
        void Clipboard.setStringAsync(link);
        void haptics.success();
      },
      copyImage: (): void => {
        const attachment = getFirstImageAttachment(target?.attachments);
        if (!attachment) {
          return;
        }
        void copyImageAttachmentToClipboard(attachment)
          .then(() => haptics.success())
          .catch((error: unknown) => {
            Alert.alert(
              'Copy failed',
              error instanceof Error ? error.message : 'Failed to copy image.',
            );
          });
      },
      startCall: (channelId: string): void => {
        void startAudioCall(channelId);
      },
      confirmDelete: (onConfirm: () => void): void => {
        void haptics.warning();
        Alert.alert('Delete message?', 'This action cannot be undone.', [
          { text: 'Cancel', style: 'cancel', onPress: (): void => onOpenChange(false) },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: (): void => {
              onOpenChange(false);
              onConfirm();
              void haptics.success();
            },
          },
        ]);
      },
      fail: (title: string, message: string): void => Alert.alert(title, message),
      ...(onEditInChat ? { onEditInChat } : {}),
      ...(onForward ? { onForward } : {}),
      ...(onRemind ? { onRemind } : {}),
      ...(onBeforeMarkUnread ? { onBeforeMarkUnread } : {}),
      ...(onMarkUnreadFailure ? { onMarkUnreadFailure } : {}),
    }),
    [
      isThread,
      model,
      onEditInChat,
      onForward,
      onBeforeMarkUnread,
      onMarkUnreadFailure,
      onOpenChange,
      onRemind,
      pending,
      router,
      target,
      zero,
    ],
  );

  if (!target || !model) {
    return null;
  }

  const isPending = pending !== undefined && pending !== null;
  const visible = actionVisibility(
    actionFlagsFor(model, {
      isThread,
      isChannelArchived,
      isFirstInThread,
      hasTicket,
      repliesEnabled,
      hasEditHandler: onEditInChat !== undefined,
      hasReminderHandler: onRemind !== undefined,
      isPending,
      isFailed: isPending && getStatus(pending) === 'failed',
      canDeletePending: isPending
        ? !pending.mutatorFired || Boolean(pending.mutatorAppError)
        : false,
    }),
  );
  const renderableActions = new Set(
    [...visible].filter(id => id !== 'forward-message' || onForward),
  );

  return (
    <AppBottomSheet
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      enableBlurKeyboardOnGesture={false}
      enableContentPanningGesture
      allowNativeCloseWhileOpening
      animationDuration={260}
      backdropOpacity={0.66}
      showHandleIndicator
      skipInitialImperativeSnap
      mode='dynamic'
      backgroundStyle={TRANSPARENT_SHEET}
    >
      <BottomSheetScrollView>
        <View className='items-center gap-2.5 px-4 pb-5 pt-1'>
          {!model.isDeleted && !isPending ? (
            <QuickReactionsRail
              accent={accent}
              foreground={foreground}
              sheetBg={sheetBg}
              onMore={(): void => {
                onMoreReactions?.();
              }}
              onReact={(emoji: string): void => {
                const messageId = model.messageId;
                if (!messageId || !currentUserId) {
                  onOpenChange(false);
                  return;
                }
                const hasReacted = reactionsMdToRawReactions(target.reactionsMd, messageId).some(
                  item => item.emojiName === emoji && item.userId === currentUserId,
                );
                toggleReaction(zero, {
                  messageId,
                  emojiName: emoji,
                  hasReacted,
                  createId: uuidv4,
                });
                onOpenChange(false);
              }}
            />
          ) : null}
          <View
            style={[
              messageActionsChrome.actionPanel,
              { backgroundColor: sheetBg, borderColor: border },
            ]}
          >
            {ACTION_ORDER.filter(id => renderableActions.has(id)).map(id => (
              <View key={id}>
                {id === 'mark-as-unread' && dividerBeforeMarkAsUnread(renderableActions) ? (
                  <View className='mx-[18px] my-1.5 h-px bg-border' />
                ) : null}
                {id === 'delete' && dividerBeforeDelete(renderableActions) ? (
                  <View className='mx-[18px] my-1.5 h-px bg-border' />
                ) : null}
                <ActionRow
                  id={id}
                  model={model}
                  foreground={foreground}
                  onPress={(): void => {
                    onAction(
                      deps,
                      id,
                      actionTargetForModel(model, target.html, target.threadId),
                      isThread,
                    );
                    if (
                      id === 'forward-message' ||
                      id === 'remind-me' ||
                      id === 'edit-in-chat' ||
                      id === 'delete'
                    )
                      return;
                    close();
                  }}
                />
              </View>
            ))}
          </View>
        </View>
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}
