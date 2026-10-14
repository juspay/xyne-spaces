import {
  firePendingMutator,
  usePendingByMessageId,
  usePendingStatusByMessageId,
} from '@xyne/shared/messages';
import { memo, useCallback, type ReactElement } from 'react';
import { Pressable, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { useZero } from '@/src/hooks/useZero';
import type { ChatMessageRow } from '../model/chatRow.types';
import { rowPressIntent } from '../overlays/actionVisibility';
import { showMessageBody } from '../model/bodyPaint';
import { hasBlockMarkdown } from '../model/text/parseInlineRich';
import { JumpHighlight } from './JumpHighlight';
import { MessageRowAvatar } from './MessageRowAvatar';
import { MessageRowBody } from './MessageRowBody';
import { MessageRowMedia } from './MessageRowMedia';
import { MessageRowMeta } from './MessageRowMeta';
import { MessageRowReactions } from './MessageRowReactions';
import { RowEntrance } from './RowEntrance';
import { SenderNameLabel } from './SenderNameLabel';
import { ForwardedBanner } from './parts/ForwardedBanner';
import { LinkPreviewCard } from './parts/LinkPreviewCard';
import { ParentPreviewCard } from './parts/ParentPreviewCard';
import { TicketCard } from './parts/TicketCard';
import { DeletedMessageBody } from './parts/DeletedMessageBody';
import { useChatRenderTokens } from '../theme/ChatRenderProvider';
import { useRecyclingState } from './useRecyclingState';

type MessageRowProps = {
  row: ChatMessageRow;
  hideReplyChrome?: boolean;
  onPress: (row: ChatMessageRow) => void;
  onLongPress: (row: ChatMessageRow) => void;
  onAvatarPress: (row: ChatMessageRow) => void;
  onReactionsPress: (row: ChatMessageRow) => void;
  onToggleExpand: (conversationId: string) => void;
};

/**
 * Row anatomy is v2's (`v2/components/chat/message-row.tsx`), deliberately:
 *
 *   Pressable[py-1 flex-row items-end gap-2 · justify]
 *     ├─ MessageRowAvatar          sibling of the bubble, bottom-aligned, 24px
 *     └─ View[maxWidth=inlineContentMaxWidth · fixedBubbleStyle]
 *          ├─ View[rounded-xl px-2 py-1.5 · bubbleBg]
 *          │    ├─ SenderNameLabel        inside the bubble, not above it
 *          │    ├─ forwarded / parent preview / body / ticket / media / link
 *          │    └─ MessageRowMeta         reply tray · status · timestamp
 *          └─ MessageRowReactions         outside the bubble, inside the column
 *
 * Changing this shape changes row height — see `measureRowHeight`, which is
 * derived against exactly this layout.
 */
export const MessageRow = memo(function MessageRow({
  row,
  hideReplyChrome = false,
  onPress,
  onLongPress,
  onAvatarPress,
  onReactionsPress,
  onToggleExpand,
}: MessageRowProps): ReactElement {
  const model = row.model;
  const tokens = useChatRenderTokens();
  const zero = useZero();
  const pending = usePendingByMessageId(model.messageId ?? '');
  const pendingStatus = usePendingStatusByMessageId(model.messageId ?? '');

  const mine = model.rowKind === 'CURRENT_USER';
  const isDm = model.isDm;
  // v2: identity is hidden in DMs; only other people's rows reserve an avatar.
  const showIdentity = !isDm;
  const showAvatarSlot = !mine && !isDm;
  const isTicketRow = model.rowKind === 'TICKET' || model.ticketPreview !== null;
  const replyCount = hideReplyChrome ? 0 : (model.replyPreview?.count ?? 0);
  const hasReactions = (model.reactionPreview?.totalCount ?? 0) > 0;
  const showBody = showMessageBody(model);
  const [bubbleWidth, setBubbleWidth] = useRecyclingState(
    `${model.conversationId}:bubble-width`,
    0,
  );
  // v2: a ticket, media, or expanded block body pins the bubble to the full
  // readable width so the card does not shrink-wrap its content.
  const fixedBubbleStyle =
    isTicketRow || model.mediaPreview || (model.isExpanded && hasBlockMarkdown(model.body.markdown))
      ? { width: tokens.inlineContentMaxWidth }
      : undefined;
  const handleBubbleLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      const width = Math.round(event.nativeEvent.layout.width);
      setBubbleWidth(current => (current === width ? current : width));
    },
    [setBubbleWidth],
  );
  const handleIdentityPress = useCallback(
    (event: GestureResponderEvent): void => {
      event.stopPropagation();
      onAvatarPress(row);
    },
    [onAvatarPress, row],
  );

  const handlePress = (): void => {
    const intent = rowPressIntent(pending !== undefined && pending !== null, pendingStatus ?? null);
    if (intent === 'retry') {
      if (pending) {
        firePendingMutator(zero, pending);
      }
      return;
    }
    if (intent === 'actions') {
      onLongPress(row);
      return;
    }
    onPress(row);
  };

  return (
    <JumpHighlight conversationId={model.conversationId} enabled={model.isHighlighted}>
      <RowEntrance conversationId={model.conversationId} enabled={model.isEntering}>
        <Pressable
          accessibilityRole='button'
          className={`py-1 flex-row items-end gap-2 ${mine ? 'justify-end' : 'justify-start'}`}
          onPress={handlePress}
          onLongPress={(): void => onLongPress(row)}
        >
          {showAvatarSlot ? (
            <MessageRowAvatar
              model={model}
              hasReactions={hasReactions}
              onPress={handleIdentityPress}
            />
          ) : null}

          <View style={[{ maxWidth: tokens.inlineContentMaxWidth }, fixedBubbleStyle]}>
            <View
              onLayout={handleBubbleLayout}
              className={`rounded-xl px-2 py-1.5 ${
                mine
                  ? 'light:shadow-[0px_1px_0.25px_0px_rgba(11,20,26,0.06)] dark:shadow-none'
                  : 'bg-conversation-composer-root-bg-other light:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.06)] dark:shadow-[0px_1px_0.5px_0px_rgba(11,20,26,0.13)]'
              }`}
              style={mine ? { backgroundColor: tokens.currentUserBubbleBg } : undefined}
            >
              {model.showSenderName && showIdentity ? (
                <SenderNameLabel model={model} onPress={handleIdentityPress} />
              ) : null}

              {model.forwarded ? (
                <ForwardedBanner forwarded={model.forwarded} mine={mine} model={model} />
              ) : null}

              {model.parentPreview ? (
                <ParentPreviewCard
                  preview={model.parentPreview}
                  mine={mine}
                  channelId={model.channelId}
                />
              ) : null}

              {model.isDeleted ? (
                <DeletedMessageBody />
              ) : (
                <>
                  {model.ticketPreview ? (
                    <TicketCard ticket={model.ticketPreview} mine={mine} />
                  ) : showBody ? (
                    <View className='mb-2.5'>
                      <MessageRowBody model={model} onToggleExpand={onToggleExpand} />
                    </View>
                  ) : null}

                  {model.linkPreview ? (
                    <LinkPreviewCard preview={model.linkPreview} mine={mine} />
                  ) : null}

                  {model.mediaPreview ? (
                    <MessageRowMedia
                      media={model.mediaPreview}
                      conversationId={model.conversationId}
                    />
                  ) : null}
                </>
              )}

              <MessageRowMeta
                model={model}
                pendingStatus={pendingStatus ?? null}
                replyCount={replyCount}
                showReplyBorder={replyCount > 0 && !isTicketRow && !model.mediaPreview}
              />
            </View>

            <MessageRowReactions
              reactions={model.reactionPreview}
              availableBubbleWidth={bubbleWidth}
              onOpen={(): void => onReactionsPress(row)}
            />
          </View>
        </Pressable>
      </RowEntrance>
    </JumpHighlight>
  );
});
