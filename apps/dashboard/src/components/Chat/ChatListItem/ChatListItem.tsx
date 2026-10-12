import { QueryResultType } from '@rocicorp/zero';
import React, {
  ReactElement,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { queries } from '../../../zero/queries';
import { ChatBubble } from '../ChatBubble/ChatBubble';
import { DatePill } from '../DatePill';
import { type ChatListItemWithSeparator } from '../../../utils/chatUtils';
import { shouldShowAvatar } from '../ChatList/ChatListUtils';
import { useDraft, useDraftFromDB } from '../../../hooks/useDraft';
import { ChannelScopeType, MessageAttachment } from '@xyne/shared';
import { getInitialMessageFromConversation } from '../../../utils/conversationMessageHelpers';
import { useAuth } from '../../../hooks/useAuth';
import { useShowThreadTags } from '../../../hooks/useShowThreadTags';

import { PendingSendStatus } from '../PendingSendStatus/PendingSendStatus';
import { DiscussionListContext } from '../ConversationPannel/DiscussionListContext';
import { HoverActionsToolbar } from '../HoverActionsToolbar/HoverActionsToolbar';
import {
  getMessageHoverActions,
  subscribeMessageHoverActions,
} from '../HoverActionsToolbar/messageHoverActionsRegistry';

/**
 * A discussion card's footer actions: React, and More with the rest. The message
 * registers its actions under the hover key stamped on its root, as it does for the
 * floating bar; this reads the same entry, so the card acts exactly as a chat row.
 */
function DiscussionCardActions(props: {
  card: React.RefObject<HTMLDivElement | null>;
}): ReactElement | null {
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  useEffect(() => {
    setHoverKey(
      props.card.current?.querySelector('[data-hover-key]')?.getAttribute('data-hover-key') ?? null,
    );
  });
  const actions = useSyncExternalStore(subscribeMessageHoverActions, () =>
    hoverKey ? getMessageHoverActions(hoverKey) : undefined,
  );
  if (!actions) return null;
  // Spread as the floating bar spreads it; the shortcut-only fields go unused here.
  return <HoverActionsToolbar isVisible layout='footer' {...actions} />;
}

/** Inside a discussion card, these act for themselves rather than opening the thread. */
const CARD_OWN_CONTROLS =
  'a, button, input, textarea, select, [role="button"], [role="menuitem"], [contenteditable="true"], [data-prevent-thread]';

type ChatListItemProps = {
  item: ChatListItemWithSeparator;
  index: number;
  chatListItems: ChatListItemWithSeparator[];
  channelId: string;
  projectId?: string | undefined;
  channelScopeType?: ChannelScopeType | undefined;
  handleOpenThread: (conversationId: string, e?: React.MouseEvent) => void;
  measureRef?: (node: Element | null) => void;
  dataIndex?: number;
  onEmojiPickerOpenChange?: (isOpen: boolean) => void;
  linkedConversationId?: string | null;
  /** Always show the sender header, whatever the previous row (deep-link target). */
  forceShowAvatar?: boolean;
};

const ChatListItemComponent = ({
  item,
  index,
  chatListItems,
  channelId,
  projectId,
  channelScopeType,
  handleOpenThread,
  measureRef,
  dataIndex,
  onEmojiPickerOpenChange,
  linkedConversationId,
  forceShowAvatar = false,
}: ChatListItemProps): ReactElement | null => {
  // All non-date-separator items are conversations - get conversation data first
  const conversation =
    item.type !== 'date-separator'
      ? (item.data as QueryResultType<typeof queries.channelConversationsPaginatedV3>[number])
      : null;

  // Hooks must be called unconditionally
  const { user } = useAuth();
  const draft = useDraft(channelId, conversation?.conversationId ?? '');
  const draftFromDB = useDraftFromDB(channelId, conversation?.conversationId ?? '');
  const hasDraftAttachments = draftFromDB?.attachments && draftFromDB.attachments?.length > 0;
  const pendingMessageId = conversation?.initialMessageId ?? '';
  const { showThreadTags } = useShowThreadTags();
  const discussionList = useContext(DiscussionListContext);
  const cardRef = useRef<HTMLDivElement>(null);

  // Render date separator
  if (item.type === 'date-separator') {
    return (
      <div ref={measureRef} data-index={dataIndex}>
        <DatePill dateText={item.dateText} />
      </div>
    );
  }
  // Now we know it's a conversation - get initial message from denormalized data
  const initialMsg = conversation
    ? getInitialMessageFromConversation(conversation, user?.id)
    : null;

  // Attach attachments and nudgeCounts from the conversation's denormalized relations
  const convAny = conversation as {
    initialMessageAttachments?: readonly { id: string }[];
    initialMessageNudgeCounts?: readonly { id: string; nudgeCount: number }[];
  } | null;
  const message = initialMsg
    ? {
        ...initialMsg,
        attachments: (convAny?.initialMessageAttachments ?? []) as unknown as MessageAttachment[],
        nudgeCounts: convAny?.initialMessageNudgeCounts ?? [],
      }
    : null;

  if (!message || !conversation) return null;

  // Use centralized avatar logic for conversations
  const prevItem = index > 0 ? (chatListItems[index - 1] ?? null) : null;
  let showAvatar = true;

  if (!forceShowAvatar && prevItem && prevItem.type !== 'date-separator') {
    showAvatar = shouldShowAvatar(item, prevItem, showThreadTags);
  }

  const bubble = (
    <ChatBubble
      message={message}
      channelId={channelId}
      projectId={projectId}
      channelScopeType={channelScopeType}
      // Every discussion is its own card, so each says who started it.
      showAvatar={discussionList ? true : showAvatar}
      conversation={conversation}
      {...(draft && { draft })}
      {...(!!hasDraftAttachments && { hasDraftAttachments })}
      replies={{
        replyCount: conversation.replyCount,
        lastActivityAt: conversation.lastActivityAt,
        onOpenThread: (e?: React.MouseEvent) => handleOpenThread(conversation.conversationId, e),
      }}
      {...(onEmojiPickerOpenChange && { onEmojiPickerOpenChange })}
      {...(linkedConversationId !== null && { linkedConversationId })}
    />
  );

  if (discussionList) {
    // A discussion reads as a card: its opening line, bold, is its title, and a
    // click anywhere on it that isn't one of its own controls opens the thread —
    // which is where people talk. Its message keeps every action it has in a chat.
    // The card is the hover surface: the message's own row tint stops short of the
    // card's rounded edge and reads as a band above and below it.
    const openDiscussion = (event: React.MouseEvent<HTMLDivElement>): void => {
      if (window.getSelection()?.toString()) return;
      if (event.target instanceof Element && event.target.closest(CARD_OWN_CONTROLS)) return;
      handleOpenThread(conversation.conversationId, event);
    };
    return (
      <div
        ref={measureRef}
        data-index={dataIndex}
        id={`conv-${conversation.conversationId}`}
        data-hash-id={`conv-${conversation.conversationId}`}
        className='px-3 py-1.5'
      >
        {/* The thread also opens from the message's own Reply action and its replies
            line, which are buttons; the card is a larger target for the pointer. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          ref={cardRef}
          onClick={openDiscussion}
          className='group/card relative cursor-pointer overflow-hidden rounded-xl border border-border/70 bg-card/40 pb-3 pt-1 transition-colors duration-200 ease-out hover:border-border hover:bg-card/70 [&_[data-hovered]]:!bg-transparent [&_.jp-message-html_p:first-child>strong:first-child]:text-[15px] [&_.jp-message-html_p:first-child>strong:first-child]:leading-snug [&_.message-html-root>p:first-child:has(>strong:first-child)+p]:mt-0.5'
          data-track-category='SdlcHub'
          data-track-name='DiscussionCardOpened'
        >
          {bubble}
          {/* The footer: the replies line when there are replies; else a line of its
              own that starts the conversation, so the actions never cover the message. */}
          {conversation.replyCount === 0 && (
            <div className='flex h-8 items-center pl-[3.25rem]'>
              <button
                type='button'
                onClick={event => handleOpenThread(conversation.conversationId, event)}
                className='rounded-md px-1.5 py-0.5 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
                data-track-category='SdlcHub'
                data-track-name='DiscussionReplyStarted'
              >
                Reply
              </button>
            </div>
          )}
          <div className='absolute bottom-3.5 right-2.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover/card:opacity-100 has-[[data-state=open]]:opacity-100'>
            <DiscussionCardActions card={cardRef} />
          </div>
        </div>
        <PendingSendStatus messageId={pendingMessageId} />
      </div>
    );
  }

  return (
    <div
      ref={measureRef}
      data-index={dataIndex}
      id={`conv-${conversation.conversationId}`}
      data-hash-id={`conv-${conversation.conversationId}`}
      className={`${showAvatar ? 'pt-4' : 'pt-1'} pb-1`}
    >
      {bubble}
      <PendingSendStatus messageId={pendingMessageId} />
    </div>
  );
};

export const ChatListItem = React.memo(ChatListItemComponent);
